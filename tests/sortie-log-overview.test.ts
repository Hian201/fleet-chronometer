// 出擊紀錄分區的 HTML 產出驗證（無 DOM，同 ships-overview／equipment-overview 的作法：
// 只測「純字串產出」的部分，事件與 DOM 綁定留給實際使用）。
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import type { ReplayRow, ReplayShip, SortieLogRow } from '../utils/db';
import { buildSortieDetail } from '../utils/sortie-detail';
import { battleLogHtml, detailHtml, fleetKindKey, headHtml, shellHtml, type Entry } from '../entrypoints/overview/sections/sortie-log';
import { setLang, t } from '../utils/ui-i18n';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const sample = JSON.parse(readFileSync(new URL('../samples/61-3.json', import.meta.url), 'utf8'));

const state = new GameState();
const shipMst = (name: string) => master.api_mst_ship.find((s: any) => s.api_name === name).api_id as number;

let YUKIKAZE = 0;
let SHIGURE = 0;
let HIBIKI = 0;

beforeAll(() => {
    setLang('zh-TW');
    state.applyEvent('api_start2/getData', master);
    YUKIKAZE = shipMst('雪風');
    SHIGURE = shipMst('時雨');
    HIBIKI = shipMst('響');
});

const battles = sample.battles.map((b: any) => ({ node: b.node, data: b.data, yasen: b.yasen ?? undefined }));

const ship = (mst: number, lv = 99): ReplayShip => ({
    mst_id: mst, lv, equip: [], stars: [], ace: [], exequip: -1, nowhp: 32, maxhp: 32, cond: 49,
});

const replay = (): ReplayRow => ({
    sortieKey: 500, ts: 1_700_000_000_000, world: 61, mapnum: 3, diff: 4,
    combined: 1, fleetnum: 1,
    fleet1: [ship(YUKIKAZE)],
    fleet2: [],
    fleet3: [ship(SHIGURE, 80)],
    fleet4: [ship(HIBIKI, 70)],
    lbas: [{
        areaId: 61, rid: 1, action: 1, distance: 8,
        squadrons: [
            { mst: 1, count: 18, maxCount: 18, stars: 4, ace: 7, state: 1, cond: 1 },
            { mst: 0, count: 0, maxCount: 18, stars: 0, ace: 0, state: 0, cond: 1 },
        ],
    }],
    battles,
});

const rows = (): SortieLogRow[] => battles.map((b: any, i: number) => ({
    eventId: 100 + i, sortieKey: 500, ts: 1_700_000_000_000 + i,
    map: '61-3', node: b.node, boss: b.node === 53, kind: 'battle' as const,
    rank: b.node === 53 ? 'A' : 'S', seiku: null,
    enemyIds: (b.data.api_ship_ke ?? []).filter((v: number) => v > 0),
    enemyIdsEscort: (b.data.api_ship_ke_combined ?? []).filter((v: number) => v > 0),
    drop: b.node === 53 ? '<b>試作艦</b>' : null,
    taiha: false,
}));

const entry = (over: Partial<Entry> = {}): Entry => ({
    key: 500, nth: 3, ts: 1_700_000_000_000, map: '61-3', world: 61, mapnum: 3,
    event: true, rows: rows(), replay: replay(), ...over,
});

describe('摺疊列', () => {
    it('依序顯示第幾次、關卡代號（活動＝E{n}＋難度）、編成成員與節點軌跡', () => {
        const html = headHtml(entry(), state, false);
        expect(html).toContain('>#3<');
        expect(html).toContain('E3');
        expect(html).toContain(t('ov.slDiff4'));        // 甲
        expect(html).toContain(state.shipName(YUKIKAZE));
        // 節點軌跡：五個節點各一顆藥丸，boss 節點帶 boss class
        expect(html.match(/class="sl-pill[ "]/g)).toHaveLength(5);
        expect(html).toContain('sl-pill boss');
        // 夜戰接續的節點（61-3 的 53）帶記號
        expect(html).toContain('☾');
        expect(html).toContain('aria-expanded="false"');
    });

    it('一般海域顯示原本的關卡代號，且不畫難度徽章', () => {
        const html = headHtml(entry({ map: '6-5', world: 6, mapnum: 5, event: false, replay: undefined }), state, true);
        expect(html).toContain('6-5');
        expect(html).not.toContain(t('ov.slDiff4'));
        expect(html).toContain(t('ov.slNoFleet'));      // 無重播＝無編成快照
        expect(html).toContain('aria-expanded="true"');
    });

    it('掉落等封包字串一律逸出，不得直接進 DOM', () => {
        const html = headHtml(entry(), state, false);
        expect(html).toContain('&lt;b&gt;試作艦&lt;/b&gt;');
        expect(html).not.toContain('<b>試作艦');
    });
});

describe('展開內容', () => {
    it('編成、支援艦隊、基地航空隊與逐節點作戰資訊都在', () => {
        const detail = buildSortieDetail(rows(), replay());
        const html = detailHtml(detail, replay(), state);
        expect(html).toContain(t('ov.slFleet'));
        expect(html).toContain(t('ov.slSupport'));
        expect(html).toContain(t('ov.slSupportShell'));   // 61-3 boss 為砲擊系支援
        expect(html).toContain(t('ov.slLbas'));
        expect(html).toContain(t('ov.slBaseN', { n: 1 }));
        expect(html).toContain(t('ov.slBaseN', { n: 2 }));
        // 節點卡五張，boss 那張有 rank 與敵隨伴
        expect(html.match(/class="sl-node[ "]/g)).toHaveLength(5);
        expect(html).toContain(t('sortie.escortFleet'));
        expect(html).toContain(t('ov.replayCopy'));
        expect(html).toContain('data-replay-open="500"');
        expect(html).toContain(t('ov.replayOpen'));
        expect(html).toContain('data-battle-log="500"');
        expect(html).toContain(t('ov.slBattleLog'));
    });

    it('沒有重播時只給摘要，並明講原因（不假裝那些資訊不存在）', () => {
        const detail = buildSortieDetail(rows());
        const html = detailHtml(detail, undefined, state);
        expect(html).toContain(t('ov.slNoPacket'));
        expect(html).not.toContain(t('ov.slLbas'));
        expect(html).not.toContain(t('ov.replayCopy'));
        expect(html.match(/class="sl-node[ "]/g)).toHaveLength(5);   // 節點序列仍在
    });

    it('舊紀錄沒有支援艦隊快照時：api_ship_id 是艦實例 id，查不到就顯示 #id，不猜 master', () => {
        const legacy: ReplayRow = { ...replay(), fleet3: undefined, fleet4: undefined };
        const html = detailHtml(buildSortieDetail(rows(), legacy), legacy, state);
        expect(html).toContain('#64812');   // 61-3 boss 支援艦隊的第一艘實例 id
        expect(html).toContain(t('ov.slSupportNoSnapshot'));
    });
});

describe('展開內容（KC3Kai 級的資訊密度）', () => {
    it('四支艦隊各一欄：主力／護衛／道中支援／決戰支援，支援欄用出擊當下的快照', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(rows(), r), r, state);
        expect(html).toContain(t('ov.slMainFleet'));
        expect(html).toContain(t('ov.slEscortFleet'));      // combined=1 才畫
        expect(html).toContain(t('ov.slRouteSupport'));
        expect(html).toContain(t('ov.slBossSupport'));
        // 第3艦隊在 25/51（道中）、第4艦隊在 53（boss）——名字取自快照而非現有鎮守府
        expect(html).toContain(state.shipName(SHIGURE));
        expect(html).toContain(state.shipName(HIBIKI));
    });

    it('基地航空隊用出擊快照（含未配置格與行動、半徑）', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(rows(), r), r, state);
        expect(html).toContain(t('ov.slBaseN', { n: 1 }));
        expect(html).toContain(t('lbas.sortie'));
        expect(html).toContain(t('ov.airRadius', { n: 8 }));
        expect(html).toContain(t('lbas.notDeployed'));     // state!==1 的空格仍要畫
    });

    it('節點卡帶索敵／航向／觸接／陣形與雙方機數增減', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(rows(), r), r, state);
        expect(html).toContain(t('sortie.detection'));
        expect(html).toContain(t('sortie.heading'));
        expect(html).toContain(t('sortie.contact'));
        expect(html).toContain(t('ov.slFormation'));
        expect(html).toContain(t('sortie.ourSide'));
        expect(html).toContain(t('sortie.enemySide'));
    });

    it('交戰記錄包含路線、HP 時間線、交戰階段與航空／支援資料', () => {
        const r = replay();
        const html = battleLogHtml(buildSortieDetail(rows(), r), state);
        expect(html).toContain(t('ov.slBattleKicker'));
        expect(html).toContain(t('ov.slBattleHpTimeline'));
        expect(html).toContain(t('ov.slBattlePhases'));
        expect(html).toContain(t('ov.slBattlePlaneLoss'));
        expect(html).toContain(t('ov.slBattleLbasWaves'));
        expect(html).toContain(t('ov.slBattleSupportComposition'));
        expect(html).toContain(t('ov.slBattleUnresolvedSource'));
        expect(html).toContain('sl-battle-phase-details');
        expect(html).not.toContain(`<h3>${t('ov.slBattleCombatSupport')}</h3>`);
        expect(html).not.toContain('<details class="sl-battle-phase-details" open>');
        expect(html).toContain(t('ov.slPhaseLandBase'));
        expect(html).toContain(t('ov.slPhaseSupportShell'));
        expect(html).toContain(t('sortie.airBattle'));
        expect(html).toContain(t('ov.slBattleEnemyFleet'));
        expect(html).toContain(t('ov.slBattleAfterDay'));
        expect(html).toContain('data-battle-node="0"');
        expect(html).toContain('data-battle-node="1"');
        expect(html).toContain('data-battle-node-panel="0"');
        expect(html).toContain('data-battle-node-panel="1"');
        expect(html).toContain('<details class="sl-battle-panel sl-battle-hp-panel">');
        expect(html).toContain('sl-battle-event');
        expect(html).toContain(`<strong class="sl-battle-attacker-name">${state.shipName(2322)} #1</strong>`); // 61-3 node25 砲擊支援
        expect(html).toContain(t('ov.slAttackDayCutIn'));          // api_at_type=6：水偵＋主砲
        expect(html).toContain(t('ov.slAttackCarrierCutIn'));      // api_at_type=7：艦爆／艦攻
        expect(html).toContain(t('ov.slAttackNightDouble'));      // api_sp_list=1
        expect(html).toContain(t('ov.slAttackTorpedoCutIn'));     // api_sp_list=3
        expect(html).not.toContain(t('ov.slBattleOurAttacks'));
        expect(html).not.toContain(t('ov.slBattleFriendlyAttacks'));
        expect(html).not.toContain(t('ov.slBattleEnemyAttacks'));
        expect(html).toContain('sl-battle-attack-group');
        expect(html).toContain('sl-battle-combat-row');
        expect(html).toContain('sl-battle-combat-arrow');
        expect(html).toContain('sl-battle-targets');
        expect(html).toContain('sl-battle-hits');
        expect(html).toMatch(/造成 \d+ 傷害、造成 \d+ 傷害/);
        expect(html).not.toContain(t('ov.slBattleUnknownTarget'));
        expect(html).not.toContain('sl-battle-event-flow');
        const groupedAttacks = html.match(/class="sl-battle-attack-group sl-battle-event sl-battle-attack-group-/g)?.length ?? 0;
        const separatedHits = html.match(/class="sl-battle-hit/g)?.length ?? 0;
        expect(separatedHits).toBeGreaterThan(groupedAttacks);
        const shelling1Start = html.indexOf('data-battle-phase="shelling1"');
        const shelling2Start = html.indexOf('data-battle-phase="shelling2"', shelling1Start + 1);
        const shelling1 = html.slice(shelling1Start, shelling2Start > shelling1Start ? shelling2Start : undefined);
        const shelling1Sides = [...shelling1.matchAll(/sl-battle-attack-group-(player|friendly|enemy)/g)].map(m => m[1]);
        const firstEnemy = shelling1Sides.indexOf('enemy');
        expect(firstEnemy).toBeGreaterThanOrEqual(0);
        expect(shelling1Sides.indexOf('player', firstEnemy + 1)).toBeGreaterThan(firstEnemy);
        expect(html).not.toContain('敵方封包位置');
        expect(html).not.toContain('>T<i>01</i>');
    });

    it('夜戰流程標題以緊湊標籤顯示已發動的夜戰裝備', () => {
        const detail = buildSortieDetail(rows(), replay());
        const nightNode = detail.nodes.find(node => node.battle?.timeline?.phases
            .some(phase => phase.kind === 'nightShelling'));
        expect(nightNode?.battle).toBeTruthy();
        nightNode!.battle!.nightEffects = { starShell: true, nightRecon: true, searchlight: true };
        const html = battleLogHtml(detail, state);
        expect(html).toContain('sl-battle-night-effects');
        expect(html).toContain('sl-battle-night-effect');
        expect(html).toContain(t('ov.slBattleNightStarShell'));
        expect(html).toContain(t('ov.slBattleNightRecon'));
        expect(html).toContain(t('ov.slBattleNightSearchlight'));
        const nightHeadStart = html.indexOf('data-battle-phase="nightShelling"');
        const nightHead = html.slice(nightHeadStart, html.indexOf('</div>', nightHeadStart));
        expect(nightHead.indexOf('<strong>')).toBeLessThan(nightHead.indexOf('sl-battle-night-effects'));
    });

    it('MVP 解析成艦名（1-based 位置對應出擊編成）、經驗值合計顯示', () => {
        const r = replay();
        const withExtras = rows().map(row => ({ ...row, mvp: 1, getExp: 260 }));
        const html = detailHtml(buildSortieDetail(withExtras, r), r, state);
        expect(html).toContain(`MVP ${state.shipName(YUKIKAZE)}`);
        expect(html).toContain(t('ov.slExpTotal'));
        expect(html).toContain('1,300');                   // 260 × 5 節點
    });

    it('掉落有無都顯示：有掉落列艦名，結算過沒掉列「無掉落」', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(rows(), r), r, state);
        expect(html).toContain(t('ov.slDrop'));            // boss 節點有掉落
        expect(html).toContain(t('ov.slNoDrop'));          // 其餘結算過的節點
        // 摺疊列也要有（使用者要求「有無掉落船也要包含進去」）
        expect(headHtml(entry(), state, false)).toContain(t('ov.slDrop'));
        const noDrop = entry({ rows: rows().map(row => ({ ...row, drop: null })) });
        expect(headHtml(noDrop, state, false)).toContain(t('ov.slNoDrop'));
    });

    it('完全沒有結算紀錄時不顯示「無掉落」（那是不可考，不是沒掉）', () => {
        const noResult = entry({ rows: rows().map(row => ({ ...row, drop: null, rank: '' })) });
        expect(headHtml(noResult, state, false)).not.toContain(t('ov.slNoDrop'));
    });
});

describe('沒有結算資訊的紀錄（本專案 toKc3Replay 匯出的重播、或面板漏收 battleresult）', () => {
    // 注意：**KC3Kai logger 的匯出是有結算的**（rating／drop／mvp／EXP，見 sortie-import.test.ts）；
    // 這裡測的是「真的沒有結算」那條路徑。
    const importedRows = () => rows().map(row => ({ ...row, rank: '', drop: null }));

    it('rank 顯示由封包推算的「推定」值，且與確定值在樣式上分得開', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(importedRows(), r), r, state);
        expect(html).toContain('sl-rank predicted');
        expect(html).toContain(t('ov.slRankPredicted'));
        // 確定值不得帶 predicted 樣式
        const confirmed = detailHtml(buildSortieDetail(rows(), r), r, state);
        expect(confirmed).not.toContain('sl-rank predicted');
    });

    it('沒有結算就不顯示「無掉落」——那是不知道，不是沒掉', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(importedRows(), r), r, state);
        expect(html).not.toContain(t('ov.slNoDrop'));
        expect(headHtml(entry({ rows: importedRows() }), state, false)).not.toContain(t('ov.slNoDrop'));
    });

    it('掉落只存了 master id 時，用當前語言的艦名顯示（KC3Kai 匯出給的是 id）', () => {
        const r = replay();
        const mstOnly = rows().map(row => (row.node === 53
            ? { ...row, drop: null, dropMst: YUKIKAZE } : row));
        const html = detailHtml(buildSortieDetail(mstOnly, r), r, state);
        expect(html).toContain(`${t('ov.slDrop')} ${state.shipName(YUKIKAZE)}`);
        expect(headHtml(entry({ rows: mstOnly }), state, false)).toContain(state.shipName(YUKIKAZE));
    });

    it('摺疊列標示「匯入」徽章', () => {
        const marked = entry({ replay: { ...replay(), imported: true } });
        expect(headHtml(marked, state, false)).toContain(t('ov.slImported'));
        expect(headHtml(entry(), state, false)).not.toContain(t('ov.slImported'));
    });
});

describe('匯入 UI 說明', () => {
    it.each(['zh-TW', 'ja', 'en'] as const)('%s 正確區分兩種來源，且純文字不殘留 Markdown', lang => {
        setLang(lang);
        const note = t('ov.slImportNote');
        const tip = t('ov.slImportedTip');
        expect(note).toContain('Fleet Chronometer');
        expect(note).toContain('KC3Kai');
        expect(note).not.toContain('**');
        expect(tip).not.toContain('**');
        // 強制帶匯入面板驗文案；正式建置預設不顯示匯入 UI（見 utils/debug-ui.ts）
        expect(shellHtml({ includeImport: true })).not.toContain('**');
        expect(shellHtml({ includeImport: false })).not.toContain('sl-import');
        setLang('zh-TW');
    });

    it('節點提示指向實際的 map-node-letters 模組', () => {
        setLang('zh-TW');
        expect(t('ov.slNoLetterTip')).toContain('utils/map-node-letters.ts');
        expect(t('ov.slNoLetterTip')).not.toContain('map-cell-letters');
    });
});

describe('展開內容的折疊與節點標籤', () => {
    it('裝備預設折疊：艦卡是 <details> 且不帶 open，並有「全部裝備」批次鈕', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(rows(), r), r, state);
        expect(html).toContain('<details class="sl-sc">');
        expect(html).not.toContain('<details class="sl-sc" open');
        expect(html).toContain('data-open-all="gears"');
    });

    it('支援艦隊與基地航空隊預設折疊，但收合時的摘要要看得出內容', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(rows(), r), r, state);
        expect(html).toContain('<details class="sl-block sl-sec">');
        expect(html).not.toContain('<details class="sl-block sl-sec" open');
        // 摘要：支援是哪一隊、基地各自在做什麼——藏起來讓人找等於沒做
        expect(html).toContain(t('ov.slRouteSupport'));
        expect(html).toContain(t('ov.expedDeck', { n: 3 }));
        expect(html).toContain(t('lbas.sortie'));
    });

    it('節點預設折疊、依序排列，且有「全部節點」批次鈕', () => {
        const r = replay();
        const html = detailHtml(buildSortieDetail(rows(), r), r, state);
        const nodes = html.match(/<details class="sl-node[^"]*">/g) ?? [];
        expect(nodes).toHaveLength(5);
        expect(nodes.every(tag => !tag.includes('open'))).toBe(true);
        expect(html).toContain('data-open-all="nodes"');
    });

    it('連合艦隊顯示編成類型（水上／空母／輸送護衛）', () => {
        const surface: ReplayRow = { ...replay(), combined: 2 };
        expect(detailHtml(buildSortieDetail(rows(), surface), surface, state)).toContain(t('ov.slCombinedSurface'));
        const carrier: ReplayRow = { ...replay(), combined: 1 };
        expect(detailHtml(buildSortieDetail(rows(), carrier), carrier, state)).toContain(t('ov.slCombinedCarrier'));
        const transport: ReplayRow = { ...replay(), combined: 3 };
        expect(detailHtml(buildSortieDetail(rows(), transport), transport, state)).toContain(t('ov.slCombinedTransport'));
        const single: ReplayRow = { ...replay(), combined: 0 };
        expect(detailHtml(buildSortieDetail(rows(), single), single, state)).not.toContain(t('ov.slCombinedSurface'));
    });

    it('有對照的海域顯示節點字母，沒有的顯示原始編號並說明原因', () => {
        // 61-5 有對照（edge 1=A、55=ZZ）
        const r615: ReplayRow = { ...replay(), world: 61, mapnum: 5 };
        const rows615 = rows().map(row => ({ ...row, map: '61-5', node: row.node === 25 ? 1 : 55 }));
        const html = detailHtml(buildSortieDetail(rows615, r615), r615, state);
        expect(html).toContain('>A<');
        expect(html).toContain('>ZZ<');
        expect(html).not.toContain(t('ov.slNoLetter'));
        expect(headHtml(entry({ map: '61-5', mapnum: 5, rows: rows615 }), state, false)).toContain('>A<');

        // 沒有收錄的海域 → 數字＋說明（活動剛開、對照表還沒更新時的情況）
        const unknown: ReplayRow = { ...replay(), world: 99, mapnum: 9 };
        const rowsUnknown = rows().map(row => ({ ...row, map: '99-9' }));
        const plain = detailHtml(buildSortieDetail(rowsUnknown, unknown), unknown, state);
        expect(plain).toContain(t('ov.slNoLetter'));
        expect(plain).toContain('>25<');
    });
});

describe('摺疊列的編成顯示（只放旗艦＋編制）', () => {
    it('只顯示旗艦，隨伴與其餘成員不進 banner（完整名單留在展開）', () => {
        const r: ReplayRow = { ...replay(), fleet2: [ship(SHIGURE, 90)] };
        const html = headHtml(entry({ replay: r }), state, false);
        expect(html).toContain(state.shipName(YUKIKAZE));      // 旗艦
        expect(html).not.toContain(state.shipName(SHIGURE));   // 隨伴不列
        // 展開區才有完整編成
        expect(detailHtml(buildSortieDetail(rows(), r), r, state)).toContain(state.shipName(SHIGURE));
    });

    it('標示艦隊編制：連合三種＋遊撃部隊＋單艦隊', () => {
        expect(fleetKindKey(1, 6)).toBe('ov.slCombinedCarrier');
        expect(fleetKindKey(2, 6)).toBe('ov.slCombinedSurface');
        expect(fleetKindKey(3, 6)).toBe('ov.slCombinedTransport');
        // combined=0 但主隊 7 艘 ⇒ 遊撃部隊（只有遊撃部隊艦隊司令部做得到，是封包事實）
        expect(fleetKindKey(0, 7)).toBe('ov.slStrikingForce');
        expect(fleetKindKey(0, 6)).toBe('ov.slSingleFleet');

        const strike: ReplayRow = { ...replay(), combined: 0, fleet1: Array.from({ length: 7 }, () => ship(YUKIKAZE)) };
        expect(headHtml(entry({ replay: strike }), state, false)).toContain(t('ov.slStrikingForce'));
    });

    it('基地空襲節點掛上空襲警報圖示（藥丸與節點卡都要）', () => {
        const raidRow: SortieLogRow = {
            ...rows()[0], kind: 'raid', node: 40, rank: '', seiku: 2, raidLostKind: 2,
            enemyIds: [], enemyIdsEscort: [],
        };
        const r = replay();
        expect(headHtml(entry({ rows: [raidRow, ...rows()] }), state, false)).toContain('/icons/ui/airraid.svg');
        expect(detailHtml(buildSortieDetail([raidRow, ...rows()], r), r, state)).toContain('/icons/ui/airraid.svg');
    });
});
