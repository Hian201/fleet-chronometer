// 出擊紀錄：db.sorties 全歷史（面板「紀錄」分頁的完整版）＋每次出擊的 KC3Kai battleplayer
// 重播匯出（資料在 db.replays）。
//
// ── 版面契約 ──────────────────────────────────────────────────────────
// 一次出擊一張卡，摘要列固定呈現出擊次數、關卡、編成與節點軌跡；展開後才載入編成、支援、
// 基地航空隊與逐節點作戰資訊。這讓摘要可快速掃讀，詳細戰鬥資料也不必在進入分區時全部解析。
//
//   摺疊列（一次出擊一列，兩行）：
//     行1　#第幾次 ・ 關卡代號（活動顯示 E{n}＋難度）・ 出擊編成成員 ・ 展開箭頭
//     行2　節點軌跡（一個節點一顆藥丸，rank 上色／boss／夜戰／空襲各有記號）・ 結果標記
//   展開　編成（含裝備圖示）／支援艦隊編組／基地航空隊各波組成與制空／逐節點作戰資訊
//        （敵編成＋殘血、rank、制空、交戰形態、陣形、触接、機數、掉落）
//
// 「第幾次」是**該海域的第幾次出擊**（依時間升冪），不隨篩選變動——序號是歷史事實，
// 篩選只是視窗。活動作戰時「E3 第 7 次」比時間戳更接近玩家腦中的計數方式。
//
// 兩大分類（通常海域／活動海域）做成分段控制而非下拉：這是本分區最常切的維度，
// 有幾個選項、現在在哪一邊，不展開就該看得到（同 ships.ts 的分段控制取捨）。
// 活動側再拆「哪一次活動」與「該活動第幾關」：歷次活動各自一組 En，關卡數跟紀錄走。
//
// ── 資料來源與分工 ────────────────────────────────────────────────────
// 節點序列與勝負來自 db.sorties（摘要，永久保留）；敵艦等級／制空詳情／基地航空隊組成／
// 支援艦隊編組只存在於 db.replays 的**原始封包**裡，故沒有重播的舊出擊只會顯示摘要那半邊
// （UI 明講，不假裝那些資訊不存在）。重建邏輯全在 utils/sortie-detail.ts（純函式），
// 本檔只負責 DOM 與事件——同 ships.ts／equipment.ts 的分工。
//
// 展開時才跑 `buildSortieDetail()`（內含戰鬥重放），結果快取；摺疊列只用摘要＋快照，
// 以避免進入分區時解析整個重播層。
import type { OverviewSection, SectionContext } from './types';
import { db, type ReplayRow, type SortieLogRow } from '@/utils/db';
import {
    KC3_REPLAY_DIRECT_URL_LIMIT, KC3_REPLAY_PLAYER_URL,
    repairLegacyReplayFleet, toKc3Replay, toKc3ReplayUrl,
} from '@/utils/replay';
import {
    buildSortieDetail, diffLabel, groupSorties, isEventWorld, mapLabel,
    numberSorties, parseMapCode, planEventMapFilter, qualifiedEventMapLabel, sortieTime,
    type EventMapFilterPlan, type EventWorldFilter, type LbasWave, type NodeDetail,
    type SortieDetail, type SortieShip,
} from '@/utils/sortie-detail';
import {
    buildSortieSimulator, KC3_SORTIE_SIMULATOR_DIRECT_URL_LIMIT, KC3_SORTIE_SIMULATOR_URL,
    type SortieSimulatorInput,
} from '@/utils/sortie-simulator';
import {
    importSortie, parseSortieImport, SortieImportDuplicateError, SortieImportError,
} from '@/utils/sortie-import';
import { hasNodeLetters, nodeLabel as letterOf } from '@/utils/map-node-letters';
import { nodeKindKey } from '@/utils/map-node-kind';
import { airRaidLostKindLabel } from '@/utils/air-raid-lost-kind';
import { replayExportStem } from '@/utils/replay-card';
import {
    AIR_CALC_DIRECT_URL_LIMIT, AIR_CALC_PAGE_URL, airCalcUrl, buildReplayAirCalcDeck,
    buildReplayDeckBuilder,
} from '@/utils/deckbuilder';
import { downloadReplayPng } from '../replay-png';
import type {
    BattleDamageEvent, BattleDamageKind, BattleHpSnapshot, BattleHpView, BattleInfoView, BattlePhaseKind, BattlePhaseView,
    BattleShipView,
} from '@/utils/state';
import { t } from '@/utils/ui-i18n';
import { bindImportPanel, importPanelHtml, importToggleHtml } from '../import-panel';
import { isDebugUiEnabled } from '@/utils/debug-ui';
import {
    esc, fmtShortTs, fmtTs, downloadText, copyWithFeedback, gearIconHtml,
    eventDisplayName, eventDisplayTitle, eventFilterSelectHtml, eventTermForFilter,
    loadJsonPrefs, mapFilterSelectHtml, readEventWorldFilter, saveJsonPrefs,
} from '../lib';

const SEIKU_KEYS = ['seiku.even', 'seiku.secured', 'seiku.superior', 'seiku.inferior', 'seiku.lost'];
// 陣形 api_formation[0]/[1]：1–6 一般陣形；連合艦隊為 11–14（警戒航行序列）。
// 中間 7–10 沒有對應標籤，故留空。
const FORMATION_KEYS = [
    'form.unknown', 'form.single', 'form.double', 'form.ring', 'form.ladder', 'form.abreast', 'form.vigilant',
    '', '', '', '',
    'form.cruise1', 'form.cruise2', 'form.cruise3', 'form.cruise4',
];
const ENGAGEMENT_KEYS = ['eng.unknown', 'eng.parallel', 'eng.opposite', 'eng.tAdvantage', 'eng.tDisadvantage'];
// 基地航空隊行動（api_action_kind，同 lib.ts fleetMarkdown 的順序）
const LBAS_ACTION_KEYS = ['lbas.standby', 'lbas.sortie', 'lbas.airDefense', 'lbas.retreat', 'lbas.rest'];
// 連合艦隊編成（api_combined_flag）：1=空母機動部隊／2=水上打撃部隊／3=輸送護衛部隊。
// 2 已用真封包確認（samples/61-5-jibun-rengou-node52.json combined=2，即使用者所述的「自軍水上部隊」）。
const COMBINED_KEYS = ['', 'ov.slCombinedCarrier', 'ov.slCombinedSurface', 'ov.slCombinedTransport'];

const BATTLE_PHASE_KEYS: Record<BattlePhaseKind, string> = {
    jetBase: 'ov.slPhaseJetBase', landBase: 'ov.slPhaseLandBase', jet: 'ov.slPhaseJet', air: 'ov.slPhaseAir', airSecond: 'ov.slPhaseAirSecond',
    supportAir: 'ov.slPhaseSupportAir', supportShell: 'ov.slPhaseSupportShell', supportTorpedo: 'ov.slPhaseSupportTorpedo', supportAsw: 'ov.slPhaseSupportAsw',
    openingAntiSub: 'ov.slPhaseOpeningAntiSub', openingTorpedo: 'ov.slPhaseOpeningTorpedo',
    shelling1: 'ov.slPhaseShelling1', shelling2: 'ov.slPhaseShelling2', shelling3: 'ov.slPhaseShelling3',
    torpedo: 'ov.slPhaseTorpedo', friendlyShelling: 'ov.slPhaseFriendlyShelling',
    friendlyTorpedo: 'ov.slPhaseFriendlyTorpedo', nightShelling: 'ov.slPhaseNightShelling',
};

const BATTLE_EVENT_KEYS: Record<BattleDamageKind, string> = {
    ship: 'ov.slEventShip', torpedo: 'ov.slEventTorpedo', air: 'ov.slEventAir',
    landBase: 'ov.slEventLandBase', support: 'ov.slEventSupport',
};

const PREFS_KEY = 'kc-sortie-view';
type Category = 'all' | 'normal' | 'event';

interface Prefs { cat: Category }

function loadPrefs(): Prefs {
    const fallback: Prefs = { cat: 'all' };
    return loadJsonPrefs(PREFS_KEY, fallback, raw => {
        const cat = raw && typeof raw === 'object'
            && ((raw as { cat?: unknown }).cat === 'normal' || (raw as { cat?: unknown }).cat === 'event')
            ? (raw as { cat: Category }).cat : 'all';
        return { cat };
    });
}
const savePrefs = (p: Prefs) => { saveJsonPrefs(PREFS_KEY, p); };

/** 摺疊列用的輕量資料（不解析封包）。 */
export interface Entry {
    key: number;
    nth: number;
    ts: number;
    map: string;
    world: number;
    mapnum: number;
    event: boolean;
    rows: SortieLogRow[];
    replay?: ReplayRow;
}

const seikuLabel = (v: number | null) => (v == null ? '' : t(SEIKU_KEYS[v] ?? 'seiku.even'));

/** 基地空襲警報圖示（M7 的原創圖示族，`tools/icons/gen_ui.py`）。 */
const alertIcon = () =>
    `<img class="sl-alert" src="/icons/ui/airraid.svg" alt="${esc(t('history.raid'))}" title="${esc(t('history.raid'))}">`;

/**
 * 掉落艦名：紀錄可能只存了 master id（匯入的 KC3Kai JSON 給的是 id），
 * 此時用當前語言的艦名補上——名字是顯示層的事，不必回頭改 DB。
 */
function dropName(row: { drop: string | null; dropMst?: number }, state: SectionContext['state']): string | null {
    if (row.drop) return row.drop;
    return row.dropMst ? state.shipName(row.dropMst) : null;
}
// class 只吃白名單後綴；文字節點另走 esc（匯入／異常 rank 不得進 class）。
const rankClass = (rank: string) => {
    const suf = rank.trim().toUpperCase();
    return (suf === 'S' || suf === 'A' || suf === 'B' || suf === 'C' || suf === 'D')
        ? `rank-${suf.toLowerCase()}` : '';
};

// ── 摺疊列 ──────────────────────────────────────────────────────────────

/**
 * 艦隊編制的短標籤。連合艦隊要講明是哪一種（三者的隨伴角色完全不同）；單艦隊則要分辨
 * **遊撃部隊**——`combined===0` 但主隊有 7 艘，只有「遊撃部隊艦隊司令部」做得到，
 * 故 7 艘＝遊撃部隊是封包事實而非猜測。
 */
export function fleetKindKey(combined: number, mainCount: number): string {
    if (combined > 0) return COMBINED_KEYS[combined] || 'ov.slCombinedShort';
    return mainCount === 7 ? 'ov.slStrikingForce' : 'ov.slSingleFleet';
}

/**
 * 摺疊列的編成顯示：**只放旗艦＋編制**（使用者要求）。
 * 12 艘全名單會把整條 banner 撐成三行、還把時間與展開箭頭擠掉，而「這次帶了誰」是展開後
 * 才要逐艘看的事；banner 要回答的是「哪一隊、誰帶隊」。完整名單留在展開的出擊編成。
 */
function flagshipChip(replay: ReplayRow | undefined, state: SectionContext['state']): string {
    if (!replay?.fleet1.length) return `<span class="sl-noship">${esc(t('ov.slNoFleet'))}</span>`;
    const flag = replay.fleet1[0];
    const name = state.shipName(flag.mst_id);
    const total = replay.fleet1.length + replay.fleet2.length;
    const kind = t(fleetKindKey(replay.combined, replay.fleet1.length));
    return `<span class="sl-flagship" title="${esc(t('ov.slFlagshipTip'))}: ${esc(name)} Lv${flag.lv}">`
        + `${esc(name)}<i>${flag.lv}</i></span>`
        + `<span class="sl-fleetkind" title="${esc(t('ov.slFleetSize', { n: total }))}">${esc(kind)}</span>`;
}

/**
 * 節點標籤：有對照表就顯示攻略圈慣用的字母（A／E／ZZ…），沒有就顯示遊戲的 cell 編號。
 * 對照表是人工參照資料（遊戲不送字母，且與編號無可推導關係，見 utils/map-node-letters.ts）。
 */
const nodeLabel = (map: string, edge: number) => letterOf(map, edge);

/** 節點藥丸：rank 上色、boss 加框、空襲與夜戰各有記號。 */
function nodePill(row: SortieLogRow, night: boolean): string {
    const cls = ['sl-pill'];
    if (row.boss) cls.push('boss');
    if (row.kind === 'raid') cls.push('raid');
    if (row.rank) cls.push(rankClass(row.rank));
    const kindKey = nodeKindKey(row.nodeEventId, row.nodeEventKind);
    const tip = [
        t('ov.slNodeN', { n: nodeLabel(row.map, row.node) }),
        // 字母是查表得來的，原始 cell 編號一律留在 tooltip（對不上時才有辦法回頭查）
        nodeLabel(row.map, row.node) !== String(row.node) ? `edge ${row.node}` : '',
        kindKey ? t(kindKey) : '',
        row.kind === 'raid' ? t('history.raid') : '',
        row.rank ? `rank ${row.rank}` : '',
        row.seiku !== null ? seikuLabel(row.seiku) : '',
        row.boss ? t('sortie.boss') : '',
    ].filter(Boolean).join('・');
    const mark = row.kind === 'raid'
        ? alertIcon()
        : night ? `<b class="sl-mark" title="${esc(t('sortie.midnight'))}">☾</b>` : '';
    return `<span class="${cls.join(' ')}" title="${esc(tip)}">`
        + `<span class="sl-pill-node">${esc(nodeLabel(row.map, row.node))}</span>`
        + `${row.rank ? `<span class="sl-pill-rank">${esc(row.rank)}</span>` : ''}${mark}</span>`;
}

function eventNameOf(world: number, state: SectionContext['state']): string {
    return eventDisplayName(world, state.masterMapAreas.get(world));
}

function mapDisplayLabel(entry: Entry, qualifyEventWorld: boolean, state: SectionContext['state']): string {
    if (entry.event && qualifyEventWorld) return qualifiedEventMapLabel(entry, eventNameOf(entry.world, state));
    return mapLabel(entry);
}

function mapTitle(entry: Entry, state: SectionContext['state']): string {
    if (!entry.event) return entry.map;
    return `${eventDisplayTitle(entry.world, state.masterMapAreas.get(entry.world))}（${entry.map}）`;
}

export function headHtml(
    entry: Entry,
    state: SectionContext['state'],
    open: boolean,
    opts?: { qualifyEventWorld?: boolean },
): string {
    const nightNodes = new Set((entry.replay?.battles ?? []).filter(b => b.yasen).map(b => b.node));
    const track = entry.rows.map(r => nodePill(r, nightNodes.has(r.node))).join('<i class="sl-arrow">›</i>');
    const drops = entry.rows.map(r => dropName(r, state)).filter(Boolean) as string[];
    // 掉落**有無都要顯示**：結算過卻沒掉船就是「無掉落」，那是結果不是資料缺席；
    // 但完全沒有結算紀錄（rank 全空，例如中途撤退）時不顯示——那才是真的不知道。
    const settled = entry.rows.some(r => r.kind === 'battle' && r.rank);
    const dropFlags = drops.length
        ? drops.map(d => `<span class="sl-flag drop" title="${esc(t('sortie.dropTitle'))}">${esc(t('ov.slDrop'))} ${esc(d)}</span>`).join('')
        : settled ? `<span class="sl-flag nodrop">${esc(t('ov.slNoDrop'))}</span>` : '';
    const flags = [
        entry.rows.some(r => r.cleared) ? `<span class="sl-flag clear">${esc(t('history.cleared'))}</span>` : '',
        entry.rows.some(r => r.taiha) ? `<span class="sl-flag taiha">${esc(t('fleet.heavyDamage'))}</span>` : '',
        dropFlags,
    ].filter(Boolean).join('');
    const diff = diffLabel(entry.replay?.diff ?? 0);
    const shown = mapDisplayLabel(entry, opts?.qualifyEventWorld === true, state);
    // 匯入徽章只標示「非本機擷取」。Fleet Chronometer 自身的重播匯出通常沒有結算摘要，
    // KC3Kai logger 匯出則可能帶 rating／drop／MVP／EXP；不可由 imported 反推欄位缺席。
    const imported = entry.replay?.imported
        ? `<span class="sl-flag imported" title="${esc(t('ov.slImportedTip'))}">${esc(t('ov.slImported'))}</span>` : '';
    return `
        <button type="button" class="sl-head" aria-expanded="${open}" aria-controls="sl-d-${entry.key}">
            <span class="sl-l1">
                <span class="sl-nth" title="${esc(t('ov.slNthTip', { map: shown, n: entry.nth }))}">#${entry.nth}</span>
                <span class="sl-map${entry.event ? ' ev' : ''}" title="${esc(mapTitle(entry, state))}">${esc(shown)}${diff ? `<i>${esc(diff)}</i>` : ''}</span>
                ${imported}
                <span class="sl-fleet">${flagshipChip(entry.replay, state)}</span>
                <span class="sl-meta">
                    <span class="sl-time" title="${esc(fmtTs(entry.ts))}">${esc(fmtShortTs(entry.ts))}</span>
                    <span class="sl-caret">${open ? '▾' : '▸'}</span>
                </span>
            </span>
            <span class="sl-l2">
                <span class="sl-track">${track}</span>
                ${flags ? `<span class="sl-flags">${flags}</span>` : ''}
            </span>
        </button>`;
}

// ── 展開內容 ────────────────────────────────────────────────────────────
// 資訊密度對照 KC3Kai 的出擊紀錄展開檢視（samples/KC3kai_sortie_log.png）：
// 四支艦隊（主力／護衛／道中支援／決戰支援）＋基地航空隊三隊編成＋逐節點作戰資訊
// （敵編成、rank、索敵、航向、觸接、航空戰、雙方機數增減、MVP、經驗值、掉落）。
// 差異：節點字母走 map-node-letters 的人工對照，查不到才顯示原始 edge；「基礎經驗值」
// 只有 KC3Kai 匯入帶 baseEXP 時顯示，本機封包不含該欄位。

/** 裝備圖示列（含改修星數）。空槽不畫——編成列不需要「這格空著」的精度。 */
function gearIcons(ship: SortieShip, state: SectionContext['state']): string {
    const cells = ship.equip.map((mst, i) => {
        if (!mst || mst <= 0) return '';
        const name = state.gearName(mst);
        const star = (ship.stars[i] ?? 0) > 0 ? `<i class="sl-star">★${ship.stars[i]}</i>` : '';
        return `<span class="sl-gear" title="${esc(name)}${(ship.stars[i] ?? 0) > 0 ? ` ★${ship.stars[i]}` : ''}">${gearIconHtml(state.gearIconId(mst), name)}${star}</span>`;
    });
    if (ship.exequip > 0) {
        const name = state.gearName(ship.exequip);
        const exStar = (ship.exstars ?? 0) > 0 ? `<i class="sl-star">★${ship.exstars}</i>` : '';
        const exTitleStar = (ship.exstars ?? 0) > 0 ? ` ★${ship.exstars}` : '';
        cells.push(`<span class="sl-gear ex" title="${esc(t('ov.shipsEx'))}: ${esc(name)}${exTitleStar}">${gearIconHtml(state.gearIconId(ship.exequip), name)}${exStar}</span>`);
    }
    return cells.join('');
}

/**
 * 一艘船一張卡。**裝備預設折疊**（使用者要求）——六艘×五格圖示會把編成欄拉成一面圖示牆，
 * 平常要看的是「帶了誰、幾級、幾血」。點卡片（或用區塊標題的「裝備」鈕）才展開。
 * 用原生 `<details>`：開合狀態由瀏覽器管，不必為此在分區裡多一份 state。
 */
function shipCard(ship: SortieShip, state: SectionContext['state']): string {
    const hasHp = ship.hp !== null && ship.maxHp !== null && ship.maxHp > 0;
    const pct = hasHp ? Math.max(0, Math.min(100, Math.round(100 * ship.hp! / ship.maxHp!))) : 0;
    const ratio = hasHp ? ship.hp! / ship.maxHp! : 1;
    // 出擊當下的傷害狀態用語意色（大破/中破/小破），與面板同一組值。
    // **滿血用中性色**：出擊時滿血是常態，全部畫成綠條會讓整欄變成綠線牆，
    // 反而看不出唯一那艘帶傷出門的船。
    const col = ratio <= 0.25 ? 'var(--dmg-major)' : ratio <= 0.5 ? 'var(--dmg-mid)'
        : ratio <= 0.75 ? 'var(--dmg-minor)' : ratio < 1 ? '#58a55c' : 'var(--line)';
    const cond = ship.cond === null ? '' : ship.cond >= 50 ? ' spark' : ship.cond < 30 ? ' tired' : '';
    const gears = gearIcons(ship, state);
    const count = ship.equip.filter(mst => mst > 0).length + (ship.exequip > 0 ? 1 : 0);
    return `<details class="sl-sc">
        <summary>
            <div class="sl-sc-top">
                <span class="sl-sc-name">${esc(state.shipName(ship.mst))}</span>
                <i class="sl-sc-lv">Lv${ship.lv}</i>
                <i class="sl-sc-cond${cond}" title="${esc(t('ov.rsColCond'))}">${ship.cond ?? esc(t('cond.unknown'))}</i>
                ${count ? `<i class="sl-sc-gearn" title="${esc(t('ov.slGears'))}">${count}</i>` : ''}
            </div>
            ${hasHp
        ? `<div class="sl-hp" title="${ship.hp}/${ship.maxHp}"><i style="width:${pct}%;background:${col}"></i></div>`
        : `<div class="sl-hp unknown" title="${esc(t('ov.slHpUnknown'))}"></div>`}
        </summary>
        <div class="sl-sc-gears">${gears || `<span class="sl-dim">${esc(t('ov.slNoGear'))}</span>`}</div>
    </details>`;
}

/** 一支艦隊一欄（KC3Kai 的四欄版面）。空艦隊仍要畫欄位標題，否則看不出「這次沒帶支援」。 */
function fleetColumn(title: string, ships: SortieShip[], state: SectionContext['state'], emptyLabel: string, note = ''): string {
    return `<section class="sl-fcol${ships.length ? '' : ' empty'}">
        <h5>${esc(title)}${note ? `<i>${esc(note)}</i>` : ''}</h5>
        ${ships.length ? ships.map(s => shipCard(s, state)).join('') : `<div class="sl-dim">${esc(emptyLabel)}</div>`}
    </section>`;
}

/**
 * 支援艦隊一欄。有出擊快照（新紀錄）就畫成完整艦隊；只有封包時退回**艦實例 id** 反查
 * 目前鎮守府的艦名，查不到就顯示 #id（不猜 master）。
 */
function supportColumn(
    entry: SortieDetail['supports'][number] | undefined, title: string, state: SectionContext['state'], map = '',
): string {
    if (!entry) return fleetColumn(title, [], state, t('ov.slSupportNone'));
    // 支援種別由 api_support_flag 分類；未知旗標才依封包中存在的支援結構回退。
    const kind = t(entry.use.kind === 'air' ? 'ov.slSupportAir' : entry.use.kind === 'asw' ? 'ov.slSupportAsw' : entry.use.kind === 'torpedo' ? 'ov.slSupportTorpedo' : 'ov.slSupportShell');
    // 出動節點也要用字母（與節點列表同一套標籤，混用數字/字母會看不出是同一個節點）
    const nodes = entry.nodes.map(node => nodeLabel(map, node)).join(', ');
    const note = `${t('ov.expedDeck', { n: entry.use.deckId })}・${kind}・${t('ov.slAtNodes', { list: nodes })}`;
    if (entry.fleet) return fleetColumn(title, entry.fleet, state, t('ov.slSupportNone'), note);
    const names = entry.use.shipIds.map(id => {
        const mst = state.ships.get(id)?.api_ship_id;
        return `<span class="sl-ship">${esc(mst ? state.shipName(mst) : `#${id}`)}</span>`;
    }).join('');
    return `<section class="sl-fcol">
        <h5>${esc(title)}<i>${esc(note)}</i></h5>
        <div class="sl-ships-inline">${names}</div>
        <div class="sl-dim">${esc(t('ov.slSupportNoSnapshot'))}</div>
    </section>`;
}

/** 基地航空隊一隊一張卡（出擊當下的快照：行動＋半徑＋各中隊機種/★/機數/熟練度）。 */
function lbasCard(base: SortieDetail['lbas'][number], state: SectionContext['state']): string {
    const action = t(LBAS_ACTION_KEYS[base.action] ?? 'lbas.standby');
    const squads = base.squadrons.map(sq => {
        if (sq.state !== 1 || sq.mst <= 0) return `<div class="sl-sq empty">${esc(t('lbas.notDeployed'))}</div>`;
        const name = state.gearName(sq.mst);
        return `<div class="sl-sq" title="${esc(name)}">
            ${gearIconHtml(state.gearIconId(sq.mst), name)}
            <span class="sl-sq-name">${esc(name)}</span>
            ${sq.stars > 0 ? `<i class="sl-star">★${sq.stars}</i>` : ''}
            ${sq.ace > 0 ? `<i class="sl-ace" title="${esc(t('ov.slAce'))}">»${sq.ace}</i>` : ''}
            <i class="sl-sq-count${sq.count < sq.maxCount ? ' short' : ''}">${sq.count}/${sq.maxCount}</i>
        </div>`;
    }).join('');
    return `<section class="sl-fcol">
        <h5>${esc(t('ov.slBaseN', { n: base.rid }))}<i>${esc(action)}・${esc(t('ov.airRadius', { n: base.distance }))}</i></h5>
        ${squads}
    </section>`;
}

/** 敵艦 chip：殘血比例條（有原始封包才有戰後血量，否則只有名字）。 */
function enemyChip(mst: number, lv: number | undefined, view: BattleShipView | undefined, state: SectionContext['state']): string {
    const name = mst > 0 ? state.shipName(mst) : '?';
    const ratio = view && view.maxHp > 0 ? Math.max(0, view.hp) / view.maxHp : null;
    const pct = ratio === null ? 100 : Math.round(ratio * 100);
    const col = ratio === null ? 'var(--line)'
        : ratio <= 0 ? 'transparent'
            : ratio <= 0.25 ? 'var(--dmg-major)'
                : ratio <= 0.5 ? 'var(--dmg-mid)'
                    : ratio <= 0.75 ? 'var(--dmg-minor)' : '#58a55c';
    const sunk = !!view && view.hp <= 0;
    const tip = view ? `${name}${lv && lv > 1 ? ` Lv${lv}` : ''}　${Math.max(0, view.hp)}/${view.maxHp}` : name;
    return `<span class="sl-ec${sunk ? ' sunk' : ''}" title="${esc(tip)}">
        <span class="sl-ec-name">${esc(name)}${lv && lv > 1 ? `<i>Lv${lv}</i>` : ''}</span>
        <span class="sl-hp"><i style="width:${pct}%;background:${col}"></i></span>
    </span>`;
}

/** 陣形：一般 1–6，連合艦隊 11–14（警戒航行序列）。未知值顯示原始數字，不假裝知道。 */
function formationLabel(v: number): string {
    const key = FORMATION_KEYS[v];
    return key ? t(key) : `#${v}`;
}

/** 索敵：只分「發現／未發現」（子分類語意未驗證），原始值放 title。 */
function searchLabel(v: number | undefined): string {
    if (!Number.isSafeInteger(v as number) || (v as number) <= 0) return '—';
    return t((v as number) <= 3 ? 'ov.slSearchOk' : 'ov.slSearchNg');
}

/** 我方 vs 敵方的艦載機增減（KC3Kai 的「友方／深海方」兩欄）。 */
function planeTable(b: BattleInfoView): string {
    const p = b.planes;
    const cell = (v: { count: number; lost: number }) =>
        `<span class="sl-pl">${v.count - v.lost}<i>/${v.count}</i>${v.lost > 0 ? `<b>-${v.lost}</b>` : ''}</span>`;
    if (p.playerFighter.count + p.playerBomber.count + p.enemyFighter.count + p.enemyBomber.count === 0) return '';
    return `<div class="sl-planes">
        <span class="sl-dim">${esc(t('sortie.ourSide'))}</span>
        <span>${esc(t('sortie.fighterAbbr'))}${cell(p.playerFighter)}</span>
        <span>${esc(t('sortie.bomberAbbr'))}${cell(p.playerBomber)}</span>
        <span class="sl-dim">${esc(t('sortie.enemySide'))}</span>
        <span>${esc(t('sortie.fighterAbbr'))}${cell(p.enemyFighter)}</span>
        <span>${esc(t('sortie.bomberAbbr'))}${cell(p.enemyBomber)}</span>
    </div>`;
}

/** 該節點出擊的基地航空隊波次（一波一行：制空＋機種＋損失）。 */
function nodeLbas(waves: LbasWave[], state: SectionContext['state']): string {
    if (!waves.length) return '';
    const rows = waves.map(w => {
        const planes = w.planes.map(p =>
            `<span class="sl-gear" title="${esc(state.gearName(p.mst))}">${gearIconHtml(state.gearIconId(p.mst), state.gearName(p.mst))}<i class="sl-cnt">${p.count}</i></span>`).join('');
        return `<div class="sl-line">
            <span class="sl-tag">${esc(t('ov.slBaseN', { n: w.baseId }))}</span>
            ${w.seiku !== null ? `<span class="sl-seiku sk-${w.seiku}">${esc(seikuLabel(w.seiku))}</span>` : ''}
            <span class="sl-gears">${planes}</span>
            <span class="sl-dim">${esc(t('ov.slPlaneLoss', { lost: w.fLost, total: w.fCount, elost: w.eLost, etotal: w.eCount }))}</span>
        </div>`;
    }).join('');
    return `<div class="sl-nlbas"><span class="sl-dim">${esc(t('ov.slLbas'))}</span>${rows}</div>`;
}

function battleSupportDetails(battle: BattleInfoView, state: SectionContext['state']): string {
    const support = battle.support;
    if (!support) return '';
    return `<div class="sl-battle-support-line">
        <span class="sl-tag alt">${esc(support.kind === 'air' ? t('ov.slSupportAir') : support.kind === 'asw' ? t('ov.slSupportAsw') : support.kind === 'torpedo' ? t('ov.slSupportTorpedo') : t('ov.slSupportShell'))}</span>
        <span class="sl-dim">${esc(t('ov.expedDeck', { n: support.deckId }))}</span>
        <span>${esc(t('sortie.supportDamage', {
            kind: support.kind === 'air' ? t('sortie.supportKindAir') : support.kind === 'asw' ? t('sortie.supportKindAsw') : support.kind === 'torpedo' ? t('sortie.supportKindTorpedo') : t('sortie.supportKindShelling'),
            deck: support.deckId, damage: support.damage,
        }))}</span>
        ${support.shipIds.length ? `<span class="sl-dim">${esc(t('sortie.supportShips', { ships: supportShipNames(support.shipIds, state) }))}</span>` : ''}
    </div>`;
}

function battleFriendlyFleetDetails(battle: BattleInfoView, state: SectionContext['state']): string {
    const ids = battle.friendlyFleetIds ?? [];
    if (!ids.length) return '';
    return `<div class="sl-battle-support-line">
        <span class="sl-tag alt">${esc(t('ov.slBattleFriendlyFleet'))}</span>
        <span>${esc(ids.map(id => state.shipName(id)).join('、'))}</span>
    </div>`;
}

/** MVP：battleresult 的確定值（1-based 位置）→ 對應到出擊快照的艦名。 */
function mvpLabel(detail: SortieDetail, n: NodeDetail, state: SectionContext['state']): string {
    const pick = (fleet: SortieShip[], pos: number | undefined) =>
        (pos && fleet[pos - 1] ? state.shipName(fleet[pos - 1].mst) : pos ? `#${pos}` : '');
    const main = pick(detail.fleet1, n.mvp);
    const escort = pick(detail.fleet2, n.mvpEscort);
    const names = [main, escort].filter(Boolean).join(' / ');
    return names ? `<span class="sl-tag mvp" title="${esc(t('ov.slMvpTip'))}">MVP ${esc(names)}</span>` : '';
}

/**
 * rank：有結算就顯示確定值；沒有（匯入的紀錄、或面板漏收 battleresult）但有封包時，
 * 顯示 `analyzeBattle` 依損害率推算的**預測值**並標「推定」——虛線框與 title 都要有，
 * 不能讓推算值看起來像遊戲回傳的事實。兩者皆無才顯示「無結算」。
 */
function rankChip(n: NodeDetail): string {
    if (n.rank) return `<span class="sl-rank ${rankClass(n.rank)}">${esc(n.rank)}</span>`;
    const predicted = n.battle?.rank;
    if (predicted && predicted !== '?') {
        return `<span class="sl-rank predicted ${rankClass(predicted)}" title="${esc(t('ov.slRankPredicted'))}">${esc(predicted)}</span>`;
    }
    return `<span class="sl-dim">${esc(t('ov.slNoRank'))}</span>`;
}

/**
 * 節點類型徽章（渦潮／空襲戰／能動分歧…）。來源是封包的 `api_event_id`／`api_event_kind`，
 * 對照表在 utils/map-node-kind.ts；一般戰鬥與 boss 不標（rank 與 BOSS 徽章已經說明了）。
 */
function kindTag(n: NodeDetail): string {
    const key = nodeKindKey(n.nodeEventId, n.nodeEventKind);
    return key ? `<span class="sl-tag kind">${esc(t(key))}</span>` : '';
}

function nodeCard(detail: SortieDetail, n: NodeDetail, state: SectionContext['state']): string {
    const label = nodeLabel(detail.map, n.node);
    // 字母是查表得來的，原始 cell 編號留在 tooltip（對不上時才有辦法回頭查）
    const cellTip = label !== String(n.node) ? ` title="edge ${n.node}"` : '';
    if (n.kind === 'raid') {
        return `<article class="sl-node raid">
            <div class="sl-node-head">
                <span class="sl-pill raid"${cellTip}><span class="sl-pill-node">${esc(label)}</span></span>
                <span class="sl-tag alt raid">${alertIcon()}${esc(t('history.raid'))}</span>
                ${kindTag(n)}
                ${n.seiku !== null ? `<span class="sl-seiku sk-${n.seiku}">${esc(seikuLabel(n.seiku))}</span>` : ''}
                <span class="grow"></span>
                <span class="sl-dim">${esc(airRaidLostKindLabel(n.raidLostKind))}</span>
            </div>
        </article>`;
    }
    const b = n.battle;
    const seiku = b && b.planes.playerFighter.count + b.planes.enemyFighter.count > 0 ? b.seiku : n.seiku;
    const eMain = b?.resultFleets?.enemyMain ?? [];
    const eEsc = b?.resultFleets?.enemyEscort ?? [];
    const enemies = (label2: string, ids: number[], lvs: number[], views: BattleShipView[]) => ids.length
        ? `<div class="sl-ecol"><span class="sl-dim">${esc(label2)}</span>
             <span class="sl-ecs">${ids.map((id, i) => enemyChip(id, lvs[i], views[i], state)).join('')}</span></div>`
        : '';
    const stat = (label2: string, value: string, cls = '', tip = '') =>
        `<span class="sl-st${cls ? ' ' + cls : ''}"${tip ? ` title="${esc(tip)}"` : ''}><i>${esc(label2)}</i>${esc(value)}</span>`;
    const stats: string[] = [];
    if (b) {
        stats.push(stat(t('sortie.detection'), searchLabel(n.search[0]),
            (n.search[0] ?? 0) > 3 ? 'bad' : '', t('ov.slSearchTip', { own: n.search[0] ?? '?', enemy: n.search[1] ?? '?' })));
        stats.push(stat(t('sortie.heading'), t(ENGAGEMENT_KEYS[b.formation[2]] ?? 'eng.unknown'), b.formation[2] === 4 ? 'bad' : ''));
        stats.push(stat(t('sortie.contact'),
            `${b.touchPlane[0] > 0 ? t('sortie.yes') : t('sortie.no')} / ${b.touchPlane[1] > 0 ? t('sortie.yes') : t('sortie.no')}`));
        stats.push(stat(t('ov.slFormation'), `${formationLabel(b.formation[0])} / ${formationLabel(b.formation[1])}`,
            '', t('ov.slFormationTip')));
        if (b.aaci > 0) stats.push(stat(t('sortie.antiAirCutin'), `#${b.aaci}`, 'good'));
    }
    // 掉落：**有無都要顯示**——結算過的節點沒掉就是「無掉落」，不是資料缺席。
    const drop = dropName(n, state);
    const dropChip = drop
        ? `<span class="sl-flag drop" title="${esc(t('sortie.dropTitle'))}">${esc(t('ov.slDrop'))} ${esc(drop)}</span>`
        : n.rank ? `<span class="sl-flag nodrop">${esc(t('ov.slNoDrop'))}</span>` : '';
    // 摘要列（收合時唯一看得到的一行）要放「掃描時要比較的東西」：節點・rank・boss／夜戰・
    // 制空・支援／基地・大破・掉落。細節（敵編成、數值、機數、經驗值）留給展開。
    return `<details class="sl-node${n.boss ? ' boss' : ''}">
        <summary>
            <span class="sl-node-head">
                <span class="sl-pill ${n.boss ? 'boss ' : ''}${rankClass(n.rank)}"${cellTip}>
                    <span class="sl-pill-node">${esc(label)}</span></span>
                ${rankChip(n)}
                ${n.boss ? `<span class="sl-tag boss">${esc(t('sortie.boss'))}</span>` : ''}
                ${kindTag(n)}
                ${n.night ? `<span class="sl-tag">${esc(t('sortie.midnight'))}</span>` : ''}
                ${seiku !== null ? `<span class="sl-seiku sk-${seiku}">${esc(seikuLabel(seiku))}</span>` : ''}
                ${n.support ? `<span class="sl-tag alt" title="${esc(t('ov.expedDeck', { n: n.support.deckId }))}">${esc(t('ov.slSupport'))}</span>` : ''}
                ${n.lbas.length ? `<span class="sl-tag alt">${esc(t('ov.slLbasWaves', { n: n.lbas.length }))}</span>` : ''}
                <span class="grow"></span>
                ${n.taiha ? `<span class="sl-flag taiha">${esc(t('fleet.heavyDamage'))}</span>` : ''}
                ${dropChip}
            </span>
        </summary>
        <div class="sl-node-body">
            ${n.enemyName ? `<div class="sl-ename">${esc(n.enemyName)}</div>` : ''}
            ${enemies(t('sortie.mainFleet'), n.enemyIds, n.enemyLv, eMain)}
            ${enemies(t('sortie.escortFleet'), n.enemyIdsEscort, n.enemyLvEscort, eEsc)}
            ${stats.length ? `<div class="sl-stats">${stats.join('')}</div>` : ''}
            ${b ? planeTable(b) : ''}
            ${nodeLbas(n.lbas, state)}
            <footer>
                ${mvpLabel(detail, n, state)}
                ${n.getExp ? `<span class="sl-tag">${esc(t('ov.slExp'))} ${n.getExp.toLocaleString()}</span>` : ''}
                ${n.baseExp ? `<span class="sl-tag" title="${esc(t('ov.slBaseExpTip'))}">${esc(t('ov.slBaseExp'))} ${n.baseExp.toLocaleString()}</span>` : ''}
            </footer>
        </div>
    </details>`;
}

// ── 交戰記錄 ───────────────────────────────────────────────────────────
// 這個檢視器使用 analyzeBattle() 留下的階段快照，不重新解讀原始封包。
// 顯示重點對照使用者提供的航海日誌擴張版／KC3Kai 範例：敵我編成、陣形／航向／索敵／觸接、
// 航空戰與基地航空隊、支援、各交戰階段、以及開戰前→晝戰後→夜戰後的逐艦 HP。

function phaseTurnLabel(phase: BattlePhaseView): string {
    return phase.kind === 'nightShelling' || phase.kind === 'friendlyShelling' || phase.kind === 'friendlyTorpedo'
        || phase.packet > 0 ? t('ov.slBattleNight') : t('ov.slBattleDay');
}

function nightEffectBadges(battle: BattleInfoView): string {
    const effects = battle.nightEffects;
    if (!effects || (!effects.starShell && !effects.nightRecon && !effects.searchlight)) return '';
    const labels: [boolean, string][] = [
        [effects.starShell, 'ov.slBattleNightStarShell'],
        [effects.nightRecon, 'ov.slBattleNightRecon'],
        [effects.searchlight, 'ov.slBattleNightSearchlight'],
    ];
    return `<span class="sl-battle-night-effects" aria-label="${esc(t('ov.slBattleNightEquipment'))}">`
        + labels.filter(([active]) => active)
            .map(([, key]) => `<span class="sl-battle-night-effect">${esc(t(key))}</span>`).join('')
        + '</span>';
}

function hpClass(view: BattleHpView | null | undefined): string {
    if (!view) return 'unknown';
    if (view.sunk || view.hp <= 0) return 'sunk';
    if (view.maxHp > 0 && view.hp * 4 <= view.maxHp) return 'major';
    if (view.maxHp > 0 && view.hp * 2 <= view.maxHp) return 'mid';
    if (view.maxHp > 0 && view.hp * 4 <= view.maxHp * 3) return 'minor';
    return '';
}

function hpCell(view: BattleHpView | null | undefined): string {
    if (!view) return `<span class="sl-bhp unknown">—</span>`;
    return `<span class="sl-bhp ${hpClass(view)}">${Math.max(0, view.hp)}/${view.maxHp}</span>`;
}

function snapshotTotal(snapshot: BattleHpSnapshot, side: 'player' | 'enemy'): string {
    const groups = side === 'player'
        ? [snapshot.playerMain, snapshot.playerEscort]
        : [snapshot.enemyMain, snapshot.enemyEscort];
    const now = groups.flat().reduce((sum, ship) => sum + (ship?.hp ?? 0), 0);
    const max = groups.flat().reduce((sum, ship) => sum + (ship?.maxHp ?? 0), 0);
    return `${now}/${max}`;
}

function timelineCheckpoints(battle: BattleInfoView): { label: string; snapshot: BattleHpSnapshot }[] {
    const timeline = battle.timeline;
    if (!timeline) return [];
    const points = [{ label: t('ov.slBattleBefore'), snapshot: timeline.initial }];
    const day = timeline.phases.filter(phase => phase.packet === 0).slice(-1)[0];
    const night = timeline.phases.filter(phase => phase.packet > 0).slice(-1)[0];
    if (day) points.push({
        label: night ? t('ov.slBattleAfterDay') : t('ov.slBattleAfter'), snapshot: day,
    });
    if (night) points.push({ label: t('ov.slBattleAfterNight'), snapshot: night });
    return points;
}

function hpTimelineTable(
    title: string,
    names: string[],
    side: keyof BattleHpSnapshot,
    points: { label: string; snapshot: BattleHpSnapshot }[],
): string {
    if (!names.length) return '';
    return `<section class="sl-battle-hp-group">
        <h4>${esc(title)}</h4>
        <div class="sl-battle-hp-table" role="table">
            <div class="sl-battle-hp-row header" style="--sl-battle-point-count:${points.length}" role="row">
                <span role="columnheader">${esc(t('ov.slBattleShip'))}</span>
                ${points.map(point => `<span role="columnheader">${esc(point.label)}</span>`).join('')}
            </div>
            ${names.map((name, i) => `<div class="sl-battle-hp-row" style="--sl-battle-point-count:${points.length}" role="row">
                <span class="sl-battle-hp-name" role="rowheader">${esc(name)}</span>
                ${points.map(point => `<span role="cell">${hpCell(point.snapshot[side][i])}</span>`).join('')}
            </div>`).join('')}
        </div>
    </section>`;
}

function enemyNames(ids: number[], levels: number[], state: SectionContext['state']): string[] {
    return ids.map((id, i) => {
        const name = id > 0 ? state.shipName(id) : '?';
        const lv = levels[i];
        return lv && lv > 1 ? `${name} Lv${lv}` : name;
    });
}

function supportShipNames(ids: number[], state: SectionContext['state']): string {
    return ids.map(id => {
        const mst = state.ships.get(id)?.api_ship_id;
        return mst ? state.shipName(mst) : `#${id}`;
    }).join('、');
}

function fleetShipLabel(
    side: 'player' | 'enemy' | 'friendly',
    index: number | null,
    detail: SortieDetail,
    node: NodeDetail,
    battle: BattleInfoView,
    state: SectionContext['state'],
): string {
    if (side === 'friendly') {
        const mst = index !== null ? battle.friendlyFleetIds?.[index] : undefined;
        return mst ? state.shipName(mst) : t('ov.slBattleFriendlyFleet');
    }
    if (index === null) return side === 'player' ? t('ov.slBattleOurAir') : t('ov.slBattleEnemyAir');
    const escort = index >= 6;
    const local = escort ? index - 6 : index;
    const ships = side === 'player' ? (escort ? detail.fleet2 : detail.fleet1) : null;
    if (ships?.[local]) return state.shipName(ships[local].mst);
    const ids = side === 'enemy' ? (escort ? node.enemyIdsEscort : node.enemyIds) : [];
    const positions = side === 'enemy'
        ? (escort ? battle.enemyPositionsEscort : battle.enemyPositions)
        : undefined;
    const compactIndex = positions?.indexOf(local) ?? -1;
    const mst = ids[compactIndex >= 0 ? compactIndex : local];
    if (mst) return state.shipName(mst);
    return side === 'player' ? t('sortie.ourSide') : t('sortie.enemySide');
}

function eventSourceLabel(
    event: BattleDamageEvent,
    phase: BattlePhaseView,
    detail: SortieDetail,
    node: NodeDetail,
    battle: BattleInfoView,
    state: SectionContext['state'],
): string {
    if (event.attackerIndex !== null) {
        return fleetShipLabel(event.attackerSide ?? 'enemy', event.attackerIndex, detail, node, battle, state);
    }
    if (event.kind === 'landBase') {
        if (phase.kind === 'jetBase') {
            return event.attackerSide === 'enemy'
                ? t('ov.slBattleEnemyLandBaseJetSource') : t('ov.slBattleLandBaseJetSource');
        }
        return event.attackerSide === 'enemy'
            ? t('ov.slBattleEnemyLandBaseSource') : t('ov.slBattleLandBaseSource');
    }
    if (event.kind === 'support') return t('ov.slBattleSupportSource');
    if (event.kind === 'torpedo') {
        if (phase.kind === 'openingTorpedo' && event.attackerIndex === null) {
            return event.attackerSide === 'enemy' ? t('ov.slBattleEnemyOpeningTorpedo') : t('ov.slBattleOurOpeningTorpedo');
        }
        return event.attackerSide === 'enemy' ? t('ov.slBattleEnemyTorpedo') : t('ov.slBattleOurTorpedo');
    }
    if (event.kind === 'air') {
        if (phase.kind === 'jet') {
            return event.attackerSide === 'enemy' ? t('ov.slBattleEnemyCarrierJet') : t('ov.slBattleOurCarrierJet');
        }
        return event.attackerSide === 'enemy' ? t('ov.slBattleEnemyAir') : t('ov.slBattleOurAir');
    }
    return t('ov.slBattleUnknownSource');
}

/**
 * `api_si_list` 的裝備 master id → 夜戰 CI 的裝備構成。
 * 這裡只使用 start2 已提供的裝備類別，不用裝備名稱猜測；未載入 master 時會退回原始
 * `api_sp_list`／`api_at_type` 代碼。類別值來自 `api_mst_slotitem.api_type[2]`。
 */
function attackPattern(event: BattleDamageEvent, state: SectionContext['state']): string | null {
    const categories = event.attackSlots
        .map(id => state.masterGears.get(id)?.cat)
        .filter((cat): cat is number => Number.isSafeInteger(cat));
    const count = (ids: number[]) => categories.filter(cat => ids.includes(cat)).length;
    const main = count([1, 2, 3, 38]);
    const secondary = count([4, 95]);
    const torpedo = count([5, 32]);
    const radar = count([12, 13, 93]);
    const lookout = count([39]);
    const aircraft = count([6, 7, 8, 9, 11, 45, 56, 57, 58, 59, 91, 94]);

    // 夜戰的特殊攻擊代碼與裝備構成同時存在時，以封包實際送出的裝備構成為顯示依據。
    // 這能涵蓋新型驅逐艦 CI（主魚電／魚水魚），也避免把未知的新代碼硬套成舊型 CI。
    if (event.specialType !== null && event.specialType > 0) {
        if (main > 0 && torpedo > 0 && radar > 0) return t('ov.slAttackNightMainTorpedoRadar');
        if (torpedo >= 2 && lookout > 0) return t('ov.slAttackNightTorpedoLookoutTorpedo');
        if (aircraft >= 2) return t('ov.slAttackNightAirCutIn');
        if (event.specialType === 1) return t('ov.slAttackNightDouble');
        if (event.specialType === 3) return t('ov.slAttackTorpedoCutIn');
        if (main >= 2 && secondary > 0) return t('ov.slAttackMainMainSecondary');
        if (main >= 1 && torpedo >= 1) return t('ov.slAttackMainTorpedo');
        if (torpedo >= 2) return t('ov.slAttackTorpedoCutIn');
        return t('ov.slAttackNightRaw', { n: event.specialType });
    }

    if (event.attackType !== null && event.attackType > 0) {
        // 現有樣本的三位數 api_at_type 都是多目標特殊砲擊代碼；保留原始代碼在
        // title，畫面主標用玩家可讀的共同名稱，避免把長門型等代碼誤當普通砲擊。
        if (event.attackType >= 100) return t('ov.slAttackSpecialShelling');
        if (event.attackType === 2) return t('ov.slAttackDayDouble');
        if (event.attackType === 6 && aircraft === 0) return t('ov.slAttackDayCutIn');
        if (event.attackType === 7 && aircraft > 0) return t('ov.slAttackCarrierCutIn');
        return t('ov.slAttackRaw', { n: event.attackType });
    }
    return null;
}

function attackMeta(event: BattleDamageEvent, state: SectionContext['state']): { label: string; title: string } | null {
    const label = attackPattern(event, state);
    if (!label) return null;
    const raw = [
        event.attackType === null ? '' : `api_at_type=${event.attackType}`,
        event.specialType === null ? '' : `api_sp_list=${event.specialType}`,
    ].filter(Boolean).join(' · ');
    const slots = event.attackSlots.length
        ? `api_si_list=${event.attackSlots.join(',')}`
        : '';
    const title = [raw, slots].filter(Boolean).join(' · ');
    return { label, title };
}

function hpBand(hp: number | null, maxHp: number | null, sunk = false): string {
    if (hp === null || maxHp === null) return 'unknown';
    if (sunk || hp <= 0) return 'sunk';
    if (maxHp > 0 && hp * 4 <= maxHp) return 'major';
    if (maxHp > 0 && hp * 2 <= maxHp) return 'mid';
    if (maxHp > 0 && hp * 4 <= maxHp * 3) return 'minor';
    return 'safe';
}

function eventOutcomeStatus(event: BattleDamageEvent): string | null {
    if (event.damage <= 0) return t('ov.slBattleMiss');
    if (event.sunk || event.afterHp === 0) return t('ov.slBattleSunk');
    const before = hpBand(event.beforeHp, event.maxHp);
    const after = hpBand(event.afterHp, event.maxHp);
    if (after === before) return null;
    const key = after === 'major' ? 'ov.slBattleTaiha'
        : after === 'mid' ? 'ov.slBattleChuhai'
            : after === 'minor' ? 'ov.slBattleShouha' : '';
    return key ? t(key) : null;
}

type BattleEventGroup = {
    side: 'player' | 'friendly' | 'enemy';
    key: string;
    events: BattleDamageEvent[];
};

type BattleAttackSeries = {
    key: string;
    events: BattleDamageEvent[];
};

type BattleTargetGroup = {
    side: Exclude<BattleDamageEvent['defenderSide'], null>;
    index: number;
    events: BattleDamageEvent[];
};

/** `BattleDamageEvent` 是資料層的逐次命中；畫面只合併原始順序中相鄰的同一攻擊方。 */
function battleEventSide(event: BattleDamageEvent): 'player' | 'friendly' | 'enemy' {
    if (event.attackerSide === 'enemy') return 'enemy';
    if (event.attackerSide === 'friendly') return 'friendly';
    return 'player';
}

function battleEventGroupKey(event: BattleDamageEvent, side: BattleEventGroup['side']): string {
    // 有攻擊艦索引時，同一階段同一艦的所有攻擊放進同一張卡；
    // 航空／基地／支援／雷擊沒有個別攻擊艦索引時，依封包提供的來源種類分卡。
    return event.attackerIndex === null
        ? `${side}|source|${event.kind}`
        : `${side}|ship|${event.attackerIndex}`;
}

function battleEventSeriesKey(event: BattleDamageEvent): string {
    return [
        event.kind,
        event.attackType ?? '',
        event.specialType ?? '',
        event.attackSlots.join(','),
    ].join('|');
}

function battleEventGroups(events: BattleDamageEvent[]): BattleEventGroup[] {
    const groups: BattleEventGroup[] = [];
    for (const event of events) {
        const side = battleEventSide(event);
        const key = battleEventGroupKey(event, side);
        const previous = groups.at(-1);
        if (previous?.key === key) previous.events.push(event);
        else groups.push({ side, key, events: [event] });
    }
    return groups;
}

function battleAttackSeries(events: BattleDamageEvent[]): BattleAttackSeries[] {
    const series: BattleAttackSeries[] = [];
    for (const event of events) {
        const key = battleEventSeriesKey(event);
        const previous = series.at(-1);
        if (previous?.key === key) previous.events.push(event);
        else series.push({ key, events: [event] });
    }
    return series;
}

/** 同一次攻擊中的同一目標只畫一列；傷害數字仍依封包順序逐個保留。 */
function battleTargetGroups(events: BattleDamageEvent[]): BattleTargetGroup[] {
    const groups = new Map<string, BattleTargetGroup>();
    for (const event of events) {
        if (!event.defenderSide || event.defenderIndex === null) continue;
        const key = `${event.defenderSide}|${event.defenderIndex}`;
        const group = groups.get(key);
        if (group) group.events.push(event);
        else groups.set(key, { side: event.defenderSide, index: event.defenderIndex, events: [event] });
    }
    return [...groups.values()];
}

function phaseTargetGroupHtml(
    targetGroup: BattleTargetGroup,
    detail: SortieDetail,
    node: NodeDetail,
    battle: BattleInfoView,
    state: SectionContext['state'],
): string {
    const defender = fleetShipLabel(targetGroup.side, targetGroup.index, detail, node, battle, state);
    const damages = targetGroup.events.map(event => {
        const damage = event.damage > 0 ? `−${event.damage.toLocaleString()}` : '0';
        return `<span class="sl-battle-hit-damage-token${event.critical ? ' critical' : ''}">${damage}${event.critical ? `<small>${esc(t('ov.slBattleCritical'))}</small>` : ''}</span>`;
    }).join('<span class="sl-battle-hit-damage-separator" aria-hidden="true">、</span>');
    const damageLabel = targetGroup.events.map(event => event.damage > 0
        ? t('ov.slBattleDamage', { n: event.damage })
        : t('ov.slBattleMiss')).join('、');
    const statuses: string[] = [];
    for (const event of targetGroup.events) {
        const status = eventOutcomeStatus(event);
        if (status && !statuses.includes(status)) statuses.push(status);
    }
    const sunk = targetGroup.events.some(event => event.sunk);
    return `<span class="sl-battle-hit${sunk ? ' sunk' : ''}">
        <strong class="sl-battle-hit-target">${esc(defender)}</strong>
        <span class="sl-battle-hit-damage" aria-label="${esc(damageLabel)}">${damages}</span>
        ${statuses.length ? `<span class="sl-battle-hit-results">${statuses.map(status => `<span class="sl-battle-hit-outcome">${esc(status)}</span>`).join('<span class="sl-battle-hit-result-separator" aria-hidden="true">·</span>')}</span>` : ''}
    </span>`;
}

function phaseAttackSeriesHtml(
    series: BattleAttackSeries,
    detail: SortieDetail,
    node: NodeDetail,
    battle: BattleInfoView,
    state: SectionContext['state'],
): string {
    const event = series.events[0];
    const attack = attackMeta(event, state);
    const targetGroups = battleTargetGroups(series.events);
    return `<div class="sl-battle-attack-series">
        <div class="sl-battle-attack-series-head">
            <span class="sl-battle-event-kind">${esc(t(BATTLE_EVENT_KEYS[event.kind]))}</span>
            ${attack ? `<b class="sl-battle-event-attack"${attack.title ? ` title="${esc(attack.title)}"` : ''}>${esc(attack.label)}</b>` : ''}
        </div>
        <div class="sl-battle-hits sl-battle-targets">${targetGroups.length
            ? targetGroups.map((target, index) => `${index ? '<span class="sl-battle-target-separator" aria-hidden="true">；</span>' : ''}${phaseTargetGroupHtml(target, detail, node, battle, state)}`).join('')
            : `<span class="sl-battle-hit sl-battle-hit-no-target"><span class="sl-battle-hit-outcome">${esc(t('ov.slBattleMiss'))}</span></span>`}</div>
    </div>`;
}

function phaseAttackGroupHtml(
    group: BattleEventGroup,
    phase: BattlePhaseView,
    detail: SortieDetail,
    node: NodeDetail,
    battle: BattleInfoView,
    state: SectionContext['state'],
): string {
    const source = eventSourceLabel(group.events[0], phase, detail, node, battle, state);
    const series = battleAttackSeries(group.events);
    return `<li class="sl-battle-attack-group sl-battle-event sl-battle-attack-group-${group.side}">
        <div class="sl-battle-combat-row">
            <div class="sl-battle-combat-attacker">
                <strong class="sl-battle-attacker-name">${esc(source)}</strong>
            </div>
            <span class="sl-battle-combat-arrow" aria-hidden="true">→</span>
            <div class="sl-battle-attack-series-list">
                ${series.map(item => phaseAttackSeriesHtml(item, detail, node, battle, state)).join('')}
            </div>
        </div>
    </li>`;
}

function phaseDetailsHtml(
    phase: BattlePhaseView,
    node: NodeDetail,
    battle: BattleInfoView,
    state: SectionContext['state'],
): string {
    const details: string[] = [];
    let title = '';

    if (phase.kind === 'air') {
        const planes = planeTable(battle);
        if (planes) {
            title = t('ov.slBattlePlaneLoss');
            details.push(planes);
        }
    } else if (phase.kind === 'landBase' && node.lbas.length) {
        title = t('ov.slBattleLbasWaves');
        details.push(nodeLbas(node.lbas, state));
    } else if (phase.kind === 'supportAir' || phase.kind === 'supportShell' || phase.kind === 'supportTorpedo' || phase.kind === 'supportAsw') {
        const support = battleSupportDetails(battle, state);
        if (support) {
            title = t('ov.slBattleSupportComposition');
            details.push(support);
        }
    } else if (phase.kind === 'friendlyShelling') {
        const friendly = battleFriendlyFleetDetails(battle, state);
        if (friendly) {
            title = t('ov.slBattleFriendlyFleetDetails');
            details.push(friendly);
        }
    }

    const events = phase.events ?? [];
    const phaseSourceResolved = phase.kind === 'jetBase' || phase.kind === 'jet' || phase.kind === 'openingTorpedo';
    const unresolved = events.some(event => !phaseSourceResolved && event.attackerIndex === null
        && (event.kind === 'air' || event.kind === 'landBase' || event.kind === 'support' || event.kind === 'torpedo'))
        || events.some(event => event.kind === 'support');
    if (unresolved) {
        title ||= t('ov.slBattlePacketNote');
        details.push(`<p class="sl-dim sl-battle-event-note">${esc(t('ov.slBattleUnresolvedSource'))}</p>`);
    }
    if (!details.length) return '';

    return `<details class="sl-battle-phase-details">
        <summary><span>${esc(title)}</span><span class="sl-dim">${esc(t('ov.slBattleDetails'))}</span></summary>
        <div class="sl-battle-phase-details-body">${details.join('')}</div>
    </details>`;
}

function phaseCard(
    phase: BattlePhaseView,
    index: number,
    detail: SortieDetail,
    node: NodeDetail,
    battle: BattleInfoView,
    state: SectionContext['state'],
): string {
    const label = t(BATTLE_PHASE_KEYS[phase.kind]);
    const after = `${t('ov.slBattleOurHp')} ${snapshotTotal(phase, 'player')}　·　${t('ov.slBattleEnemyHp')} ${snapshotTotal(phase, 'enemy')}`;
    const events = phase.events ?? [];
    const attackGroups = battleEventGroups(events);
    return `<li class="sl-battle-phase" data-battle-phase="${phase.kind}">
        <div class="sl-battle-phase-head${phase.kind === 'nightShelling' ? ' sl-battle-phase-head-night' : ''}">
            <span class="sl-battle-step">${String(index + 1).padStart(2, '0')}</span>
            <strong>${esc(label)}</strong>
            ${phase.kind === 'nightShelling' ? nightEffectBadges(battle) : ''}
            <span class="sl-battle-turn">${esc(phaseTurnLabel(phase))}</span>
        </div>
        ${phaseDetailsHtml(phase, node, battle, state)}
        ${events.length ? `<ol class="sl-battle-attack-groups">${attackGroups.map(group => phaseAttackGroupHtml(group, phase, detail, node, battle, state)).join('')}</ol>`
            : `<p class="sl-dim sl-battle-no-events">${esc(t('ov.slBattleNoEvents'))}</p>`}
        <div class="sl-battle-phase-stats">
            <span class="enemy-damage">${esc(t('ov.slBattleEnemyDamage'))} <b>${phase.enemyDamage.toLocaleString()}</b></span>
            <span class="own-damage">${esc(t('ov.slBattleOwnDamage'))} <b>${phase.ownDamage.toLocaleString()}</b></span>
        </div>
        <div class="sl-battle-phase-after">${esc(after)}</div>
    </li>`;
}

function battleNodeLog(
    detail: SortieDetail,
    n: NodeDetail,
    state: SectionContext['state'],
    index: number,
    active: boolean,
): string {
    const battle = n.battle;
    if (!battle) return '';
    const points = timelineCheckpoints(battle);
    const formation = `${formationLabel(battle.formation[0])} / ${formationLabel(battle.formation[1])}`;
    const engagement = t(ENGAGEMENT_KEYS[battle.formation[2]] ?? 'eng.unknown');
    const airPresent = battle.planes.playerFighter.count + battle.planes.playerBomber.count
        + battle.planes.enemyFighter.count + battle.planes.enemyBomber.count > 0;
    const contact = `${battle.touchPlane[0] > 0 ? t('sortie.yes') : t('sortie.no')} / ${battle.touchPlane[1] > 0 ? t('sortie.yes') : t('sortie.no')}`;
    const search = `${searchLabel(n.search[0])} (${n.search[0] ?? '?'}) / ${searchLabel(n.search[1])} (${n.search[1] ?? '?'})`;
    const meta = [
        `<span class="sl-battle-meta-item"><i>${esc(t('ov.slFormation'))}</i>${esc(formation)}</span>`,
        `<span class="sl-battle-meta-item"><i>${esc(t('ov.slBattleEngagement'))}</i>${esc(engagement)}</span>`,
        `<span class="sl-battle-meta-item"><i>${esc(t('ov.slBattleSearch'))}</i>${esc(search)}</span>`,
        `<span class="sl-battle-meta-item"><i>${esc(t('sortie.contact'))}</i>${esc(contact)}</span>`,
        airPresent ? `<span class="sl-battle-meta-item"><i>${esc(t('sortie.airBattle'))}</i>${esc(seikuLabel(battle.seiku))}</span>` : '',
        battle.aaci > 0 ? `<span class="sl-battle-meta-item"><i>${esc(t('sortie.antiAirCutin'))}</i>#${battle.aaci}</span>` : '',
    ].filter(Boolean).join('');

    const enemyMain = enemyNames(n.enemyIds, n.enemyLv, state);
    const enemyEscort = enemyNames(n.enemyIdsEscort, n.enemyLvEscort, state);
    const hpTables = points.length ? [
        hpTimelineTable(t('ov.slBattleOurMain'), detail.fleet1.map(ship => `${state.shipName(ship.mst)} Lv${ship.lv}`), 'playerMain', points),
        hpTimelineTable(t('ov.slBattleOurEscort'), detail.fleet2.map(ship => `${state.shipName(ship.mst)} Lv${ship.lv}`), 'playerEscort', points),
        hpTimelineTable(t('ov.slBattleEnemyMain'), enemyMain, 'enemyMain', points),
        hpTimelineTable(t('ov.slBattleEnemyEscort'), enemyEscort, 'enemyEscort', points),
    ].filter(Boolean).join('') : `<p class="sl-dim">${esc(t('ov.slBattleTimelineUnavailable'))}</p>`;
    const phases = battle.timeline?.phases ?? [];
    const finalMain = battle.resultFleets?.enemyMain ?? [];
    const finalEscort = battle.resultFleets?.enemyEscort ?? [];
    const enemyLineup = [
        enemyMain.length ? `<div class="sl-battle-lineup"><span>${esc(t('ov.slBattleEnemyMain'))}</span><div class="sl-ecs">${n.enemyIds.map((id, i) => enemyChip(id, n.enemyLv[i], finalMain[i], state)).join('')}</div></div>` : '',
        enemyEscort.length ? `<div class="sl-battle-lineup"><span>${esc(t('ov.slBattleEnemyEscort'))}</span><div class="sl-ecs">${n.enemyIdsEscort.map((id, i) => enemyChip(id, n.enemyLvEscort[i], finalEscort[i], state)).join('')}</div></div>` : '',
    ].filter(Boolean).join('');
    const result = [
        n.rank ? `<span class="sl-rank ${rankClass(n.rank)}">${esc(n.rank)}</span>` : rankChip(n),
        mvpLabel(detail, n, state),
        n.getExp ? `<span class="sl-tag">${esc(t('ov.slExp'))} ${n.getExp.toLocaleString()}</span>` : '',
        n.baseExp ? `<span class="sl-tag">${esc(t('ov.slBaseExp'))} ${n.baseExp.toLocaleString()}</span>` : '',
        n.drop || n.dropMst ? `<span class="sl-flag drop">${esc(t('ov.slDrop'))} ${esc(dropName(n, state) ?? '?')}</span>` : '',
    ].filter(Boolean).join('');

    return `<article id="sl-battle-node-${index}" data-battle-node-panel="${index}" class="sl-battle-node-log${n.boss ? ' boss' : ''}"${active ? '' : ' hidden'}>
        <header class="sl-battle-node-log-head">
            <div class="sl-battle-node-log-title">
                <span class="sl-pill ${n.boss ? 'boss' : ''}"><span class="sl-pill-node">${esc(nodeLabel(detail.map, n.node))}</span></span>
                <div><strong>${esc(t('ov.slBattleNode', { n: nodeLabel(detail.map, n.node) }))}</strong>
                    ${n.boss ? `<span class="sl-tag boss">${esc(t('sortie.boss'))}</span>` : ''}
                    ${n.enemyName ? `<small>${esc(n.enemyName)}</small>` : ''}
                </div>
            </div>
            <div class="sl-battle-result">${result}</div>
        </header>
        <div class="sl-battle-meta">${meta}</div>
        ${enemyLineup ? `<section class="sl-battle-panel"><h3>${esc(t('ov.slBattleEnemyFleet'))}</h3>${enemyLineup}</section>` : ''}
        <section class="sl-battle-panel">
            <div class="sl-battle-panel-head"><h3>${esc(t('ov.slBattlePhases'))}</h3><span class="sl-dim">${esc(t('ov.slBattlePhaseHint'))}</span></div>
            ${phases.length ? `<ol class="sl-battle-phases">${phases.map((phase, i) => phaseCard(phase, i, detail, n, battle, state)).join('')}</ol>` : `<p class="sl-dim">${esc(t('ov.slBattleNoPhases'))}</p>`}
        </section>
        <details class="sl-battle-panel sl-battle-hp-panel">
            <summary><h3>${esc(t('ov.slBattleHpTimeline'))}</h3><span class="sl-dim">${esc(t('ov.slBattleHpHint'))}</span></summary>
            <div class="sl-battle-hp-grid">${hpTables}</div>
        </details>
    </article>`;
}

/** 以對話框呈現一整場出擊的交戰資料；沒有原始重播時不會有此入口。 */
export function battleLogHtml(detail: SortieDetail, state: SectionContext['state']): string {
    const nodes = detail.nodes.filter(n => n.kind === 'battle' && n.battle);
    if (!nodes.length) return `<div class="sl-battle-empty">${esc(t('ov.slBattleNoPacket'))}</div>`;
    const summary = [
        `<span class="sl-tag">${esc(t('ov.slBattleNodeCount', { n: nodes.length }))}</span>`,
        detail.lastRank ? `<span class="sl-rank ${rankClass(detail.lastRank)}">${esc(detail.lastRank)}</span>` : '',
        detail.cleared ? `<span class="sl-flag clear">${esc(t('history.cleared'))}</span>` : '',
        detail.taiha ? `<span class="sl-flag taiha">${esc(t('fleet.heavyDamage'))}</span>` : '',
    ].filter(Boolean).join('');
    return `<div class="sl-battle-log">
        <header class="sl-battle-log-intro">
            <div>
                <p class="sl-battle-kicker">${esc(t('ov.slBattleKicker'))}</p>
                <h2>${esc(mapLabel(detail))} <span>${esc(fmtTs(detail.ts))}</span></h2>
                <p class="sl-dim">${esc(t('ov.slBattleIntro'))}</p>
            </div>
            <div class="sl-battle-log-summary">${summary}</div>
        </header>
        <div class="sl-battle-route" role="tablist" aria-label="${esc(t('ov.slBattleRoute'))}">
            ${nodes.map((n, i) => `<button type="button" class="sl-battle-route-node${n.boss ? ' boss' : ''}" data-battle-node="${i}" role="tab" aria-selected="${i === 0}" aria-controls="sl-battle-node-${i}" tabindex="${i === 0 ? 0 : -1}" title="${esc(t('ov.slBattleSelectNode', { n: nodeLabel(detail.map, n.node) }))}">${esc(nodeLabel(detail.map, n.node))}</button>`).join('<span class="sl-battle-route-arrow" aria-hidden="true">›</span>')}
        </div>
        <div class="sl-battle-node-list">${nodes.map((n, i) => battleNodeLog(detail, n, state, i, i === 0)).join('')}</div>
    </div>`;
}

export function detailHtml(detail: SortieDetail, replay: ReplayRow | undefined, state: SectionContext['state']): string {
    const actions = replay
        ? `<details class="sl-export">
             <summary class="ov-btn">${esc(t('ov.replayExport'))}</summary>
             <div class="sl-export-menu">
               <button type="button" class="ov-btn" data-replay-copy="${detail.sortieKey}">${esc(t('ov.replayCopy'))}</button>
               <button type="button" class="ov-btn" data-replay-dl="${detail.sortieKey}">${esc(t('ov.replayDownload'))}</button>
               <button type="button" class="ov-btn" data-replay-png="${detail.sortieKey}">${esc(t('ov.replayPng'))}</button>
               <button type="button" class="ov-btn" data-replay-open="${detail.sortieKey}">${esc(t('ov.replayOpen'))}</button>
             </div>
           </details>
           ${replay.battles.length
        ? `<button type="button" class="ov-btn" data-deckbuilder-copy="${detail.sortieKey}">${esc(t('ov.deckbuilderCopy'))}</button>
           <button type="button" class="ov-btn" data-aircalc-open="${detail.sortieKey}">${esc(t('ov.exportAirCalc'))} ↗</button>
           <button type="button" class="ov-btn" data-simulator-open="${detail.sortieKey}">${esc(t('ov.sortieSimulatorOpen'))} ↗</button>`
        : ''}
           <button type="button" class="ov-btn battle-log-open" data-battle-log="${detail.sortieKey}" aria-haspopup="dialog">${esc(t('ov.slBattleLog'))}</button>
           <button type="button" class="ov-btn danger" data-replay-del="${detail.sortieKey}" title="${esc(t('ov.replayDeleteTip'))}">🗑</button>`
        : `<span class="sl-dim">${esc(t('ov.slNoPacket'))}</span>`;
    // 掉落：有就列艦名；沒有掉落但**有結算過**才顯示「無掉落」。Fleet Chronometer 自身匯出
    // 通常是「不知道」；KC3Kai logger 匯入若帶 rating/drop，則能確定是否掉落。
    const settled = detail.nodes.some(n => n.kind === 'battle' && n.rank);
    const summary = [
        detail.totalExp > 0 ? `<span class="sl-tag">${esc(t('ov.slExpTotal'))} ${detail.totalExp.toLocaleString()}</span>` : '',
        detail.drops.length
            ? detail.drops.map(d => `<span class="sl-flag drop">${esc(t('ov.slDrop'))} ${esc(dropName(d, state) ?? '?')}</span>`).join('')
            : settled ? `<span class="sl-flag nodrop">${esc(t('ov.slNoDrop'))}</span>` : '',
    ].filter(Boolean).join('');

    // 道中支援／決戰支援：以「有沒有在 boss 節點出動」分（同 KC3Kai 的兩欄）
    const bossSupport = detail.supports.find(s => s.boss);
    const routeSupport = detail.supports.find(s => s !== bossSupport);
    // 連合艦隊要講明是哪一種編成（水上／空母／輸送護衛）——三者的隨伴角色完全不同
    const kindLabel = t(fleetKindKey(detail.combined, detail.fleet1.length));
    const fleetKind = detail.combined > 0
        ? `${t('ov.slCombined', { n: detail.fleetnum })}・${kindLabel}`
        : `${t('ov.fleetN', { n: detail.fleetnum || 1 })}・${kindLabel}`;
    const fleets = detail.fleet1.length
        ? `<section class="sl-block">
             <h4>${esc(t('ov.slFleet'))}<span class="sl-dim">${esc(fleetKind)}</span>
                 <span class="grow"></span>
                 <button type="button" class="rs-mini" data-open-all="gears">${esc(t('ov.slGearsAll'))}</button></h4>
             <div class="sl-fleets">
               ${fleetColumn(t('ov.slMainFleet'), detail.fleet1, state, t('ov.slNoFleet'))}
               ${detail.combined > 0 ? fleetColumn(t('ov.slEscortFleet'), detail.fleet2, state, t('ov.slNoFleet')) : ''}
             </div>
           </section>`
        : '';

    // 支援艦隊：**預設折疊**（使用者要求）。收合時的摘要要看得出「有沒有出、哪一隊出的」，
    // 否則折疊等於把資訊藏掉（同 event-ops 的教訓：藏起來讓人找＝沒做）。
    const supportDigest = detail.supports.length
        ? detail.supports.map(sup =>
            `${t(sup.boss ? 'ov.slBossSupport' : 'ov.slRouteSupport')} ${t('ov.expedDeck', { n: sup.use.deckId })}`).join('・')
        : t('ov.slSupportNone');
    const supportBlock = `<details class="sl-block sl-sec">
        <summary><h4>${esc(t('ov.slSupport'))}<span class="sl-dim">${esc(supportDigest)}</span></h4></summary>
        <div class="sl-fleets">
            ${supportColumn(routeSupport, t('ov.slRouteSupport'), state, detail.map)}
            ${supportColumn(bossSupport, t('ov.slBossSupport'), state, detail.map)}
        </div>
    </details>`;

    // 基地航空隊：同樣預設折疊，摘要列出各基地的行動（出擊／防空）
    const lbasDigest = detail.lbas.length
        ? detail.lbas.map(base =>
            `${t('ov.slBaseN', { n: base.rid })} ${t(LBAS_ACTION_KEYS[base.action] ?? 'lbas.standby')}`).join('・')
        : detail.lbasWaves.length ? t('ov.slLbasWaves', { n: detail.lbasWaves.length }) : '';
    const lbasBody = detail.lbas.length
        ? `<div class="sl-fleets">${detail.lbas.map(base => lbasCard(base, state)).join('')}</div>`
        : detail.lbasWaves.length
            ? `<div class="sl-dim">${esc(t('ov.slLbasNoSnapshot'))}</div>
               ${detail.lbasWaves.map(({ wave, node }) => `<div class="sl-line">
                    <span class="sl-tag">${esc(t('ov.slBaseN', { n: wave.baseId }))}</span>
                    <span class="sl-dim">${esc(t('ov.slNodeN', { n: nodeLabel(detail.map, node) }))}</span>
                    <span class="sl-gears">${wave.planes.map(p =>
                `<span class="sl-gear" title="${esc(state.gearName(p.mst))}">${gearIconHtml(state.gearIconId(p.mst), state.gearName(p.mst))}<i class="sl-cnt">${p.count}</i></span>`).join('')}</span>
                 </div>`).join('')}`
            : '';
    const lbasBlock = lbasBody
        ? `<details class="sl-block sl-sec">
             <summary><h4>${esc(t('ov.slLbas'))}<span class="sl-dim">${esc(lbasDigest)}</span></h4></summary>
             ${lbasBody}
           </details>`
        : '';

    // 節點：一節點一列、**預設收合**，可單獨點開或用標題列的按鈕全開。
    // 沒有字母對照的海域要說明為什麼顯示數字（見 utils/map-node-letters.ts）。
    const letterNote = hasNodeLetters(detail.map) ? ''
        : `<span class="sl-dim" title="${esc(t('ov.slNoLetterTip'))}">${esc(t('ov.slNoLetter'))}</span>`;
    return `<div class="sl-actions">${actions}<span class="grow"></span>${summary}</div>
        ${fleets}
        ${supportBlock}
        ${lbasBlock}
        <section class="sl-block">
            <h4>${esc(t('ov.slNodes'))}${letterNote}
                <span class="grow"></span>
                <button type="button" class="rs-mini" data-open-all="nodes">${esc(t('ov.slNodesAll'))}</button></h4>
            <div class="sl-nodes">${detail.nodes.map(n => nodeCard(detail, n, state)).join('')}</div>
        </section>`;
}

/**
 * 工具列＋匯入面板的 markup。抽成函式是為了讓離線版面預覽（tools/preview/sortie-log.ts）
 * 用同一份、不會與這裡漂移。
 */
export function shellHtml(opts?: { includeImport?: boolean }): string {
    // 單場 JSON 匯入是測試向入口（見 utils/debug-ui.ts）；上架建置預設不顯示。
    const includeImport = opts?.includeImport ?? isDebugUiEnabled();
    const importUi = includeImport
        ? `${importToggleHtml('sl', t('ov.slImport'))}`
        : '';
    const importPanel = includeImport
        ? importPanelHtml('sl', '.json,application/json', {
            hint: t('ov.slImportHint'), go: t('ov.slImportGo'),
            paste: t('ov.slImportPaste'), note: t('ov.slImportNote'),
        })
        : '';
    return `
        <div class="sl">
            <div class="sl-bar">
                <div class="rs-seg sl-cat">
                    <button type="button" data-cat="all">${esc(t('ov.slCatAll'))}</button>
                    <button type="button" data-cat="normal">${esc(t('ov.slCatNormal'))}</button>
                    <button type="button" data-cat="event">${esc(t('ov.slCatEvent'))}</button>
                </div>
                <label class="sl-inline sl-event-wrap" hidden><span>${esc(t('ov.slEvent'))}</span><select class="sl-event-sel"></select></label>
                <label class="sl-inline"><span>${esc(t('ov.slMap'))}</span><select class="sl-map-sel"></select></label>
                <span class="grow"></span>
                <span class="sl-count"></span>
                <button type="button" class="ov-btn sl-expand">${esc(t('ov.slExpandAll'))}</button>
                ${importUi}
            </div>
            ${importPanel}
            <div class="sl-body ov-list"></div>
            <dialog class="sl-battle-dialog" aria-labelledby="sl-battle-dialog-title">
                <div class="sl-battle-dialog-shell">
                    <header class="sl-battle-dialog-head">
                        <h2 id="sl-battle-dialog-title">${esc(t('ov.slBattleLog'))}</h2>
                        <button type="button" class="ov-btn icon sl-battle-close" data-battle-close aria-label="${esc(t('ov.slBattleClose'))}"><span aria-hidden="true"></span></button>
                    </header>
                    <div class="sl-battle-dialog-body"></div>
                </div>
            </dialog>
        </div>`;
}

// ── 分區 ────────────────────────────────────────────────────────────────

export const sortieLogSection: OverviewSection = {
    id: 'sortie-log',
    titleKey: 'ov.sortieLog',
    async render(el, ctx) {
        // **先畫殼、再讀資料**：資料讀取可能很慢（重播層很大）、
        // 也可能整個卡住（Dexie 版本升級被其他分頁／面板擋住時 open() 會無限等待）。
        // 殼一定先出現，資料失敗只影響清單，工具列與匯入 JSON 仍可操作並顯示錯誤原因。
        el.innerHTML = shellHtml();

        const prefs = loadPrefs();
        let entries: Entry[] = [];
        let eventFilter: EventWorldFilter = 'all';
        let mapFilter = 'all';
        let pinLatestEvent = prefs.cat === 'event';
        let filterPlan: EventMapFilterPlan | null = null;
        const open = new Set<number>();
        const detailCache = new Map<number, string>();
        const simulatorCache = new Map<number, SortieSimulatorInput>();

        // 重播列的查表：事件委派（複製／下載／匯入／釘選）需要，載入完成後才有內容
        let replayCache = new Map<number, ReplayRow>();

        const catBtns = el.querySelectorAll<HTMLButtonElement>('.sl-cat button');
        const eventWrap = el.querySelector<HTMLLabelElement>('.sl-event-wrap')!;
        const eventSel = el.querySelector<HTMLSelectElement>('.sl-event-sel')!;
        const mapSel = el.querySelector<HTMLSelectElement>('.sl-map-sel')!;
        const countEl = el.querySelector<HTMLSpanElement>('.sl-count')!;
        const body = el.querySelector<HTMLDivElement>('.sl-body')!;
        const expandBtn = el.querySelector<HTMLButtonElement>('.sl-expand')!;
        const battleDialog = el.querySelector<HTMLDialogElement>('.sl-battle-dialog')!;
        const battleDialogBody = el.querySelector<HTMLDivElement>('.sl-battle-dialog-body')!;
        const closeBattleDialog = () => { if (battleDialog.open) battleDialog.close(); };
        el.querySelector<HTMLButtonElement>('[data-battle-close]')!.addEventListener('click', closeBattleDialog);
        battleDialogBody.addEventListener('click', event => {
            const target = event.target as HTMLElement;
            const nodeButton = target.closest<HTMLButtonElement>('button[data-battle-node]');
            if (!nodeButton) return;
            const selected = nodeButton.dataset.battleNode;
            if (selected === undefined) return;
            battleDialogBody.querySelectorAll<HTMLButtonElement>('button[data-battle-node]').forEach(button => {
                const isSelected = button.dataset.battleNode === selected;
                button.setAttribute('aria-selected', String(isSelected));
                button.tabIndex = isSelected ? 0 : -1;
            });
            battleDialogBody.querySelectorAll<HTMLElement>('[data-battle-node-panel]').forEach(panel => {
                panel.hidden = panel.dataset.battleNodePanel !== selected;
            });
            const panel = [...battleDialogBody.querySelectorAll<HTMLElement>('[data-battle-node-panel]')]
                .find(item => item.dataset.battleNodePanel === selected);
            panel?.scrollIntoView({ block: 'start' });
        });
        battleDialog.addEventListener('click', event => {
            // 點擊對話框本身的留白關閉，內容區的點擊不受影響。
            if (event.target === battleDialog) closeBattleDialog();
        });

        const visible = () => entries.filter(e =>
            (prefs.cat === 'all' || (prefs.cat === 'event' ? e.event : !e.event))
            && (eventFilter === 'all' || e.world === eventFilter)
            && (mapFilter === 'all' || e.map === mapFilter));

        function drawFilters() {
            const plan = planEventMapFilter(entries, {
                category: prefs.cat,
                eventFilter,
                mapFilter,
                pinLatestEvent,
                worldLabel: world => eventNameOf(world, ctx.state),
                eventTerm: eventTermForFilter,
                normalGroupLabel: t('ov.slCatNormal'),
            });
            pinLatestEvent = false;
            eventFilter = plan.eventFilter;
            mapFilter = plan.mapFilter;
            filterPlan = plan;
            eventWrap.hidden = !plan.showEventSelect;
            eventSel.innerHTML = eventFilterSelectHtml(plan.eventGroups, plan.eventFilter, t('ov.slEventAll'));
            mapSel.innerHTML = mapFilterSelectHtml(plan.mapGroups, plan.mapFilter, t('ov.slMapAll'));
        }

        function drawList() {
            catBtns.forEach(b => b.classList.toggle('on', b.dataset.cat === prefs.cat));
            const list = visible();
            const qualify = filterPlan?.qualifyEventWorld === true;
            countEl.textContent = t('ov.slCount', { n: list.length, total: entries.length });
            body.innerHTML = list.length
                ? list.map(e => `<article class="sl-card" data-key="${e.key}">
                    <div class="sl-row">
                        ${headHtml(e, ctx.state, open.has(e.key), { qualifyEventWorld: qualify })}
                        <button type="button" class="ov-btn pin ${e.replay?.pinned ? 'on' : ''}" data-replay-pin="${e.key}"
                            title="${esc(t('ov.replayPinTip'))}" ${e.replay ? '' : 'disabled'}>${e.replay?.pinned ? '★' : '☆'}</button>
                    </div>
                    <div class="sl-detail" id="sl-d-${e.key}" ${open.has(e.key) ? '' : 'hidden'}></div>
                  </article>`).join('')
                : `<div class="ov-empty">${esc(entries.length ? t('ov.slNoMatch') : t('history.none'))}</div>`;
            for (const e of list) if (open.has(e.key)) fillDetail(e);
        }

        /** 展開時才解析封包（含戰鬥重放），同一次出擊只算一次。 */
        function fillDetail(entry: Entry) {
            const host = body.querySelector<HTMLDivElement>(`#sl-d-${entry.key}`);
            if (!host || host.dataset.filled === '1') return;
            let html = detailCache.get(entry.key);
            if (html === undefined) {
                const detail = buildSortieDetail(entry.rows, entry.replay);
                html = detailHtml(detail, entry.replay, ctx.state);
                detailCache.set(entry.key, html);
                if (entry.replay?.battles.length) {
                    simulatorCache.set(entry.key, buildSortieSimulator(entry.replay, {
                        masterShips: ctx.state.master,
                        bossNodes: new Set(detail.nodes.filter(node => node.boss).map(node => node.node)),
                        routeNodes: detail.nodes.map(node => ({
                            node: node.node, boss: node.boss, kind: node.kind,
                            enemyIds: node.enemyIds, enemyIdsEscort: node.enemyIdsEscort,
                        })),
                    }));
                }
            }
            host.innerHTML = html;
            host.dataset.filled = '1';
        }

        function simulatorPayload(entry: Entry): SortieSimulatorInput | undefined {
            if (!entry.replay?.battles.length) return undefined;
            const cached = simulatorCache.get(entry.key);
            if (cached) return cached;
            const detail = buildSortieDetail(entry.rows, entry.replay);
            const payload = buildSortieSimulator(entry.replay, {
                        masterShips: ctx.state.master,
                bossNodes: new Set(detail.nodes.filter(node => node.boss).map(node => node.node)),
                routeNodes: detail.nodes.map(node => ({
                    node: node.node, boss: node.boss, kind: node.kind,
                    enemyIds: node.enemyIds, enemyIdsEscort: node.enemyIdsEscort,
                })),
            });
            simulatorCache.set(entry.key, payload);
            return payload;
        }

        catBtns.forEach(btn => btn.addEventListener('click', () => {
            prefs.cat = (btn.dataset.cat as Category) ?? 'all';
            savePrefs(prefs);
            pinLatestEvent = prefs.cat === 'event';
            if (prefs.cat !== 'event') eventFilter = 'all';
            drawFilters();
            drawList();
        }));
        eventSel.addEventListener('change', () => {
            eventFilter = readEventWorldFilter(eventSel.value);
            drawFilters();
            drawList();
        });
        mapSel.addEventListener('change', () => { mapFilter = mapSel.value; drawList(); });
        expandBtn.addEventListener('click', () => {
            const list = visible();
            const collapse = list.every(e => open.has(e.key));
            for (const e of list) collapse ? open.delete(e.key) : open.add(e.key);
            drawList();
        });

        // ── 單場 JSON 匯入（僅開發用 UI；上架建置不綁）────────────────
        // 解析／去重／落地都在 utils/sortie-import.ts；面板 UI 走共用 import-panel。
        if (isDebugUiEnabled()) {
            let clearImportInputs = () => { /* 綁定後覆寫 */ };
            clearImportInputs = bindImportPanel(el, 'sl', {
                onFileLoaded: (name, setStatus) => setStatus('', name),
                async onImport(text, setStatus) {
                    if (!text) { setStatus('bad', t('ov.slImportEmpty')); return; }
                    let parsed;
                    try {
                        // 掉落只有 master id（KC3Kai 匯出的形狀），艦名靠目前的 master 解析後一併存進去
                        parsed = parseSortieImport(JSON.parse(text), { shipName: mst => ctx.state.shipName(mst) });
                    } catch (error) {
                        const detail = error instanceof SortieImportError ? error.message : t('ov.slImportBadJson');
                        setStatus('bad', t('ov.slImportBad', { msg: detail }));
                        return;
                    }
                    try {
                        await importSortie(db, parsed);
                    } catch (error) {
                        if (error instanceof SortieImportDuplicateError) {
                            // 「已存在」是預期結果不是錯誤：如實說是哪一場，讓使用者知道去哪裡看
                            setStatus('dup', t('ov.slImportDup', {
                                map: parsed.signature.map, time: fmtTs(parsed.signature.ts),
                            }));
                            return;
                        }
                        setStatus('bad', t('ov.slImportBad', { msg: String((error as Error)?.message ?? error) }));
                        return;
                    }
                    setStatus('ok', t('ov.slImportOk', { map: parsed.signature.map, n: parsed.rows.length }));
                    clearImportInputs();
                    // 重繪整個分區才會把新紀錄排進清單（分類／海域下拉的選項也會跟著更新）
                    ctx.rerender();
                },
            }).clearInputs;
        }

        // 結果區每次重繪都換掉子元素，故一律事件委派（見 design-guidelines §4.2）
        body.addEventListener('click', async ev => {
            const target = ev.target as HTMLElement;
            const head = target.closest<HTMLButtonElement>('.sl-head');
            if (head) {
                const card = head.closest<HTMLElement>('.sl-card')!;
                const key = Number(card.dataset.key);
                const entry = entries.find(e => e.key === key);
                if (!entry) return;
                const nowOpen = !open.has(key);
                nowOpen ? open.add(key) : open.delete(key);
                const host = card.querySelector<HTMLDivElement>('.sl-detail')!;
                head.setAttribute('aria-expanded', String(nowOpen));
                const caret = head.querySelector('.sl-caret');
                if (caret) caret.textContent = nowOpen ? '▾' : '▸';
                host.hidden = !nowOpen;
                if (nowOpen) fillDetail(entry);
                return;
            }
            // 「全部展開／收合」：裝備（艦卡）與節點各一顆。原生 <details> 各自記自己的開合，
            // 這顆只是批次設定；若全開就變成全收，同一顆按鈕來回切（同工具列的展開全部）。
            const openAll = target.closest<HTMLButtonElement>('button[data-open-all]');
            if (openAll) {
                const scope = openAll.closest('.sl-detail');
                const selector = openAll.dataset.openAll === 'gears' ? 'details.sl-sc' : 'details.sl-node';
                const items = [...(scope?.querySelectorAll<HTMLDetailsElement>(selector) ?? [])];
                const collapse = items.every(d => d.open);
                items.forEach(d => { d.open = !collapse; });
                return;
            }
            const copy = target.closest<HTMLButtonElement>('button[data-replay-copy]');
            if (copy) {
                const r = replayCache.get(Number(copy.dataset.replayCopy));
                if (r) await copyWithFeedback(copy, JSON.stringify(toKc3Replay(r)), t('ov.replayCopied'));
                return;
            }
            const dl = target.closest<HTMLButtonElement>('button[data-replay-dl]');
            if (dl) {
                const r = replayCache.get(Number(dl.dataset.replayDl));
                if (r) downloadText(`${replayExportStem(r)}.json`, JSON.stringify(toKc3Replay(r)), 'application/json');
                return;
            }
            const png = target.closest<HTMLButtonElement>('button[data-replay-png]');
            if (png) {
                const r = replayCache.get(Number(png.dataset.replayPng));
                if (r) {
                    try {
                        await downloadReplayPng(r, mst => ctx.state.shipName(mst));
                    } catch {
                        const orig = png.textContent ?? '';
                        png.textContent = t('ov.replayPngFail');
                        setTimeout(() => { png.textContent = orig; }, 1500);
                    }
                }
                return;
            }
            const replayOpen = target.closest<HTMLButtonElement>('button[data-replay-open]');
            if (replayOpen) {
                const r = replayCache.get(Number(replayOpen.dataset.replayOpen));
                if (r) {
                    const url = toKc3ReplayUrl(r);
                    if (url.length < KC3_REPLAY_DIRECT_URL_LIMIT) {
                        window.open(url, '_blank', 'noopener');
                    } else {
                        // 壓縮後仍超過瀏覽器 fragment 上限：開空白播放器並複製 JSON。
                        window.open(KC3_REPLAY_PLAYER_URL, '_blank', 'noopener');
                        await copyWithFeedback(replayOpen, JSON.stringify(toKc3Replay(r)), t('ov.replayCopied'));
                    }
                }
                return;
            }
            const deckbuilderCopy = target.closest<HTMLButtonElement>('button[data-deckbuilder-copy]');
            if (deckbuilderCopy) {
                const key = Number(deckbuilderCopy.dataset.deckbuilderCopy);
                const entry = entries.find(item => item.key === key);
                if (entry?.replay) {
                    await copyWithFeedback(
                        deckbuilderCopy,
                        JSON.stringify(buildReplayDeckBuilder(entry.replay), null, 2),
                        t('ov.deckbuilderCopied'),
                    );
                }
                return;
            }
            const airCalcOpen = target.closest<HTMLButtonElement>('button[data-aircalc-open]');
            if (airCalcOpen) {
                const key = Number(airCalcOpen.dataset.aircalcOpen);
                const entry = entries.find(item => item.key === key);
                if (!entry?.replay?.battles.length) return;
                const detail = buildSortieDetail(entry.rows, entry.replay);
                const deck = buildReplayAirCalcDeck(entry.replay, {
                    routeNodes: detail.nodes.map(node => ({
                        node: node.node,
                        enemyIds: node.enemyIds,
                        enemyIdsEscort: node.enemyIdsEscort,
                    })),
                });
                const url = airCalcUrl(deck);
                if (url.length < AIR_CALC_DIRECT_URL_LIMIT) {
                    window.open(url, '_blank', 'noopener');
                } else {
                    window.open(AIR_CALC_PAGE_URL, '_blank', 'noopener');
                    await copyWithFeedback(airCalcOpen, JSON.stringify(deck), t('ov.airCalcCopied'));
                }
                return;
            }
            const simulatorOpen = target.closest<HTMLButtonElement>('button[data-simulator-open]');
            if (simulatorOpen) {
                const key = Number(simulatorOpen.dataset.simulatorOpen);
                const entry = entries.find(item => item.key === key);
                if (!entry?.replay) return;
                const payload = simulatorPayload(entry);
                if (!payload) return;
                try {
                    const { buildSimulatorSettings, simulatorSettingsUrl } = await import('@/utils/sortie-simulator-settings');
                    const settings = buildSimulatorSettings(payload);
                    const url = simulatorSettingsUrl(settings);
                    if (url.length < KC3_SORTIE_SIMULATOR_DIRECT_URL_LIMIT) {
                        window.open(url, '_blank', 'noopener');
                    } else {
                        // 超長設定改下載模擬器原生備份檔，仍可從 Backup 匯入可編輯介面。
                        window.open(KC3_SORTIE_SIMULATOR_URL, '_blank', 'noopener');
                        downloadText(`${replayExportStem(entry.replay)}-simulator.json`, JSON.stringify(settings), 'application/json');
                        simulatorOpen.textContent = t('ov.sortieSimulatorDownloaded');
                    }
                } catch (error) {
                    console.error('[sortie-log] 開啟出擊模擬器失敗', error);
                    simulatorOpen.title = String((error as Error)?.message ?? error);
                }
                return;
            }
            const battleLog = target.closest<HTMLButtonElement>('button[data-battle-log]');
            if (battleLog) {
                const key = Number(battleLog.dataset.battleLog);
                const entry = entries.find(item => item.key === key);
                if (!entry?.replay) return;
                const detail = buildSortieDetail(entry.rows, entry.replay);
                battleDialogBody.innerHTML = battleLogHtml(detail, ctx.state);
                battleDialog.showModal();
                return;
            }
            // ★ 釘選：保留規則永不裁剪釘選場（見 utils/retention.ts）
            const pin = target.closest<HTMLButtonElement>('button[data-replay-pin]');
            if (pin) {
                const key = Number(pin.dataset.replayPin);
                const r = replayCache.get(key);
                if (!r) return;
                r.pinned = !r.pinned;
                await db.replays.update(key, { pinned: r.pinned });
                pin.classList.toggle('on', !!r.pinned);
                pin.textContent = r.pinned ? '★' : '☆';
                return;
            }
            // 🗑 只刪 db.replays 的原始封包，保留 db.sorties 摘要（那場紀錄仍在，只是不能再重播）
            const del = target.closest<HTMLButtonElement>('button[data-replay-del]');
            if (del) {
                const key = Number(del.dataset.replayDel);
                if (!confirm(t('ov.replayDeleteConfirm'))) return;
                await db.replays.delete(key);
                ctx.rerender();
            }
        });

        // 資料載入：失敗／卡住都只影響清單區，工具列與匯入面板照常可用，並如實說明原因。
        body.innerHTML = `<div class="ov-empty">${esc(t('ov.loading'))}</div>`;
        try {
            const [rows, replays] = await Promise.all([
                db.sorties.orderBy('eventId').toArray(),      // 升冪＝時序，「第幾次」據此計數
                db.replays.toArray(),
            ]);
            // 對 legacy replay 的艦隊編號只在對應艦隊完整快照仍在時於讀取層修復；不覆寫
            // IndexedDB，也不對證據不足的匯入資料猜編成。
            const replayByKey = new Map(replays.map(raw => {
                const replay = repairLegacyReplayFleet(raw);
                return [replay.sortieKey, replay] as const;
            }));
            const nth = numberSorties(groupSorties(rows));
            entries = groupSorties(rows).map(g => {
                const first = g.rows[0];
                const replay = replayByKey.get(g.sortieKey);
                const parsed = parseMapCode(first.map);
                const world = replay?.world || parsed.world;
                const mapnum = replay?.mapnum || parsed.mapnum;
                return {
                    key: g.sortieKey, nth: nth.get(g.sortieKey) ?? 0, ts: first.ts,
                    map: first.map, world, mapnum, event: isEventWorld(world),
                    rows: g.rows, replay,
                };
            });
            // 顯示一律新→舊。**依時間排，不依 event ID**——匯入的紀錄拿的是當下最大的 ID，
            // 但它的時間可能是三年前的一場出擊（見 utils/sortie-import.ts）。
            entries.sort((a, b) => b.ts - a.ts);
            replayCache = replayByKey;
        } catch (error) {
            console.error('[sortie-log] 載入出擊紀錄失敗', error);
            body.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            return;
        }

        drawFilters();
        drawList();
    },
};
