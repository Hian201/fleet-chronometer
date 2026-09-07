// 出擊紀錄「新船掉落與節點關聯」的離線設計預覽。
//
// 這份預覽只呈現候選版面，不改正式 overview。艦名依 master id 產生三語資料，
// 瀏覽器內切換語言即可檢查「顯示文字不再沿用擷取當下語言」的設計方向。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameState } from '../../utils/state';
import { type Lang } from '../../utils/gamedata-i18n';
import { setLang } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const anchorDataUri = `data:image/png;base64,${readFileSync(resolve(root, 'public/icons/tactical/sakura-anchor-new.png')).toString('base64')}`;
const brassCrescentDataUri = `data:image/png;base64,${readFileSync(resolve(root, 'public/icons/tactical/brass-crescent.png')).toString('base64')}`;
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));

const state = new GameState();
state.applyEvent('api_start2/getData', JSON.parse(
    readFileSync(resolve(root, 'samples/start2-master.json'), 'utf8'),
));

type PreviewDrop = { mst: number; newShip: boolean };
type PreviewNodeType = 'battle' | 'branch' | 'submarine' | 'airRecon' | 'airBattle' | 'airRaid' | 'subAir' | 'night' | 'combined' | 'resource' | 'maelstrom' | 'noEnemy' | 'nothing' | 'escort' | 'landing' | 'boss';
type PreviewNode = { label: string; type: PreviewNodeType; night?: boolean };
type PreviewRow = {
    nth: number;
    time: string;
    drop?: PreviewDrop;
    dropNode?: number;
    nodes: PreviewNode[];
};

const names = (mst: number) => {
    const result = {} as Record<Lang, string>;
    for (const lang of ['en', 'zh-TW', 'ja'] as Lang[]) {
        setLang(lang);
        result[lang] = state.shipName(mst);
    }
    return result;
};

const drops = new Map<number, Record<Lang, string>>([
    [35, names(35)],
    [59, names(59)],
    [165, names(165)],
    [26, names(26)],
    [1044, names(1044)],
]);

const nodeKinds: Record<PreviewNodeType, { label: Record<Lang, string> }> = {
    battle: { label: { en: 'Battle', 'zh-TW': '一般戰鬥', ja: '通常戦闘' } },
    branch: { label: { en: 'Active branch', 'zh-TW': '能動分歧', ja: '能動分岐' } },
    submarine: { label: { en: 'Submarine point', 'zh-TW': '潛水點', ja: '潜水マス' } },
    airRecon: { label: { en: 'Air recon', 'zh-TW': '航空偵察', ja: '航空偵察' } },
    airBattle: { label: { en: 'Air battle', 'zh-TW': '航空戰', ja: '航空戦' } },
    airRaid: { label: { en: 'Air raid point', 'zh-TW': '空襲點', ja: '空襲マス' } },
    subAir: { label: { en: 'Submarine + air point', 'zh-TW': '潛空點', ja: '潜水＋空襲マス' } },
    night: { label: { en: 'Night battle point', 'zh-TW': '夜戰點', ja: '夜戦マス' } },
    combined: { label: { en: 'Enemy combined fleet', 'zh-TW': '敵連合艦隊', ja: '敵連合艦隊' } },
    resource: { label: { en: 'Resource point', 'zh-TW': '資源點', ja: '資源マス' } },
    maelstrom: { label: { en: 'Maelstrom', 'zh-TW': '渦潮', ja: '渦潮' } },
    noEnemy: { label: { en: 'No enemy', 'zh-TW': '未遇敵', ja: '敵影を見ず' } },
    nothing: { label: { en: 'Nothing happens', 'zh-TW': '無事發生', ja: '気のせい' } },
    escort: { label: { en: 'Escort success', 'zh-TW': '船團護衛成功', ja: '船団護衛成功' } },
    landing: { label: { en: 'Landing point', 'zh-TW': '揚陸地點', ja: '揚陸地点' } },
    boss: { label: { en: 'Boss point', 'zh-TW': '王點', ja: 'ボスマス' } },
};

const rows: PreviewRow[] = [
    {
        nth: 55, time: '9/5 22:54', drop: { mst: 35, newShip: true }, dropNode: 2,
        nodes: [
            { label: 'P', type: 'battle' }, { label: 'Q', type: 'branch' }, { label: 'Q2', type: 'subAir' },
            { label: 'V', type: 'airRecon' }, { label: 'X', type: 'boss', night: true },
        ],
    },
    {
        nth: 54, time: '9/5 21:52', drop: { mst: 59, newShip: false }, dropNode: 4,
        nodes: [
            { label: 'P', type: 'battle' }, { label: 'Q', type: 'submarine' }, { label: 'Q2', type: 'airRaid' },
            { label: 'V', type: 'branch' }, { label: 'X', type: 'boss', night: true },
        ],
    },
    {
        nth: 53, time: '9/5 21:31', drop: { mst: 165, newShip: true }, dropNode: 3,
        nodes: [
            { label: 'P', type: 'nothing' }, { label: 'Q', type: 'airBattle' }, { label: 'Q2', type: 'night' },
            { label: 'V2', type: 'subAir' }, { label: 'V', type: 'battle' }, { label: 'X', type: 'boss' },
        ],
    },
    {
        nth: 52, time: '9/5 21:16', drop: { mst: 114, newShip: false }, dropNode: 1,
        nodes: [
            { label: 'P', type: 'resource' }, { label: 'Q', type: 'maelstrom' }, { label: 'Q2', type: 'submarine' },
            { label: 'V2', type: 'escort' }, { label: 'V', type: 'combined' }, { label: 'X', type: 'boss', night: true },
        ],
    },
    {
        nth: 51, time: '9/5 21:03', drop: { mst: 26, newShip: true }, dropNode: 0,
        nodes: [
            { label: 'P', type: 'night' }, { label: 'Q', type: 'branch' }, { label: 'Q2', type: 'noEnemy' },
            { label: 'V', type: 'landing' }, { label: 'X', type: 'boss' },
        ],
    },
];

const routeNodeMarkup = (node: PreviewRow['nodes'][number], isDropNode: boolean) => {
    const kind = nodeKinds[node.type];
    const isNightNode = node.night || node.type === 'night';
    const ariaLabels = Object.fromEntries((['en', 'zh-TW', 'ja'] as Lang[]).map(lang => [
        lang,
        `${node.label} ${kind.label[lang]}${isNightNode ? `, ${lang === 'zh-TW' ? '夜戰' : lang === 'ja' ? '夜戦' : 'night battle'}` : ''}`,
    ])) as Record<Lang, string>;
    return `<span class="route-node kind-${node.type}${isNightNode ? ' is-night' : ''}${isDropNode ? ' is-drop-node' : ''}" data-node-labels='${JSON.stringify(ariaLabels)}' data-kind-labels='${JSON.stringify(kind.label)}' aria-label="${esc(ariaLabels.en)}" title="${esc(kind.label.en)}"><span class="node-letter">${esc(node.label)}</span><span class="node-signal" aria-hidden="true"></span></span>`;
};

const newShipMarkup = (row: PreviewRow) => {
    if (!row.drop?.newShip || row.dropNode === undefined) return '';
    const localized = drops.get(row.drop.mst)!;
    const node = row.nodes[row.dropNode];
    const name = localized.en;
    return `<span class="new-ship-summary" data-drop-names='${JSON.stringify(localized)}' data-drop-node="${esc(node.label)}" title="${esc(`New ship drop: ${name} · ${node.label}`)}"><img class="drop-badge" src="${anchorDataUri}" alt="" aria-hidden="true"><span class="ship-name" data-ship-name>${esc(name)}</span><span class="drop-node-label">· ${esc(node.label)}</span></span>`;
};

const card = (row: PreviewRow) => {
    return `<article class="proposal-row">
        <button type="button" class="proposal-head" aria-expanded="false">
            <span class="row-top"><span class="row-nth">#${row.nth}</span><span class="map-badge">E1 <i data-ui-text="hard">Hard</i></span>
                <span class="fleet-title">Fubuki Kai San Go (Type 6) <i>97</i></span><span class="fleet-kind" data-ui-text="singleFleet">Single Fleet</span>
                ${newShipMarkup(row)}<span class="row-meta">${esc(row.time)} <b class="disclosure" aria-hidden="true">▸</b></span>
            </span>
            <span class="row-bottom"><span class="route-track" style="--node-count:${row.nodes.length}">${row.nodes.map((node, index) =>
                `${index > 0 ? '<span class="route-arrow" aria-hidden="true">›</span>' : ''}${routeNodeMarkup(node, row.drop?.newShip === true && row.dropNode === index)}`
            ).join('')}</span></span>
        </button>
        <button type="button" class="pin" aria-label="Pin sortie">☆</button>
    </article>`;
};

const css = `
    :root {
        --bg: #10151d; --panel: #182030; --panel-raised: #202938; --line: #2a3548;
        --text: #cfd6e4; --dim: #8290a7; --brass: #b8860b; --sparkle: #e6c35c;
        --dmg-major: #e05555; --stub: #59667c; --node-branch: #f0f1e8; --node-sub: #62c0c2;
        --node-air: #66a9d7; --node-night: #d7a951; --node-combined: #c48fd5; --node-resource: #d4b83a;
        --node-neutral: #aab4c3; --node-maelstrom: #b29b68; --node-utility: #78b6a0;
        --track-tag: .14em; --track-label: .12em;
    }
    :root[data-theme="light"] { --bg: #f2f0ea; --panel: #fff; --panel-raised: #f4f1ea; --line: #d8d2c4; --text: #2c2f36; --dim: #6b7280; --sparkle: #8a6d1a; --stub: #8b877d; --node-branch: #354052; --node-sub: #147e80; --node-air: #1f6da8; --node-night: #8a6d1a; --node-combined: #7c4e91; --node-resource: #8a6d1a; --node-neutral: #4b5563; --node-maelstrom: #806c42; --node-utility: #286d58; }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Hiragino Sans", sans-serif; }
    button { font: inherit; }
    .proposal { max-width: 1680px; margin: 0 auto; padding: 32px 36px 56px; }
    .proposal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; margin-bottom: 22px; }
    .eyebrow { margin: 0 0 5px; color: var(--sparkle); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -.01em; }
    .intro { max-width: 760px; margin: 8px 0 0; color: var(--dim); }
    .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .control-label { color: var(--dim); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
    .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .seg button, .theme-button { min-height: 34px; padding: 0 11px; border: 0; border-right: 1px solid var(--line); background: var(--panel); color: var(--dim); cursor: pointer; }
    .seg button:last-child { border-right: 0; }
    .seg button.on, .theme-button { color: var(--sparkle); background: color-mix(in srgb, var(--brass) 16%, var(--panel)); }
    .seg button:active, .theme-button:active, .pin:active, .proposal-head:active { transform: scale(.98); }
    .design-note { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; padding: 12px 14px; border: 1px solid var(--line); border-left: 3px solid var(--sparkle); border-radius: 6px; background: var(--panel); }
    .note-mark { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border: 1px solid var(--sparkle); border-radius: 50%; }
    .note-anchor { width: 17px; height: 17px; object-fit: contain; }
    .note-copy { display: grid; gap: 1px; }
    .note-copy strong { font-size: 13px; }
    .note-copy span { color: var(--dim); font-size: 12px; }
    .sortie-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 0 0 14px; border-bottom: 1px solid var(--line); }
    .tool-button, .tool-select { min-height: 36px; padding: 0 13px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); }
    .tool-button.on { border-color: var(--sparkle); color: var(--sparkle); background: color-mix(in srgb, var(--brass) 16%, var(--panel)); }
    .tool-select { min-width: 150px; }
    .toolbar-count { margin-left: auto; color: var(--dim); letter-spacing: .1em; }
    .proposal-list { display: grid; gap: 12px; padding-top: 12px; }
    .proposal-row { display: flex; align-items: stretch; gap: 4px; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .proposal-head { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 9px 14px 10px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .proposal-row .proposal-head { align-items: stretch; }
    .proposal-head:hover { background: color-mix(in srgb, var(--brass) 7%, transparent); }
    .row-top, .row-bottom, .route-track { display: flex; min-width: 0; }
    .row-top { align-items: center; gap: 9px; min-height: 31px; white-space: nowrap; }
    .row-bottom { align-items: center; min-height: 30px; }
    .row-nth { flex: none; min-width: 32px; color: var(--dim); font-weight: 700; font-variant-numeric: tabular-nums; }
    .map-badge { flex: none; padding: 4px 9px; border: 1px solid var(--sparkle); border-radius: 6px; color: var(--sparkle); font-weight: 700; }
    .map-badge i, .fleet-title i { color: var(--dim); font-style: normal; font-size: 11px; font-weight: 400; }
    .fleet-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 15px; font-weight: 600; }
    .fleet-kind { flex: none; padding: 3px 8px; border: 1px solid var(--line); border-radius: 5px; color: var(--dim); font-size: 11px; letter-spacing: .08em; }
    .row-meta { display: flex; align-items: center; gap: 11px; margin-left: auto; flex: none; color: var(--dim); font-variant-numeric: tabular-nums; }
    .new-ship-summary { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 190px; margin-left: auto; color: var(--sparkle); font-size: 13px; font-weight: 700; line-height: 24px; white-space: nowrap; }
    .new-ship-summary + .row-meta { margin-left: 18px; }
    .new-ship-summary .ship-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .drop-node-label { flex: none; color: var(--sparkle); font-weight: 800; }
    .drop-badge { flex: none; width: 18px; height: 18px; object-fit: contain; }
    .row-meta b { color: var(--dim); }
    .route-track { align-items: center; width: min(100%, 680px); height: 30px; padding-left: 76px; }
    .route-node { --kind-color: var(--text); position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 56px; height: 30px; color: var(--text); }
    .node-letter { position: relative; z-index: 1; font-size: 15px; font-weight: 800; line-height: 1; letter-spacing: -.02em; }
    .node-signal { position: absolute; left: 50%; bottom: 3px; width: 22px; height: 0; border-bottom: 2px solid var(--kind-color); transform: translateX(-50%); }
    .route-arrow { flex: 0 0 24px; color: var(--dim); font-size: 19px; line-height: 1; text-align: center; }
    .route-node.kind-branch { --kind-color: var(--node-branch); }
    .route-node.kind-branch .node-signal { height: 4px; border-top: 1px solid var(--kind-color); border-bottom-width: 1px; }
    .route-node.kind-submarine { --kind-color: var(--node-sub); }
    .route-node.kind-submarine .node-signal { border-bottom-style: dotted; border-bottom-width: 3px; }
    .route-node.kind-airRecon { --kind-color: var(--node-air); }
    .route-node.kind-airRecon .node-signal { width: 14px; border-bottom-style: dotted; }
    .route-node.kind-airBattle { --kind-color: var(--node-air); }
    .route-node.kind-airBattle .node-signal { border-bottom-style: dashed; }
    .route-node.kind-airRaid { --kind-color: var(--node-air); }
    .route-node.kind-airRaid .node-signal { height: 5px; border-top: 2px solid var(--kind-color); }
    .route-node.kind-subAir { --kind-color: var(--node-sub); }
    .route-node.kind-subAir .node-signal { height: 5px; border-top: 2px dotted var(--node-air); }
    .route-node.kind-night { --kind-color: var(--node-night); }
    .route-node.kind-night .node-signal { width: 16px; }
    .route-node.kind-combined { --kind-color: var(--node-combined); }
    .route-node.kind-combined .node-signal { height: 5px; border-top: 1px solid var(--kind-color); }
    .route-node.kind-resource { --kind-color: var(--node-resource); }
    .route-node.kind-resource .node-signal { width: 10px; border-bottom-width: 4px; }
    .route-node.kind-maelstrom { --kind-color: var(--node-maelstrom); }
    .route-node.kind-maelstrom .node-signal { width: 18px; border-bottom-style: dashed; border-bottom-width: 3px; }
    .route-node.kind-noEnemy { --kind-color: var(--node-neutral); }
    .route-node.kind-noEnemy .node-signal { border-bottom-style: dashed; }
    .route-node.kind-nothing { --kind-color: var(--stub); }
    .route-node.kind-nothing .node-signal { width: 9px; }
    .route-node.kind-escort { --kind-color: var(--node-utility); }
    .route-node.kind-escort .node-signal { border-bottom-style: dotted; border-bottom-width: 3px; }
    .route-node.kind-landing { --kind-color: var(--node-utility); }
    .route-node.kind-landing .node-signal { height: 5px; border-top: 1px solid var(--kind-color); }
    .route-node.kind-boss { --kind-color: var(--dmg-major); color: var(--dmg-major); }
    .route-node.kind-boss .node-signal { width: 24px; border-bottom-width: 3px; }
    .route-node.is-night .node-letter::after { content: ""; display: inline-block; width: 10px; height: 10px; margin-left: 5px; background: url("${brassCrescentDataUri}") center / contain no-repeat; vertical-align: -1px; opacity: .88; }
    .route-node.is-drop-node .node-letter { color: var(--sparkle); }
    .route-node.is-drop-node::before { content: ""; position: absolute; top: 4px; right: 10px; width: 3px; height: 3px; border-radius: 50%; background: var(--sparkle); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sparkle) 14%, transparent); }
    .node-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 11px; margin: 16px 0 0; color: var(--dim); }
    .legend-title { margin-right: 3px; color: var(--text); font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .legend-item { display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap; font-size: 10px; }
    .legend-sample { flex: 0 0 30px; width: 30px; height: 20px; }
    .legend-sample .node-signal { bottom: 2px; transform: translateX(-50%) scale(.72); }
    .legend-sample .node-letter { display: none; }
    .legend-label { color: var(--dim); }
    .pin { align-self: center; flex: none; width: 52px; height: 52px; margin-right: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-raised); color: var(--text); font-size: 24px; line-height: 1; cursor: pointer; }
    @media (max-width: 920px) {
        .proposal { padding: 24px 18px 40px; }
        .proposal-head { flex-direction: column; }
        .controls { justify-content: flex-start; }
        .row-top { flex-wrap: wrap; }
        .route-track { max-width: 100%; overflow-x: auto; padding-left: 0; scrollbar-width: thin; }
        .row-meta { margin-left: 0; }
        .toolbar-count { margin-left: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
        .seg button, .theme-button, .pin, .proposal-head { transition: none; }
        .seg button:active, .theme-button:active, .pin:active, .proposal-head:active { transform: none; }
    }
    @media (prefers-contrast: more) {
        :root { --line: #6b7a95; --dim: #a9b4c6; }
        .node-signal { border-bottom-width: 3px; }
    }
`;

const ui = {
    en: { eyebrow: 'PROPOSAL / SORTIE LOG', title: 'New ship in the header, route in one band', intro: 'A new ship is summarized in the existing header row and linked back to its node by the shared gold cue; node types stay in compact underline patterns.', noteTitle: 'Two rows, no extra drop lane', noteBody: 'The header owns the new-ship result. The route remains a single 30px band with node names and type signals only.', nodeLegend: 'Node types', newShipDrop: 'New ship drop', all: 'All', normal: 'Normal Maps', event: 'Event Maps', eventSelect: '2026 Summer (431)', map: 'All maps', count: '431 / 786 sorties', lang: 'Language', theme: 'Light theme', hard: 'Hard', singleFleet: 'Single Fleet' },
    'zh-TW': { eyebrow: '提案／出擊記錄', title: '新船放表頭，航路維持單列', intro: '戰鬥評價完全移除；新船摘要併入既有表頭，並用同一個金色提示連回實際掉落 node。node 類型只保留緊湊的底線線型。', noteTitle: '固定兩排，不增加掉落列', noteBody: '表頭負責顯示新船結果，航路固定為 30px 高的單一視覺帶，只留下 node 名稱與類型線索。', nodeLegend: '節點類型', newShipDrop: '新船掉落', all: '全部', normal: '通常海域', event: '活動海域', eventSelect: '2026 夏季（431）', map: '全部海域', count: '431 / 786 場出擊', lang: '語言', theme: '切換亮色', hard: '甲', singleFleet: '單艦隊' },
    ja: { eyebrow: '提案／出撃記録', title: '新艦はヘッダー、航路は一列', intro: '戦闘評価を完全に外し、新艦の概要を既存のヘッダー行へ統合します。同じ金色の手掛かりで実際のドロップノードへ結び、ノード種別は短い下線パターンで示します。', noteTitle: '二行固定、ドロップ行なし', noteBody: '新艦の結果はヘッダーに置き、航路はノード名と種別の手掛かりだけを含む高さ30pxの一列に固定します。', nodeLegend: 'ノード種別', newShipDrop: '新艦ドロップ', all: 'すべて', normal: '通常海域', event: 'イベント海域', eventSelect: '2026 夏イベント（431）', map: '全海域', count: '431 / 786 出撃', lang: '言語', theme: 'ライトテーマ', hard: '甲', singleFleet: '単艦隊' },
} satisfies Record<Lang, Record<string, string>>;

const initial = ui.en;
const legendMarkup = Object.entries(nodeKinds).map(([type, kind]) => `<span class="legend-item"><span class="legend-sample route-node kind-${type}" aria-hidden="true"><span class="node-signal"></span></span><span class="legend-label" data-kind-labels='${JSON.stringify(kind.label)}'>${esc(kind.label.en)}</span></span>`).join('');
const page = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sortie drop node proposal</title><style>${css}</style></head>
<body><main class="proposal">
    <header class="proposal-head"><div><p class="eyebrow" data-ui="eyebrow">${initial.eyebrow}</p>
        <h1 data-ui="title">${initial.title}</h1><p class="intro" data-ui="intro">${initial.intro}</p></div>
        <div class="controls"><span class="control-label" data-ui="lang">${initial.lang}</span>
            <div class="seg language-switch" role="group" aria-label="Language">
                <button type="button" data-lang="en" class="on">English</button><button type="button" data-lang="zh-TW">繁中</button><button type="button" data-lang="ja">日本語</button>
            </div><button type="button" class="theme-button" data-ui="theme" data-theme-toggle>${initial.theme}</button>
        </div></header>
    <aside class="design-note"><span class="note-mark"><img class="note-anchor" src="${anchorDataUri}" alt="" aria-hidden="true"></span><span class="note-copy"><strong data-ui="noteTitle">${initial.noteTitle}</strong><span data-ui="noteBody">${initial.noteBody}</span></span></aside>
    <div class="sortie-toolbar"><button type="button" class="tool-button" data-ui="all">${initial.all}</button><button type="button" class="tool-button" data-ui="normal">${initial.normal}</button><button type="button" class="tool-button on" data-ui="event">${initial.event}</button><button type="button" class="tool-select" data-ui="eventSelect">${initial.eventSelect}⌄</button><button type="button" class="tool-select" data-ui="map">${initial.map}⌄</button><span class="toolbar-count" data-ui="count">${initial.count}</span></div>
    <section class="proposal-list" aria-label="Sortie log proposal">${rows.map(card).join('')}</section>
    <div class="node-legend" data-legend-labels='${JSON.stringify({ en: ui.en.nodeLegend, 'zh-TW': ui['zh-TW'].nodeLegend, ja: ui.ja.nodeLegend })}' aria-label="${esc(initial.nodeLegend)}"><span class="legend-title" data-ui="nodeLegend">${initial.nodeLegend}</span>${legendMarkup}</div>
</main><script>
const ui = ${JSON.stringify(ui)};
const root = document.documentElement;
const applyLang = (lang) => {
    root.lang = lang === 'zh-TW' ? 'zh-TW' : lang;
    for (const [key, value] of Object.entries(ui[lang])) { const el = document.querySelector('[data-ui="' + key + '"]'); if (el) el.textContent = value; document.querySelectorAll('[data-ui-text="' + key + '"]').forEach((node) => node.textContent = value); }
    document.querySelectorAll('[data-kind-labels]').forEach((node) => { const labels = JSON.parse(node.dataset.kindLabels); if (node.classList.contains('legend-label')) node.textContent = labels[lang]; node.setAttribute('title', labels[lang]); });
    document.querySelectorAll('[data-legend-labels]').forEach((node) => { const labels = JSON.parse(node.dataset.legendLabels); node.setAttribute('aria-label', labels[lang]); });
    document.querySelectorAll('[data-node-labels]').forEach((cell) => { const labels = JSON.parse(cell.dataset.nodeLabels); cell.setAttribute('aria-label', labels[lang]); });
    document.querySelectorAll('[data-drop-names]').forEach((node) => { const names = JSON.parse(node.dataset.dropNames); const name = node.querySelector('[data-ship-name]'); if (name) name.textContent = names[lang]; const nodeLabel = node.dataset.dropNode; node.setAttribute('title', ui[lang].newShipDrop + ': ' + names[lang] + ' · ' + nodeLabel); const routeNode = node.closest('.proposal-row').querySelector('.route-node.is-drop-node'); if (routeNode) { const labels = JSON.parse(routeNode.dataset.nodeLabels); routeNode.setAttribute('aria-label', labels[lang] + ', ' + ui[lang].newShipDrop + ': ' + names[lang]); } });
    document.querySelectorAll('[data-lang]').forEach((button) => button.classList.toggle('on', button.dataset.lang === lang));
};
document.querySelectorAll('[data-lang]').forEach((button) => button.addEventListener('click', () => applyLang(button.dataset.lang)));
document.querySelector('[data-theme-toggle]').addEventListener('click', (event) => { const next = root.dataset.theme === 'light' ? 'dark' : 'light'; root.dataset.theme = next; event.currentTarget.textContent = ui[root.lang === 'zh-TW' ? 'zh-TW' : root.lang].theme; });
applyLang('en');
</script></body></html>`;

mkdirSync(resolve(root, '.preview'), { recursive: true });
const out = resolve(root, '.preview/sortie-drop-node-proposal.html');
writeFileSync(out, page);
console.log(out);
