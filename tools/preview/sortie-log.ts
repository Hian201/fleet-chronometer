// 出擊紀錄分區的**離線版面預覽產生器**（開發用，不進擴充 bundle）。
//
// 為什麼需要它：這個分區的資訊密度是靠真實資料撐起來的（12 艘編成、4 波基地航空隊、
// 12 隻敵艦…），用手捏的假資料看不出真正的版面問題。本腳本拿 `samples/` 的 KC3Kai
// logger 匯出（本身就是原封的 kcsapi 戰鬥封包＋艦隊/基地航空隊快照）轉成本專案的
// ReplayRow／SortieLogRow，套 overview 的同一份 CSS，輸出一個純靜態 HTML 供瀏覽器檢視。
// **完全離線、不連遊戲、不需要登入**（帳號安全紅線，見 CLAUDE.md 設計原則 1）。
//
//   npx vite-node tools/preview/sortie-log.ts
//   → .preview/sortie-log.html（可直接用瀏覽器開，或用 headless Chrome 截圖）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GameState } from '../../utils/state';
import type { ReplayLbas, ReplayRow, ReplayShip, SortieLogRow } from '../../utils/db';
import {
    buildSortieDetail, groupSorties, isEventWorld, numberSorties, parseMapCode,
    planEventMapFilter,
} from '../../utils/sortie-detail';
import { battleLogHtml, detailHtml, headHtml, shellHtml, type Entry } from '../../entrypoints/overview/sections/sortie-log';
import { eventDisplayName, eventFilterSelectHtml, eventTermForFilter, mapFilterSelectHtml } from '../../entrypoints/overview/lib';
import { parseSortieImport } from '../../utils/sortie-import';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const master = readJson('samples/start2-master.json');
const shipMaster = new Map<number, any>(master.api_mst_ship.map((s: any) => [s.api_id, s]));

const state = new GameState();
state.applyEvent('api_start2/getData', master);
setLang('zh-TW');

/** KC3Kai 匯出的艦（mst_id/level/morale…）→ 本專案 ReplayShip。HP 由 master 補齊。 */
function toShip(s: any): ReplayShip {
    const maxhp = shipMaster.get(s.mst_id)?.api_taik?.[0] ?? 30;
    return {
        mst_id: s.mst_id, lv: s.level ?? 1,
        equip: s.equip ?? [], stars: s.stars ?? [], ace: s.ace ?? [],
        exequip: s.exequip ?? -1,
        nowhp: maxhp, maxhp, cond: s.morale ?? 49,
    };
}

function toLbas(sample: any): ReplayLbas[] {
    return (sample.lbas ?? []).map((b: any) => ({
        areaId: sample.world, rid: b.rid, action: b.action ?? 0, distance: b.range ?? 0,
        squadrons: (b.planes ?? []).map((p: any) => ({
            mst: p.mst_id ?? 0, count: p.count ?? 0, maxCount: p.max_count ?? 0,
            stars: p.stars ?? 0, ace: p.ace ?? 0, state: p.state ?? 1, cond: p.morale ?? 1,
        })),
    }));
}

function toReplay(sample: any, sortieKey: number): ReplayRow {
    return {
        sortieKey, ts: (sample.time ?? Date.now() / 1000) * 1000,
        world: sample.world, mapnum: sample.mapnum, diff: sample.diff,
        combined: sample.combined, fleetnum: sample.fleetnum,
        fleet1: (sample.fleet1 ?? []).map(toShip),
        // 單艦隊出擊時本專案的 ReplayRow.fleet2 為空（見 replay.ts startReplay），
        // 預覽也要照做，否則會看到不可能出現的「單艦隊卻有隨伴」版面。
        fleet2: sample.combined > 0 ? (sample.fleet2 ?? []).map(toShip) : [],
        fleet3: (sample.fleet3 ?? []).map(toShip),
        fleet4: (sample.fleet4 ?? []).map(toShip),
        lbas: toLbas(sample),
        // KC3Kai 對沒有夜戰的節點寫 `"yasen": {}`（空物件是 truthy）——同 sortie-import 的判準，
        // 要求至少一個 api_ 欄位，否則每個節點都會被標成夜戰。
        battles: sample.battles.map((b: any) => ({
            node: b.node, data: b.data,
            yasen: Object.keys(b.yasen ?? {}).some((k: string) => k.startsWith('api_')) ? b.yasen : undefined,
        })),
    };
}

/** 由 replay 反推「摘要列」，模擬 EventProjector 歸檔的結果（含新欄位）。 */
function toRows(replay: ReplayRow, opts: { boss: number; drop?: string; exp?: number }): SortieLogRow[] {
    return replay.battles.map((b, i) => {
        const api: any = b.data;
        const boss = b.node === opts.boss;
        return {
            eventId: replay.sortieKey + 1 + i, sortieKey: replay.sortieKey, ts: replay.ts + i * 60000,
            map: `${replay.world}-${replay.mapnum}`, node: b.node, boss,
            kind: 'battle' as const,
            rank: boss ? 'A' : 'S',
            seiku: api.api_kouku?.api_stage1?.api_disp_seiku ?? null,
            enemyIds: (api.api_ship_ke ?? []).filter((v: number) => v > 0),
            enemyIdsEscort: (api.api_ship_ke_combined ?? []).filter((v: number) => v > 0),
            drop: boss ? (opts.drop ?? null) : null,
            taiha: false,
            getExp: boss ? (opts.exp ?? 3520) : 260,
            mvp: 1 + (i % 6),
            enemyName: boss ? '深海任務部隊 主力群' : undefined,
        } as SortieLogRow;
    });
}

// 三筆情境：活動甲（連合＋支援＋基地）／活動甲（單艦隊）／舊紀錄（只有摘要、無重播）
const s613 = readJson('samples/61-3.json');
const s614 = readJson('samples/61-4.json');
// 61-5 有節點字母對照（由 utils/map-node-letters.ts 查詢），拿來看字母顯示
const s615 = readJson('samples/61-5-jibun-rengou-node52.json');
const replays = [toReplay(s613, 1000), toReplay(s614, 2000), toReplay(s615, 5000)];
const allRows = [
    ...toRows(replays[0], { boss: 53, drop: '雪風' }),
    ...toRows(replays[1], { boss: 55 }),
    ...toRows(replays[2], { boss: 55, drop: '天霧' }),
    // 無重播的舊紀錄（只有摘要）
    ...toRows(toReplay(s614, 3000), { boss: 55, drop: '' }).map(r => ({ ...r, sortieKey: 3000, getExp: undefined })),
];

// 第四種情境：由單場 JSON 匯入（走真正的 parseSortieImport，看得到「匯入」徽章、
// KC3Kai 匯出自帶的結算資訊（rank／掉落／MVP／經驗值），以及掉落艦名的解析）
const importedSample = readJson('samples/61-5-jibun-rengou-node52.json');
importedSample.time = Math.floor(Date.now() / 1000) - 86400;
const imported = parseSortieImport(importedSample, { shipName: mst => state.shipName(mst) });
const importedKey = 4000;
imported.replay.sortieKey = importedKey;
imported.rows.forEach((row, i) => { row.sortieKey = importedKey; row.eventId = importedKey + 1 + i; });
allRows.push(...imported.rows);

const groups = groupSorties(allRows.sort((a, b) => a.eventId - b.eventId));
const nth = numberSorties(groups);
const replayByKey = new Map([...replays, imported.replay].map(r => [r.sortieKey, r]));

const cards = groups.slice().reverse().map(g => {
    const first = g.rows[0];
    const replay = replayByKey.get(g.sortieKey);
    const entry: Entry = {
        key: g.sortieKey, nth: nth.get(g.sortieKey) ?? 0, ts: first.ts, map: first.map,
        world: Number(first.map.split('-')[0]), mapnum: Number(first.map.split('-')[1]),
        event: true, rows: g.rows, replay,
    };
    const detail = buildSortieDetail(g.rows, replay);
    return `<article class="sl-card">
        <div class="sl-row">${headHtml(entry, state, true)}
            <button type="button" class="ov-btn pin">☆</button></div>
        <div class="sl-detail">${detailHtml(detail, replay, state)}</div>
    </article>`;
}).join('');

const catalog = groups.map(g => {
    const parsed = parseMapCode(g.rows[0].map);
    return { map: g.rows[0].map, world: parsed.world, mapnum: parsed.mapnum, event: isEventWorld(parsed.world) };
});
const filterPlan = planEventMapFilter(catalog, {
    category: 'event',
    eventFilter: 'all',
    mapFilter: 'all',
    pinLatestEvent: true,
    worldLabel: world => eventDisplayName(world, state.masterMapAreas.get(world)),
    eventTerm: eventTermForFilter,
    normalGroupLabel: t('ov.slCatNormal'),
});

// 工具列與匯入面板用分區自己的 markup（同一份，不另抄），並把匯入面板攤開來看
// 預覽強制帶匯入面板（版面驗收用）；正式建置的 overview 預設不顯示（見 debug-ui.ts）。
const shell = shellHtml({ includeImport: true })
    .replace('<div class="sl-import" hidden>', '<div class="sl-import">')
    .replace('class="sl-inline sl-event-wrap" hidden', 'class="sl-inline sl-event-wrap"')
    .replace('<select class="sl-event-sel"></select>',
        `<select class="sl-event-sel">${eventFilterSelectHtml(filterPlan.eventGroups, filterPlan.eventFilter, t('ov.slEventAll'))}</select>`)
    .replace('<select class="sl-map-sel"></select>',
        `<select class="sl-map-sel">${mapFilterSelectHtml(filterPlan.mapGroups, filterPlan.mapFilter, t('ov.slMapAll'))}</select>`)
    .replace('<div class="sl-body ov-list"></div>', `<div class="sl-body ov-list">${cards}</div>`);

// overview 的 <style> 原封取用——預覽要驗的就是那份 CSS 在真實資料下的樣子
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
// 圖示是 root-relative（擴充內為 /icons/…），預覽走 file:// 故改指向 public/
const page = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<title>出擊紀錄版面預覽</title><style>${css}</style></head>
<body><main id="content" style="padding:16px">${shell}</main></body></html>`
    .replace(/src="\/icons\//g, `src="${resolve(root, 'public/icons')}/`);

mkdirSync(resolve(root, '.preview'), { recursive: true });
const out = resolve(root, '.preview/sortie-log.html');
writeFileSync(out, page);
// 亮色主題也要看——本專案兩套主題都要能讀（design-guidelines §1.1）
const light = resolve(root, '.preview/sortie-log-light.html');
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log(out);
console.log(light);

// 單獨輸出交戰記錄對話框，讓瀏覽器檢查可以直接看到逐筆攻擊資料，不必依賴靜態預覽的事件綁定。
const battlePreviewReplay = {
    ...replays[2],
    battles: replays[2].battles.filter(b => b.node === 55),
};
const battlePreviewDetail = buildSortieDetail(
    toRows(battlePreviewReplay, { boss: 55, drop: '天霧' }), battlePreviewReplay,
);
const battleMarkup = battleLogHtml(battlePreviewDetail, state);
const battlePage = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<title>交戰記錄版面預覽</title><style>${css}</style></head>
<body><dialog class="sl-battle-dialog" open aria-labelledby="sl-battle-preview-title">
    <div class="sl-battle-dialog-shell">
        <header class="sl-battle-dialog-head"><h2 id="sl-battle-preview-title">交戰記錄</h2>
            <button type="button" class="ov-btn icon sl-battle-close" aria-label="關閉交戰記錄"><span aria-hidden="true"></span></button>
        </header>
        <div class="sl-battle-dialog-body">${battleMarkup}</div>
    </div>
</dialog></body></html>`
    .replace(/src="\/icons\//g, `src="${resolve(root, 'public/icons')}/`);
const battleOut = resolve(root, '.preview/sortie-battle-log.html');
const battleLight = resolve(root, '.preview/sortie-battle-log-light.html');
writeFileSync(battleOut, battlePage);
writeFileSync(battleLight, battlePage.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log(battleOut);
console.log(battleLight);
