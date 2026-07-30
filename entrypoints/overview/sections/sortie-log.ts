// 出擊紀錄：db.sorties 全歷史（面板「紀錄」分頁的完整版）＋每次出擊的 KC3Kai battleplayer
// 重播匯出（資料在 db.replays）。
//
// ── 版面取捨（2026-07-22 改版）──────────────────────────────────────────
// 舊版是「一張海域一塊、底下逐節點一行」的流水帳：看得到結果，看不出**這是哪一次出擊、
// 帶了誰、走了哪條路**——而那正是回頭翻紀錄時真正要問的三件事。改成一次出擊一張卡：
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
//
// ── 資料來源與分工 ────────────────────────────────────────────────────
// 節點序列與勝負來自 db.sorties（摘要，永久保留）；敵艦等級／制空詳情／基地航空隊組成／
// 支援艦隊編組只存在於 db.replays 的**原始封包**裡，故沒有重播的舊出擊只會顯示摘要那半邊
// （UI 明講，不假裝那些資訊不存在）。重建邏輯全在 utils/sortie-detail.ts（純函式、
// 用真封包測試），本檔只負責 DOM 與事件——同 ships.ts／equipment.ts 的分工。
//
// 展開時才跑 `buildSortieDetail()`（內含戰鬥重放），結果快取；摺疊列只用摘要＋快照，
// 不碰封包解析——否則一進分區就要把整個重播層跑一遍。
import type { OverviewSection, SectionContext } from './types';
import { db, type ReplayRow, type SortieLogRow } from '@/utils/db';
import { toKc3Replay } from '@/utils/replay';
import {
    buildSortieDetail, diffLabel, groupSorties, isEventWorld, mapLabel, numberSorties, parseMapCode,
    sortieTime, type LbasWave, type NodeDetail, type SortieDetail, type SortieShip,
} from '@/utils/sortie-detail';
import {
    importSortie, parseSortieImport, SortieImportDuplicateError, SortieImportError,
} from '@/utils/sortie-import';
import { hasNodeLetters, nodeLabel as letterOf } from '@/utils/map-node-letters';
import { nodeKindKey } from '@/utils/map-node-kind';
import type { BattleInfoView, BattleShipView } from '@/utils/state';
import { t } from '@/utils/ui-i18n';
import { bindImportPanel, importPanelHtml, importToggleHtml } from '../import-panel';
import { isDebugUiEnabled } from '@/utils/debug-ui';
import {
    esc, fmtShortTs, fmtTs, downloadText, copyWithFeedback, gearIconHtml,
    loadJsonPrefs, saveJsonPrefs,
} from '../lib';

// KC3Kai 線上重播器（貼上 JSON 即可重播並可另存圖片）
const BATTLEPLAYER_URL = 'https://kc3kai.github.io/kancolle-replay/battleplayer.html';

const SEIKU_KEYS = ['seiku.even', 'seiku.secured', 'seiku.superior', 'seiku.inferior', 'seiku.lost'];
// 陣形 api_formation[0]/[1]：1–6 一般陣形；連合艦隊為 11–14（警戒航行序列，真封包實測
// 61-3／61-5 的我方值為 11–14、敵連合亦出現 14）。中間 7–10 不存在，故留空。
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

export function headHtml(entry: Entry, state: SectionContext['state'], open: boolean): string {
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
    // 匯入徽章只標示「非本機擷取」。Fleet Chronometer 自身的重播匯出通常沒有結算摘要，
    // KC3Kai logger 匯出則可能帶 rating／drop／MVP／EXP；不可由 imported 反推欄位缺席。
    const imported = entry.replay?.imported
        ? `<span class="sl-flag imported" title="${esc(t('ov.slImportedTip'))}">${esc(t('ov.slImported'))}</span>` : '';
    return `
        <button type="button" class="sl-head" aria-expanded="${open}" aria-controls="sl-d-${entry.key}">
            <span class="sl-l1">
                <span class="sl-nth" title="${esc(t('ov.slNthTip', { map: mapLabel(entry), n: entry.nth }))}">#${entry.nth}</span>
                <span class="sl-map${entry.event ? ' ev' : ''}" title="${esc(entry.map)}">${esc(mapLabel(entry))}${diff ? `<i>${esc(diff)}</i>` : ''}</span>
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
        cells.push(`<span class="sl-gear ex" title="${esc(t('ov.shipsEx'))}: ${esc(name)}">${gearIconHtml(state.gearIconId(ship.exequip), name)}</span>`);
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
    // 支援種別（航空系／砲擊系）由封包哪個結構非 null 決定，api_support_flag 只放 title
    const kind = t(entry.use.kind === 'air' ? 'ov.slSupportAir' : 'ov.slSupportShell');
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
                <span class="sl-dim">${esc(t('history.lossKind', { v: n.raidLostKind ?? '?' }))}</span>
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

export function detailHtml(detail: SortieDetail, replay: ReplayRow | undefined, state: SectionContext['state']): string {
    const actions = replay
        ? `<button type="button" class="ov-btn" data-replay-copy="${detail.sortieKey}">${esc(t('ov.replayCopy'))}</button>
           <button type="button" class="ov-btn" data-replay-dl="${detail.sortieKey}">${esc(t('ov.replayDownload'))}</button>
           <a class="ov-btn" href="${BATTLEPLAYER_URL}" target="_blank" rel="noopener">${esc(t('ov.replayOpen'))} ↗</a>
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
                <label class="sl-inline"><span>${esc(t('ov.slMap'))}</span><select class="sl-map-sel"></select></label>
                <span class="grow"></span>
                <span class="sl-count"></span>
                <button type="button" class="ov-btn sl-expand">${esc(t('ov.slExpandAll'))}</button>
                ${importUi}
            </div>
            ${importPanel}
            <div class="sl-body ov-list"></div>
        </div>`;
}

// ── 分區 ────────────────────────────────────────────────────────────────

export const sortieLogSection: OverviewSection = {
    id: 'sortie-log',
    titleKey: 'ov.sortieLog',
    async render(el, ctx) {
        // **先畫殼、再讀資料**（順序是刻意的，別調回去）：資料讀取可能很慢（重播層很大）、
        // 也可能整個卡住（Dexie 版本升級被其他分頁／面板擋住時 open() 會無限等待）。
        // 先前是「讀完才畫」，只要讀取沒回來，整個分區就是一片空白——連「匯入 JSON」都按不到，
        // 使用者只會看到「介面不見了」，卻沒有任何線索。現在殼一定先出現，資料失敗只影響清單。
        el.innerHTML = shellHtml();

        const prefs = loadPrefs();
        let entries: Entry[] = [];
        let mapFilter = 'all';
        const open = new Set<number>();
        const detailCache = new Map<number, string>();

        // 重播列的查表：事件委派（複製／下載／釘選）需要，載入完成後才有內容
        let replayCache = new Map<number, ReplayRow>();

        const catBtns = el.querySelectorAll<HTMLButtonElement>('.sl-cat button');
        const mapSel = el.querySelector<HTMLSelectElement>('.sl-map-sel')!;
        const countEl = el.querySelector<HTMLSpanElement>('.sl-count')!;
        const body = el.querySelector<HTMLDivElement>('.sl-body')!;
        const expandBtn = el.querySelector<HTMLButtonElement>('.sl-expand')!;

        const byCategory = () => entries.filter(e =>
            prefs.cat === 'all' || (prefs.cat === 'event' ? e.event : !e.event));
        const visible = () => byCategory().filter(e => mapFilter === 'all' || e.map === mapFilter);

        // 海域下拉只列**目前分類裡實際有紀錄的**海域（同 equipment 的圖示架：選項隨資料收斂）
        function drawMapOptions() {
            const seen = new Map<string, { label: string; count: number }>();
            for (const e of byCategory()) {
                const hit = seen.get(e.map) ?? { label: mapLabel(e), count: 0 };
                hit.count++;
                seen.set(e.map, hit);
            }
            if (!seen.has(mapFilter)) mapFilter = 'all';
            const opts = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
            mapSel.innerHTML = `<option value="all">${esc(t('ov.slMapAll'))}</option>`
                + opts.map(([map, v]) => `<option value="${esc(map)}" ${map === mapFilter ? 'selected' : ''}>${esc(v.label)}（${v.count}）</option>`).join('');
        }

        function drawList() {
            catBtns.forEach(b => b.classList.toggle('on', b.dataset.cat === prefs.cat));
            const list = visible();
            countEl.textContent = t('ov.slCount', { n: list.length, total: entries.length });
            body.innerHTML = list.length
                ? list.map(e => `<article class="sl-card" data-key="${e.key}">
                    <div class="sl-row">
                        ${headHtml(e, ctx.state, open.has(e.key))}
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
                html = detailHtml(buildSortieDetail(entry.rows, entry.replay), entry.replay, ctx.state);
                detailCache.set(entry.key, html);
            }
            host.innerHTML = html;
            host.dataset.filled = '1';
        }

        catBtns.forEach(btn => btn.addEventListener('click', () => {
            prefs.cat = (btn.dataset.cat as Category) ?? 'all';
            savePrefs(prefs);
            drawMapOptions();
            drawList();
        }));
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
                if (r) downloadText(`replay-${r.world}-${r.mapnum}-${r.sortieKey}.json`, JSON.stringify(toKc3Replay(r)), 'application/json');
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
            const replayByKey = new Map(replays.map(r => [r.sortieKey, r]));
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

        drawMapOptions();
        drawList();
    },
};
