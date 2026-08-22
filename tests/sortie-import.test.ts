// 單場出擊 JSON 匯入（utils/sortie-import.ts）：解析、去重、以及落地時的 event ID 借號。
// 解析以真封包樣本為主（samples/61-3.json 是 KC3Kai logger 匯出，欄位命名與本專案匯出不同，
// 兩種來源都要吃得下）。
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb, type ReplayRow, type SortieLogRow } from '../utils/db';
import { buildFullEnvelope, restoreBackup, validateBackupEnvelope } from '../utils/backup';
import { toKc3Replay } from '../utils/replay';
import {
    importSortie, isSameSortie, packetHash, parseSortieImport, normalizeTime,
    SortieImportDuplicateError, SortieImportError, TIME_TOLERANCE_MS,
} from '../utils/sortie-import';

const sample = () => JSON.parse(readFileSync(new URL('../samples/61-3.json', import.meta.url), 'utf8'));

const databases: KcDb[] = [];
let serial = 0;
function createDb() {
    const database = new KcDb(`kc-sortie-import-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}
afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('解析（KC3Kai 匯出）', () => {
    it('吃下 KC3Kai 的欄位命名，並補齊本專案需要的形狀', () => {
        const parsed = parseSortieImport(sample());
        expect(parsed.replay.world).toBe(61);
        expect(parsed.replay.mapnum).toBe(3);
        expect(parsed.replay.diff).toBe(4);
        expect(parsed.replay.combined).toBe(1);
        expect(parsed.replay.battles).toHaveLength(5);
        // KC3 的 level → lv；HP 由第一個戰鬥封包的 api_f_nowhps 補（出擊當下的血量）
        expect(parsed.replay.fleet1[0].lv).toBeGreaterThan(1);
        expect(parsed.replay.fleet1[0].maxhp).toBeGreaterThan(0);
        // 支援艦隊候補與基地航空隊快照也一併帶進來
        expect(parsed.replay.fleet3?.length).toBeGreaterThan(0);
        expect(parsed.replay.lbas?.map(b => b.rid)).toEqual([1, 2, 3]);
        expect(parsed.replay.lbas?.[0].squadrons[0].mst).toBeGreaterThan(0);
        // 匯入的紀錄一律標記＋釘選（不標會被當成本機擷取；不釘會被重播裁剪掃掉）
        expect(parsed.replay.imported).toBe(true);
        expect(parsed.replay.pinned).toBe(true);
    });

    it('節點摘要：boss 由 nodes[].eventColorNo===5 判定，基地空襲另成一列', () => {
        const parsed = parseSortieImport(sample());
        const battles = parsed.rows.filter(r => r.kind === 'battle');
        expect(battles.map(r => r.node)).toEqual([25, 50, 51, 52, 53]);
        expect(battles.find(r => r.node === 53)!.boss).toBe(true);
        expect(battles.filter(r => r.boss)).toHaveLength(1);
        // 61-3 的 52 節點帶 airRaid（＝api_destruction_battle），要獨立成 raid 列
        const raid = parsed.rows.find(r => r.kind === 'raid')!;
        expect(raid.node).toBe(52);
        expect(raid.seiku).toBe(1);
        expect(raid.raidLostKind).toBe(4);
    });

    it('KC3Kai 對「沒有夜戰的節點」寫 yasen:{}，不可當成夜戰接續', () => {
        const parsed = parseSortieImport(sample());
        // 61-3 只有 boss 節點（53）真的打了夜戰，其餘四個節點的 yasen 都是空物件
        const withYasen = parsed.replay.battles.filter(b => b.yasen);
        expect(withYasen.map(b => b.node)).toEqual([53]);
    });

    // ⚠️ KC3Kai logger 用 `rating`／`drop`／`mvp`／`hqEXP`／`baseEXP` 表示結算資訊，
    // 不使用 kcsapi 的 `rank` 鍵。
    it('KC3Kai 匯出帶完整結算：rating／drop／mvp／經驗值都要收', () => {
        const parsed = parseSortieImport(sample(), { shipName: mst => `#${mst}` });
        const boss = parsed.rows.find(r => r.node === 53 && r.kind === 'battle')!;
        expect(boss.rank).toBe('A');
        expect(boss.dropMst).toBe(55);          // 61-3 boss 掉落
        expect(boss.drop).toBe('#55');          // 名字由呼叫端的解析器補
        expect(boss.getExp).toBeGreaterThan(0); // hqEXP＝提督經驗值
        expect(boss.baseExp).toBeGreaterThan(0);// baseEXP＝基礎經驗值（遊戲封包沒有）
        expect(boss.mvp).toBeGreaterThan(0);
        // 封包能算的仍要算：敵編成、制空、大破
        expect(boss.enemyIds).toHaveLength(6);
        expect(boss.enemyIdsEscort).toHaveLength(6);
        expect(boss.seiku).toBe(2);
    });

    it('KC3Kai 的 SS（完全勝利）正規化成 S —— 遊戲的 api_win_rank 只吐 S', () => {
        const parsed = parseSortieImport(sample());
        // 61-3 的 node 50 在來源檔是 "SS"
        expect(parsed.rows.find(r => r.node === 50 && r.kind === 'battle')!.rank).toBe('S');
        expect(parsed.rows.some(r => r.rank === 'SS')).toBe(false);
    });

    it('沒掉船的節點：drop 為 null 但 rank 有值 ⇒ UI 才能說「無掉落」', () => {
        const parsed = parseSortieImport(sample());
        const noDrop = parsed.rows.filter(r => r.kind === 'battle' && !r.dropMst);
        expect(noDrop.length).toBeGreaterThan(0);
        expect(noDrop.every(r => r.drop === null && r.rank !== '')).toBe(true);
    });

    it('沒有解析器時只留 master id，不編假名字', () => {
        const parsed = parseSortieImport(sample());
        const boss = parsed.rows.find(r => r.node === 53 && r.kind === 'battle')!;
        expect(boss.dropMst).toBe(55);
        expect(boss.drop).toBeNull();
    });

    it('61-5 樣本：boss 節點掉落長波（master 135）', () => {
        const s615 = JSON.parse(readFileSync(new URL('../samples/61-5-jibun-rengou-node52.json', import.meta.url), 'utf8'));
        const parsed = parseSortieImport(s615);
        const boss = parsed.rows.find(r => r.kind === 'battle' && r.boss)!;
        expect(boss.node).toBe(55);
        expect(boss.dropMst).toBe(135);
        expect(boss.rank).toBe('S');
        // 連合艦隊 ⇒ 隨伴 MVP 也要收
        expect(boss.mvp).toBe(1);
        expect(boss.mvpEscort).toBe(1);
        // 61-5 的基地航空隊含 ace=-1；仍必須符合既有 replay backup 契約。
        expect(() => validateBackupEnvelope({
            schemaVersion: 4, kind: 'replays', exportedAt: parsed.replay.ts,
            tables: { replays: [{ ...parsed.replay, sortieKey: 1 }] },
        })).not.toThrow();
    });

    it('61-4 單艦隊樣本：KC3Kai 的 fleet2 是母港快照，不誤當隨伴或拒絕匯入', () => {
        const s614 = JSON.parse(readFileSync(new URL('../samples/61-4.json', import.meta.url), 'utf8'));
        expect(s614.combined).toBe(0);
        expect(s614.fleet2.length).toBeGreaterThan(0);
        const parsed = parseSortieImport(s614);
        expect(parsed.replay.combined).toBe(0);
        expect(parsed.replay.fleet1).toHaveLength(6);
        expect(parsed.replay.fleet2).toEqual([]);
        expect(parsed.rows.every(row => row.mvpEscort === undefined)).toBe(true);
    });

    it('節點類型（eventId／eventKind）一併帶進來，戰鬥與空襲列都要有', () => {
        const parsed = parseSortieImport(sample());
        const raid = parsed.rows.find(r => r.kind === 'raid')!;
        expect(raid.nodeEventId).toBeGreaterThan(0);
        // 61-3 的節點 50 是空襲戰（KC3Kai desc「空襲」、eventKind 6）
        const airRaid = parsed.rows.find(r => r.node === 50 && r.kind === 'battle')!;
        expect(airRaid.nodeEventKind).toBe(6);
        // boss（節點 53）是敵連合艦隊（eventKind 5）
        const boss = parsed.rows.find(r => r.node === 53 && r.kind === 'battle')!;
        expect(boss.nodeEventKind).toBe(5);
    });

    it('單艦隊出擊不收隨伴 MVP（KC3Kai 仍會填 mvp[1]=1，不可當事實）', () => {
        const single = { ...sample(), combined: 0, fleet2: [] };
        const parsed = parseSortieImport(single);
        expect(parsed.rows.every(r => r.mvpEscort === undefined)).toBe(true);
    });

    it('也吃得下本專案自己的匯出（toKc3Replay）', () => {
        const source = parseSortieImport(sample());
        const exported = toKc3Replay({ ...source.replay, sortieKey: 1, ts: 1_700_000_000_000 });
        const parsed = parseSortieImport(exported);
        expect(parsed.replay.world).toBe(61);
        expect(parsed.replay.battles).toHaveLength(5);
        expect(parsed.replay.fleet1[0].maxhp).toBeGreaterThan(0);   // nowhps/maxhps 命名
        expect(parsed.signature.hash).toBe(source.signature.hash);  // 內容相同 ⇒ 指紋相同

        // KC3Kai 只能從 fleet1 播單艦隊；外部格式改成 fleetnum=1 後，仍須還原真實出擊隊編號。
        const deck3 = toKc3Replay({
            ...source.replay, sortieKey: 2, combined: 0, fleetnum: 3, fleet2: [],
        });
        expect(deck3).toMatchObject({ fleetnum: 1, sourceFleetnum: 3 });
        expect(parseSortieImport(deck3).replay.fleetnum).toBe(3);
    });

    it.each([
        ['最外層不是物件', '[]'],
        ['缺海域', '{"time":1,"battles":[{"node":1,"data":{}}]}'],
        ['缺時間', '{"world":6,"mapnum":5,"battles":[{"node":1,"data":{}}]}'],
        ['沒有戰鬥節點', '{"world":6,"mapnum":5,"time":1,"battles":[]}'],
        ['節點缺封包', '{"world":6,"mapnum":5,"time":1,"battles":[{"node":1}]}'],
    ])('格式不符時明確拋錯（%s），不做半套匯入', (_label, json) => {
        expect(() => parseSortieImport(JSON.parse(json))).toThrow(SortieImportError);
    });

    it('time 秒／毫秒都吃（KC3Kai 與現行輸出用秒，舊版輸出可能是毫秒）', () => {
        expect(normalizeTime(1_700_000_000)).toBe(1_700_000_000_000);
        expect(normalizeTime(1_700_000_000_000)).toBe(1_700_000_000_000);
        expect(normalizeTime(0)).toBeNull();
        expect(normalizeTime(1_700_000_000.5)).toBeNull();
        expect(normalizeTime(Number.NaN)).toBeNull();
        expect(normalizeTime(Number.POSITIVE_INFINITY)).toBeNull();
        expect(normalizeTime('x')).toBeNull();
    });
});

describe('格式辨識與嚴格驗證', () => {
    const ownExport = () => {
        const parsed = parseSortieImport(sample());
        return structuredClone(toKc3Replay({ ...parsed.replay, sortieKey: 1, ts: 1_700_000_000_000 }));
    };

    it('只辨識 Fleet Chronometer version 4 與具 KC3Kai logger 識別欄位的格式', () => {
        expect(parseSortieImport(ownExport()).format).toBe('fleet-chronometer');
        expect(parseSortieImport(sample()).format).toBe('kc3kai');

        const similar = ownExport() as Record<string, unknown>;
        delete similar.version;
        expect(() => parseSortieImport(similar)).toThrow(/不支援的出擊 JSON 格式/);
        expect(() => parseSortieImport({
            world: 61, mapnum: 3, time: 1_700_000_000, fleet1: [], fleet2: [],
            battles: [{ node: 1, data: { api_name: 'looks similar' } }],
        })).toThrow(/不支援的出擊 JSON 格式/);
    });

    it.each([
        ['world fraction', 'world', 61.5], ['world string', 'world', '61'],
        ['world NaN', 'world', Number.NaN], ['world Infinity', 'world', Number.POSITIVE_INFINITY],
        ['world zero', 'world', 0], ['mapnum fraction', 'mapnum', 3.5],
        ['mapnum string', 'mapnum', '3'], ['mapnum zero', 'mapnum', 0],
        ['combined fraction', 'combined', 1.5], ['combined range', 'combined', 4],
        ['diff fraction', 'diff', 2.5], ['diff range', 'diff', 5],
        ['fleetnum fraction', 'fleetnum', 1.5], ['fleetnum zero', 'fleetnum', 0],
    ])('%s 被拒絕且指出欄位', (_label, key, value) => {
        const raw = sample();
        raw[key] = value;
        expect(() => parseSortieImport(raw)).toThrow(new RegExp(String(key)));
    });

    it.each([
        ['node fraction', 1.5], ['node string', '25'], ['node zero', 0],
        ['node NaN', Number.NaN], ['node Infinity', Number.POSITIVE_INFINITY],
    ])('%s 被拒絕', (_label, value) => {
        const raw = sample();
        raw.battles[0].node = value;
        expect(() => parseSortieImport(raw)).toThrow(/battles\[0\]\.node/);
    });

    it.each([
        ['fleet1', 'not-array'], ['fleet2', {}], ['fleet3', null], ['fleet4', 1],
    ])('%s 必須是陣列', (key, value) => {
        const raw = sample();
        raw[key] = value;
        expect(() => parseSortieImport(raw)).toThrow(new RegExp(String(key)));
    });

    it('非法艦娘等級、裝備與 HP 被拒絕，不用 fallback 補 0', () => {
        const level = sample();
        level.fleet1[0].level = 0;
        expect(() => parseSortieImport(level)).toThrow(/fleet1\[0\]\.level/);

        const equip = sample();
        equip.fleet1[0].equip[0] = '137';
        expect(() => parseSortieImport(equip)).toThrow(/fleet1\[0\]\.equip\[0\]/);

        const arrays = sample();
        arrays.fleet1[0].stars.pop();
        expect(() => parseSortieImport(arrays)).toThrow(/equip／stars／ace/);

        const hp = sample();
        hp.battles[0].data.api_f_maxhps[0] = 0;
        expect(() => parseSortieImport(hp)).toThrow(/api_f_maxhps\[0\]/);

        const inconsistent = ownExport() as any;
        inconsistent.fleet1[0].nowhps = inconsistent.fleet1[0].maxhps + 1;
        expect(() => parseSortieImport(inconsistent)).toThrow(/fleet1\[0\]\.nowhps/);
    });

    it.each([
        ['mst_id', (raw: any) => { raw.fleet1[0].mst_id = 0; }, /mst_id/],
        ['lv', (raw: any) => { raw.fleet1[0].lv = 0; }, /\.lv/],
        ['equip', (raw: any) => { raw.fleet1[0].equip[0] = -2; }, /equip\[0\]/],
        ['stars', (raw: any) => { raw.fleet1[0].stars[0] = 11; }, /stars\[0\]/],
        ['ace', (raw: any) => { raw.fleet1[0].ace[0] = -2; }, /ace\[0\]/],
        ['exequip', (raw: any) => { raw.fleet1[0].exequip = -2; }, /exequip/],
        ['nowhps', (raw: any) => { raw.fleet1[0].nowhps = -1; }, /nowhps/],
        ['maxhps', (raw: any) => { raw.fleet1[0].maxhps = 0; }, /maxhps/],
    ])('Fleet Chronometer 艦娘欄位 %s 非法時拒絕', (_label, mutate, pattern) => {
        const raw = ownExport();
        mutate(raw);
        expect(() => parseSortieImport(raw)).toThrow(pattern);
    });

    it('KC3Kai morale 必須是 0～100 的整數', () => {
        const raw = sample();
        raw.fleet1[0].morale = 100.5;
        expect(() => parseSortieImport(raw)).toThrow(/fleet1\[0\]\.morale/);
        raw.fleet1[0].morale = 101;
        expect(() => parseSortieImport(raw)).toThrow(/fleet1\[0\]\.morale/);
    });

    it('battle data 必須具有雙方主隊 HP 與敵艦 id 的最低形狀', () => {
        const missing = sample();
        delete missing.battles[0].data.api_f_maxhps;
        expect(() => parseSortieImport(missing)).toThrow(/battles\[0\]\.data/);

        const similar = sample();
        similar.battles[0].data = { api_name: 'not a battle' };
        expect(() => parseSortieImport(similar)).toThrow(/api_f_nowhps/);
    });

    it.each([
        ['rid', (raw: any) => { raw.lbas[0].rid = 0; }, /lbas\[0\]\.rid/],
        ['action', (raw: any) => { raw.lbas[0].action = 5; }, /lbas\[0\]\.action/],
        ['distance', (raw: any) => { raw.lbas[0].range = 1.5; }, /lbas\[0\]\.range/],
        ['squadrons', (raw: any) => { raw.lbas[0].planes = {}; }, /lbas\[0\]\.planes/],
        ['squadron mst', (raw: any) => { raw.lbas[0].planes[0].mst_id = 1.5; }, /mst_id/],
        ['squadron count', (raw: any) => { raw.lbas[0].planes[0].count = 19; }, /count/],
    ])('非法 lbas %s 被拒絕', (_label, mutate, pattern) => {
        const raw = sample();
        mutate(raw);
        expect(() => parseSortieImport(raw)).toThrow(pattern);
    });

    it('基地航空隊疲勞接受 api_cond 顯示狀態碼 0～3，拒絕範圍外數值', () => {
        const raw = sample();
        raw.lbas[0].planes[0].morale = 3;
        expect(parseSortieImport(raw).replay.lbas?.[0].squadrons[0].cond).toBe(3);
        raw.lbas[0].planes[0].morale = 4;
        expect(() => parseSortieImport(raw)).toThrow(/lbas\[0\]\.planes\[0\]\.morale/);
    });

    it('KC3Kai 支援艦隊缺少 HP 時保持缺席；Fleet 自身匯出缺 cond 時也不猜值', () => {
        const kc3 = parseSortieImport(sample());
        expect(kc3.replay.fleet3?.[0]).not.toHaveProperty('nowhp');
        expect(kc3.replay.fleet3?.[0]).not.toHaveProperty('maxhp');
        const own = parseSortieImport(ownExport());
        expect(own.replay.fleet1[0]).not.toHaveProperty('cond');
        expect(own.rows.every(row => row.rank === '' && row.dropMst === undefined)).toBe(true);
    });
});

describe('去重判定', () => {
    const base = { map: '61-3', nodes: [25, 50, 51], ts: 1_700_000_000_000, hash: 'aabbccdd' };

    it('海域或節點序列不同一律不同場', () => {
        expect(isSameSortie(base, { ...base, map: '61-4' })).toBe(false);
        expect(isSameSortie(base, { ...base, nodes: [25, 50, 52] })).toBe(false);
        expect(isSameSortie(base, { ...base, nodes: [25, 50] })).toBe(false);
    });

    it('兩邊都有封包指紋時仍受時間窗限制', () => {
        expect(isSameSortie(base, { ...base, ts: base.ts + TIME_TOLERANCE_MS })).toBe(true);
        expect(isSameSortie(base, { ...base, ts: base.ts + 86_400_000 })).toBe(false);
        expect(isSameSortie(base, { ...base, hash: '11223344' })).toBe(false);
    });

    it('任一邊沒有指紋時退回時間近似', () => {
        const noHash = { ...base, hash: null };
        expect(isSameSortie(noHash, { ...base, ts: base.ts + TIME_TOLERANCE_MS - 1 })).toBe(true);
        expect(isSameSortie(noHash, { ...base, ts: base.ts + TIME_TOLERANCE_MS + 1 })).toBe(false);
    });

    it('指紋使用完整戰鬥內容：開戰 HP 相同但實際傷害不同也能區分', () => {
        const a = [{ node: 1, data: {
            api_ship_ke: [500], api_f_nowhps: [30], api_f_maxhps: [30],
            api_e_nowhps: [90], api_e_maxhps: [90],
            api_hougeki1: { api_damage: [[10]] },
        } }];
        const b = structuredClone(a);
        (b[0].data.api_hougeki1.api_damage as number[][])[0][0] = 11;
        expect(packetHash(a)).not.toBe(packetHash(b));
        expect(packetHash(a)).toBe(packetHash(structuredClone(a)));
        expect(packetHash([])).toBeNull();
    });

    it('物件 key 排列不同但內容相同時 canonical fingerprint 相同', () => {
        const data = sample().battles[0].data;
        const reversed = Object.fromEntries(Object.entries(data).reverse());
        expect(packetHash([{ node: 25, data }])).toBe(packetHash([{ node: 25, data: reversed }]));
    });

    it('既有 replay 已裁剪時只用時間 fallback，邊界固定為含 10 分鐘', () => {
        const trimmed = { ...base, hash: null };
        expect(isSameSortie(trimmed, { ...base, ts: base.ts + TIME_TOLERANCE_MS })).toBe(true);
        expect(isSameSortie(trimmed, { ...base, ts: base.ts + TIME_TOLERANCE_MS + 1 })).toBe(false);
    });
});

describe('落地', () => {
    it('格式錯誤在任何 DB 寫入前拒絕，不留下 event reservation、sortie 或 replay', async () => {
        const database = createDb();
        const malformed = sample();
        malformed.fleet1[0].level = 0;

        expect(() => parseSortieImport(malformed)).toThrow(SortieImportError);
        expect(await database.events.count()).toBe(0);
        expect(await database.sorties.count()).toBe(0);
        expect(await database.replays.count()).toBe(0);
        expect(await database.events.add({ ts: 1, path: 'api_mock/after_reject', api: {}, req: {} })).toBe(1);
    });

    it('寫入 replays＋sorties，並從 events key generator 借號（不留 raw event）', async () => {
        const database = createDb();
        const parsed = parseSortieImport(sample());
        const sortieKey = await importSortie(database, parsed);

        expect(await database.events.count()).toBe(0);      // 借號用的探針不得留下
        const replay = await database.replays.get(sortieKey);
        expect(replay?.imported).toBe(true);
        const rows = await database.sorties.toArray();
        expect(rows).toHaveLength(parsed.rows.length);
        expect(rows.every(r => r.sortieKey === sortieKey)).toBe(true);
        expect(new Set(rows.map(r => r.eventId)).size).toBe(rows.length);   // eventId 不得重複
        expect(rows.every(r => r.eventId > sortieKey)).toBe(true);

        // 借過的號不會再被未來的 raw event 用到（generator 只前進）
        const nextId = await database.events.add({ ts: 1, path: 'api_port/port', api: {}, req: {} });
        expect(nextId).toBeGreaterThan(Math.max(...rows.map(r => r.eventId)));
    });

    it('同一份 JSON 匯入兩次 → 第二次拋「已存在」且不寫入任何東西', async () => {
        const database = createDb();
        await importSortie(database, parseSortieImport(sample()));
        const before = await database.sorties.count();

        await expect(importSortie(database, parseSortieImport(sample())))
            .rejects.toBeInstanceOf(SortieImportDuplicateError);

        expect(await database.sorties.count()).toBe(before);
        expect(await database.replays.count()).toBe(1);
        expect(await database.events.count()).toBe(0);
    });

    it('已由本機擷取過的同一場（摘要＋重播俱在）也判為已存在', async () => {
        const database = createDb();
        const parsed = parseSortieImport(sample());
        // 模擬「本機擷取」：同樣的封包，但 event id 來自正常 ingestion
        const captured: ReplayRow = { ...parsed.replay, sortieKey: 900, ts: parsed.signature.ts + 30_000 };
        await database.replays.put(captured);
        await database.sorties.bulkPut(parsed.rows.map((row, i) => ({
            ...row, sortieKey: 900, eventId: 901 + i, rank: 'S',
        }) as SortieLogRow));

        await expect(importSortie(database, parsed)).rejects.toBeInstanceOf(SortieImportDuplicateError);
    });

    it('KC3Kai 與 Fleet Chronometer 自身匯出在時間窗內可跨格式判為同一場', async () => {
        const database = createDb();
        const kc3 = parseSortieImport(sample());
        await importSortie(database, kc3);
        const ownJson = toKc3Replay({
            ...kc3.replay, sortieKey: 999, ts: kc3.signature.ts + 30_000,
        });
        const own = parseSortieImport(ownJson);
        expect(own.format).toBe('fleet-chronometer');
        expect(own.signature.hash).toBe(kc3.signature.hash);
        await expect(importSortie(database, own)).rejects.toBeInstanceOf(SortieImportDuplicateError);
        expect(await database.replays.count()).toBe(1);
    });

    it('同海域同路線但內容不同的另一場可以匯入（不是重複）', async () => {
        const database = createDb();
        const first = parseSortieImport(sample());
        await importSortie(database, first);

        const other = sample();
        other.time += 60;                                     // 同一去重時間窗內
        other.battles[0].data.api_hougeki1.api_damage[0][0] += 1; // 開戰 HP 相同，但完整戰鬥結果不同
        const second = parseSortieImport(other);
        expect(second.signature.hash).not.toBe(first.signature.hash);

        const key = await importSortie(database, second);
        expect(key).toBeGreaterThan(0);
        expect(await database.replays.count()).toBe(2);
    });

    it('相隔一天但 map／route／完整封包相同，視為不同出擊', async () => {
        const database = createDb();
        const first = parseSortieImport(sample());
        await importSortie(database, first);
        const nextDay = sample();
        nextDay.time += 86_400;
        nextDay.battles.forEach((battle: any) => { battle.time += 86_400; });
        const second = parseSortieImport(nextDay);
        expect(second.signature.hash).toBe(first.signature.hash);
        await expect(importSortie(database, second)).resolves.toBeGreaterThan(0);
        expect(await database.replays.count()).toBe(2);
    });

    it('成功匯入的 sorties／replay 可通過完整 backup 驗證並在新 DB 完成 roundtrip', async () => {
        const source = createDb();
        await importSortie(source, parseSortieImport(sample()));
        const envelope = await buildFullEnvelope(source);
        expect(() => validateBackupEnvelope(envelope)).not.toThrow();

        const target = createDb();
        await restoreBackup(target, envelope);
        expect(await target.sorties.toArray()).toEqual(await source.sorties.toArray());
        expect(await target.replays.toArray()).toEqual(await source.replays.toArray());
        expect(await target.events.count()).toBe(0);
    });
});
