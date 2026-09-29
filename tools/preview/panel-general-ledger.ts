import './panel-general';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, matIconHtml } from '../../utils/html-escape';
import { expedDisplayName, setLang, t } from '../../utils/ui-i18n';
import { itemCatalog, itemDetails, type ItemInventory } from '../../utils/item-catalog';
import {
    localizedQuestDetail, localizedQuestName, localizedQuestRewardHtml,
} from '../../utils/quest-catalog-localization';
import { QUEST_CATALOG_BY_NO } from '../../utils/quest-flow';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const baseline = readFileSync(resolve(root, '.preview/panel-general.html'), 'utf8');
const fleetLiteral = baseline.match(/^const FLEET_HTML = (".*");$/m)?.[1];
if (!css || !fleetLiteral) throw new Error('無法取得正式面板樣式或編成預覽');
const fleetZh = JSON.parse(fleetLiteral) as string;
const featuredQuestNo = 879;
const featuredQuest = (() => {
    const quest = QUEST_CATALOG_BY_NO.get(featuredQuestNo);
    if (!quest) throw new Error(`找不到任務 ${featuredQuestNo} 的離線預覽資料`);
    return quest;
})();

// 假設情境：這些數值只用於版面預覽，正式畫面須採用被動觀測到的資料。
const materials = [
    ['fuel', '348,250'], ['ammo', '350,000'], ['steel', '324,180'], ['bauxite', '298,400'],
    ['torch', '1,420'], ['drum', '2,850'], ['devmat', '2,980'], ['screw', '845'],
] as const;
const operations = {
    exped: [
        { slot: '2', id: 2, name: '長距離練習航海', time: '2:10:04' },
        { slot: '3', id: 5, name: '海上護衛任務', time: '0:42:18' },
        { slot: '4', id: 301, name: '前衛支援任務', time: '0:12:00' },
    ],
    dock: [
        { slot: '1', name: '長門改二', time: '0:04:22' },
        { slot: '2', name: '金剛改二丙', time: '1:20:00' },
        { slot: '3', name: '能代改二', time: '3:05:40' },
        { slot: '4', name: '雪風改二', time: '5:11:08' },
    ],
    build: [
        { slot: '1', name: '島風', time: 'done' },
        { slot: '2', name: '夕立改二', time: '2:00:00' },
        { slot: '3', name: '', time: 'locked' },
        { slot: '4', name: '', time: 'locked' },
    ],
} as const;
const quests = [
    ['敵艦隊を撃破せよ！', 'done', '勝利 3 次。回母港後可領取。', 'Win three times. Return to port to collect.', '3回勝利する。母港に戻ると受け取れます。'],
    ['南西に進出せよ！', '3/5', '在南西諸島海域出擊並獲得勝利。', 'Sortie in the Southwest Islands and win.', '南西諸島海域に出撃し、勝利する。'],
    ['はじめての補給！', 'active', '進行一次補給。', 'Resupply a fleet once.', '艦隊に1回補給する。'],
    ['はじめての入渠！', '1/1', '入渠修復一艘艦娘。', 'Repair one ship in a dock.', '入渠で艦娘を1隻修理する。'],
    ['艦隊の編成', 'active', '編成一支艦隊。', 'Organize a fleet.', '艦隊を編成する。'],
    ['はじめての建造！', 'active', '建造一艘艦娘。', 'Construct one ship.', '艦娘を1隻建造する。'],
    ['遠征任務', '2/3', '成功完成遠征 3 次。', 'Complete three expeditions successfully.', '遠征を3回成功させる。'],
    ['装備開發任務', 'active', '開發一次裝備。', 'Develop one piece of equipment.', '装備を1回開発する。'],
] as const;
type InventoryKey = ItemInventory;
const inventories: Record<InventoryKey, { zh: string; ja: string; en: string }> = {
    standard: { zh: '道具欄', ja: '保有', en: 'Standard' },
    expansion: { zh: '擴張欄', ja: '拡張', en: 'Expansion' },
    other: { zh: '其他', ja: 'その他', en: 'Other' },
};
const labels = {
    'zh-TW': {
        title: '一般分頁・母港、任務與道具', harbor: '母港', quests: '任務', items: '道具', resources: '資材',
        exped: '遠征', dock: '入渠', build: '建造', active: '受注中', done: '完成', locked: '未開放',
        open: '2 / 4 渠已開放',
        sample: '離線版面測試資料；非帳號即時狀態', search: '搜尋所有道具欄（繁中／日文／英文）', searchLabel: '搜尋', searchPlaceholder: '名稱', itemUse: '用途', unavailable: '尚未取得', detailUnknown: '用途說明尚未取得',
        empty: '沒有符合的道具，請調整搜尋文字。',
        material: ['燃料', '彈藥', '鋼材', '鋁土', '建材', '修復', '開發', '改修'],
    },
    en: {
        title: 'General · harbor, quests and items', harbor: 'Harbor', quests: 'Quests', items: 'Items', resources: 'Resources',
        exped: 'Expeditions', dock: 'Repairs', build: 'Construction', active: 'Active', done: 'Done', locked: 'Locked',
        sample: 'Offline layout data; not live account state', open: '2 / 4 docks open',
        search: 'Search all inventories (Chinese / Japanese / English)', searchLabel: 'Search', searchPlaceholder: 'Item name', itemUse: 'Use', unavailable: 'Unavailable', detailUnknown: 'Description unavailable',
        empty: 'No matching items. Adjust your search.',
        material: ['Fuel', 'Ammo', 'Steel', 'Bauxite', 'IC', 'Repair', 'Dev', 'Upgrade'],
    },
    ja: {
        title: '一般・母港、任務、アイテム', harbor: '母港', quests: '任務', items: 'アイテム', resources: '資材',
        exped: '遠征', dock: '入渠', build: '建造', active: '受注中', done: '完了', locked: '未開放',
        open: '2 / 4 建造ドック開放',
        sample: 'オフラインのレイアウト用データ；アカウントの実データではありません', search: 'すべてのアイテム欄を検索（繁体字／日本語／英語）', searchLabel: '検索', searchPlaceholder: 'アイテム名', itemUse: '用途', unavailable: '未取得', detailUnknown: '用途説明未取得',
        empty: '該当する道具がありません。',
        material: ['燃料', '弾薬', '鋼材', 'ボーキサイト', '高速建造材', '高速修復材', '開発資材', '改修資材'],
    },
} as const;
const proposalCss = [
    'html,body{height:auto;overflow:auto}body{display:block;padding:18px}',
    '.preview-heading{margin:0 0 12px;font-size:13px;color:var(--dim)}.preview-heading strong{color:var(--text)}',
    '.mock-panel{position:relative;width:370px;height:850px;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);border:1px solid var(--line)}',
    'body.capture{padding:0;overflow:hidden}body.capture .preview-heading{display:none}body.capture .mock-panel{border:0}',
    '.mock-panel #tabpanel{flex:none;box-sizing:border-box}.mock-panel #fleets{min-height:0;flex:1;overflow:hidden}.mock-panel #tabs button{cursor:default}',
    '#tabpanel.has-general>#tab-general.ledger{display:grid;grid-template-rows:27px minmax(0,1fr);gap:6px}',
    '.ledger-item-grid{flex:1}',
].join('\n');

type PreviewLang = keyof typeof labels;

function translatedFleet(lang: PreviewLang) {
    if (lang === 'zh-TW') return fleetZh;
    return fleetZh.replaceAll('制空', t('fleet.airPowerShort'))
        .replaceAll('索敵(33)', t('fleet.scouting33Short'))
        .replaceAll('索敵倍率', t('fleet.scoutingMultiplier'))
        .replaceAll('航速', t('order.speedShort'))
        .replaceAll('高速', t('speed.fast'))
        .replaceAll('燃料', t('mat.fuel.full'))
        .replaceAll('彈藥', t('mat.ammo.full'));
}

function render(lang: PreviewLang, theme: 'dark' | 'light') {
    setLang(lang);
    const l = labels[lang];
    const materialHtml = materials.map(([key, value], index) =>
        '<div class="ledger-material' + (index > 3 ? ' secondary' : '') + '" title="' + esc(t('mat.' + key + '.full')) + '">' +
        matIconHtml(key, t('mat.' + key + '.full')) + '<span class="value">' + value + '</span></div>').join('');
    const groupHtml = (kind: keyof typeof operations) => {
        const rows = operations[kind].map(item => {
            const locked = item.time === 'locked';
            const name = locked ? l.locked : 'id' in item ? expedDisplayName(item.id, item.name) : item.name;
            const time = item.time === 'done' ? l.done : locked ? '' : item.time;
            return '<div class="ledger-op' + (item.time === 'done' ? ' done' : '') + (locked ? ' locked' : '') +
                '"><span class="slot">' + item.slot + '</span><span class="name" title="' + esc(name) +
                '">' + esc(name) + '</span><span class="time">' + time + '</span></div>';
        }).join('');
        const sub = kind === 'build' ? l.open : String(operations[kind].length);
        return '<section class="ledger-group" data-group="' + kind + '"' + (kind === 'exped' ? '' : ' hidden') +
            '><div class="ledger-group-heading"><strong>' + l[kind] + '</strong><span class="sub">' +
            sub + '</span></div><div class="ledger-group-list">' + rows + '</div></section>';
    };
    // 與正式面板相同：說明／原文／進度三選一；日文介面沒有原文分頁。進度內容為版面示意。
    const featuredPanes = lang === 'ja' ? ['detail', 'progress'] as const : ['detail', 'original', 'progress'] as const;
    const featuredBodies = {
        detail: `${esc(localizedQuestDetail(featuredQuestNo, lang, featuredQuest.detail))}${localizedQuestRewardHtml(featuredQuestNo, lang)}`,
        original: `<p class="ledger-quest-original-name">${esc(featuredQuest.name)}</p><p class="ledger-quest-original-detail">${esc(featuredQuest.detail)}</p>${localizedQuestRewardHtml(featuredQuestNo, 'ja')}`,
        progress: `<div class="ledger-quest-prog"><div>${esc(t('quest.srvConsistent', { srv: t('quest.srv.1') }))}</div><div class="sub">${esc(t('quest.lastBattle', { time: '2026-09-28 21:32', battle: `1-5 ${t('quest.boss')} S`, result: t('quest.counted') }))}</div><button type="button" class="ledger-quest-more">${esc(t('quest.fullLog'))}</button></div>`,
    };
    const featuredQuestHtml = `<details class="ledger-quest" open>
        <summary><span class="name">${esc(localizedQuestName(featuredQuestNo, lang, featuredQuest.name))}</span><span class="state"><i class="quest-tier tier-unchecked">${esc(t('quest.tier.unchecked'))}</i><span class="n est">3/4</span></span><span class="arrow">›</span></summary>
        <div class="description"><div class="ledger-quest-seg" role="group">${featuredPanes.map((pane, index) =>
            `<button type="button" data-quest-pane="${pane}" aria-pressed="${index === 0}">${esc(t(`quest.pane.${pane}`))}</button>`).join('')}</div>${featuredPanes.map((pane, index) =>
            `<div class="ledger-quest-pane" data-quest-pane-body="${pane}"${index === 0 ? '' : ' hidden'}>${featuredBodies[pane]}</div>`).join('')}</div>
    </details>`;
    const questHtml = featuredQuestHtml + quests.slice(1).map(item => {
        const state = item[1] === 'done' ? l.done : item[1] === 'active' ? l.active : item[1];
        return '<details class="ledger-quest' + (item[1] === 'done' ? ' done' : '') + '">' +
            '<summary><span class="name">' + esc(item[0]) + '</span><span class="state">' + state +
            '</span><span class="arrow">›</span></summary><div class="description">' +
            esc(item[lang === 'zh-TW' ? 2 : lang === 'ja' ? 4 : 3]) + '</div></details>';
    }).join('');
    const itemRowsHtml = (inventory: InventoryKey) => itemCatalog.filter(item => item.inventory === inventory).map(item => {
        const name = item.names[lang === 'zh-TW' ? 'zh-TW' : lang === 'ja' ? 'ja' : 'en'];
        const description = itemDetails[inventory + ':' + item.id];
        const detail = description ? lang === 'zh-TW' ? description.zh : lang === 'en' ? description.en : l.detailUnknown : l.detailUnknown;
        const aliases = Object.values(item.names).join(' ').normalize('NFKC').toLocaleLowerCase();
        return '<details class="ledger-item-row" role="listitem" data-name="' + esc(aliases) +
            '"><summary title="' + esc(name) + '" aria-label="' + esc(name + ' · ' + l.unavailable) +
            '"><span class="name">' + esc(name) + '</span><span class="count" aria-label="' + esc(l.unavailable) +
            '">—</span><span class="arrow" aria-hidden="true">›</span></summary><div class="item-detail"><span class="item-detail-label">' +
            l.itemUse + '</span>' + esc(detail) + '</div></details>';
    }).join('');
    const inventoryKeys: InventoryKey[] = ['standard', 'expansion', 'other'];
    const inventoryTabs = inventoryKeys.map((inventory, index) => {
        const info = inventories[inventory];
        const name = info[lang === 'zh-TW' ? 'zh' : lang];
        return '<button type="button" role="tab" id="inventorytab-' + inventory + '" data-inventory="' + inventory +
            '" aria-selected="' + (index === 0) + '" tabindex="' + (index === 0 ? '0' : '-1') +
            '" aria-controls="items-' + inventory + '"><span>' + name +
            '</span><span class="capacity" data-base="—" aria-label="' + esc(l.unavailable) + '">—</span></button>';
    }).join('');
    const inventoryPages = inventoryKeys.map((inventory, index) => {
        const info = inventories[inventory];
        const name = info[lang === 'zh-TW' ? 'zh' : lang];
        return '<section class="ledger-item-page" id="items-' + inventory + '" role="tabpanel" tabindex="0"' +
            ' data-inventory="' + inventory + '" aria-labelledby="inventorytab-' + inventory + '"' + (index ? ' hidden' : '') +
            '><div class="ledger-item-grid" role="list" aria-label="' + name + '">' + itemRowsHtml(inventory) +
            '</div><div class="ledger-item-empty" hidden>' + l.empty + '</div></section>';
    }).join('');
    const itemHtml = '<div class="ledger-item-layout"><div class="ledger-item-bar"><div class="ledger-item-switch" role="tablist" aria-label="' + l.items +
        '">' + inventoryTabs + '</div><button type="button" class="ledger-item-search-toggle" aria-expanded="false" aria-label="' + l.searchLabel +
        '"><svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.2"/><path d="M9.2 9.2 12.5 12.5"/></svg></button></div>' +
        '<div class="ledger-item-tools" hidden><input id="item-search" type="search" aria-label="' + l.search + '" placeholder="' +
        l.searchPlaceholder + '"></div>' + inventoryPages + '</div>';
    const tabs = ['general', 'sortie', 'exped', 'factory', 'order'].map(key =>
        '<button type="button"' + (key === 'general' ? ' class="on"' : '') + '>' + t('tab.' + key) + '</button>').join('');
    const page = '<!doctype html><html lang="' + lang + '" data-theme="' + theme +
        '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
        l.title + '</title><style>' + css + '\n' + proposalCss + '</style></head><body>' +
        '<p class="preview-heading"><strong>' + l.title + '</strong> · 370 × 850 · ' + l.sample + '</p>' +
        '<div class="mock-panel"><div id="header"><span class="idbox"><span class="nick">' +
        t('fleet.default', { n: 1 }) + '</span><span class="num">Lv120</span></span><span class="grow"></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/ship.svg" alt=""> <b>198/250</b></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/equip.svg" alt=""> <b>812/900</b></span></div>' +
        '<div id="tabs">' + tabs + '</div><div id="tabpanel" class="has-general"><div id="tab-general" class="ledger">' +
        '<div class="ledger-nav" role="tablist"><button type="button" role="tab" data-page="harbor" aria-selected="true">' +
        '<span>' + l.harbor + '</span></button><button type="button" role="tab" data-page="quests" aria-selected="false">' +
        '<span>' + l.quests + '</span><span class="count">8</span></button><button type="button" role="tab" data-page="items" aria-selected="false">' +
        '<span>' + l.items + '</span></button></div>' +
        '<div class="ledger-page ledger-harbor" data-page="harbor"><div class="ledger-materials" aria-label="' +
        l.resources + '">' + materialHtml + '</div><div class="ledger-group-tabs" role="tablist">' +
        '<button type="button" role="tab" data-group="exped" aria-selected="true"><span>' + l.exped +
        '</span><span class="count">3</span></button><button type="button" role="tab" data-group="dock" aria-selected="false"><span>' +
        l.dock + '</span><span class="count">4</span></button><button type="button" role="tab" data-group="build" aria-selected="false"><span>' +
        l.build + '</span><span class="count">2</span></button></div>' + groupHtml('exped') + groupHtml('dock') +
        groupHtml('build') + '</div><div class="ledger-page ledger-quests" data-page="quests" hidden>' +
        '<div class="ledger-quest-heading"><strong>' + l.quests +
        '</strong><span>8</span></div><div class="ledger-quest-list" id="quests">' + questHtml + '</div></div>' +
        '<div class="ledger-page ledger-items" data-page="items" hidden>' + itemHtml + '</div></div></div>' +
        '<div id="fleetnav"><button class="on">1</button><button>2</button><button>3</button><button>4</button><button>' +
        t('fleet.combined') + '</button><span class="grow"></span><button>' + t('lbas.button') +
        '</button></div><div id="fleets">' + translatedFleet(lang) + '</div></div>' +
        '<script>if(new URLSearchParams(location.search).has("capture"))document.body.classList.add("capture");' +
        'const panel=document.querySelector(".mock-panel");' +
        'panel.querySelectorAll("[data-quest-pane]").forEach(button=>button.addEventListener("click",()=>{' +
        'const quest=button.closest(".ledger-quest"),pane=button.dataset.questPane;' +
        'quest.querySelectorAll("[data-quest-pane]").forEach(item=>item.setAttribute("aria-pressed",String(item===button)));' +
        'quest.querySelectorAll("[data-quest-pane-body]").forEach(body=>{body.hidden=body.dataset.questPaneBody!==pane})}));' +
        'function select(attr,value){panel.querySelectorAll("[role=tab][data-"+attr+"]").forEach(tab=>tab.setAttribute("aria-selected",String(tab.dataset[attr]===value)));' +
        'panel.querySelectorAll(".ledger-"+(attr==="page"?"page":"group")).forEach(view=>{view.hidden=view.dataset[attr]!==value})}' +
        'panel.querySelectorAll(".ledger-nav [role=tab]").forEach(tab=>tab.addEventListener("click",()=>select("page",tab.dataset.page)));' +
        'panel.querySelectorAll(".ledger-group-tabs [role=tab]").forEach(tab=>tab.addEventListener("click",()=>select("group",tab.dataset.group)));' +
        'const itemRoot=panel.querySelector(".ledger-item-layout"),itemSearch=itemRoot.querySelector("input[type=search]");' +
        'let currentInventory="standard";' +
        'function filterItems(){const term=itemSearch.value.normalize("NFKC").trim().toLocaleLowerCase();' +
        'itemRoot.querySelectorAll(".ledger-item-page").forEach(page=>{let shown=0;' +
        'page.querySelectorAll(".ledger-item-row").forEach(row=>{const visible=row.dataset.name.includes(term);row.hidden=!visible;if(visible)shown++});' +
        'page.querySelector(".ledger-item-empty").hidden=shown!==0});' +
        'itemRoot.querySelectorAll("[role=tab][data-inventory]").forEach(tab=>{const count=itemRoot.querySelectorAll(".ledger-item-page[data-inventory="+tab.dataset.inventory+"] .ledger-item-row:not([hidden])").length;tab.dataset.matches=String(count);const badge=tab.querySelector(".capacity");badge.textContent=term?String(count):badge.dataset.base});' +
        'if(term){const current=itemRoot.querySelector("[role=tab][data-inventory="+currentInventory+"]");if(current.dataset.matches==="0"){const nextMatch=[...itemRoot.querySelectorAll("[role=tab][data-inventory]")].find(tab=>tab.dataset.matches!=="0");if(nextMatch)selectInventory(nextMatch.dataset.inventory)}}}' +
        'function selectInventory(inventory,focusTab=false){currentInventory=inventory;' +
        'itemRoot.querySelectorAll("[role=tab][data-inventory]").forEach(tab=>{const selected=tab.dataset.inventory===inventory;' +
        'tab.setAttribute("aria-selected",String(selected));tab.tabIndex=selected?0:-1;if(selected&&focusTab)tab.focus()});' +
        'itemRoot.querySelectorAll(".ledger-item-page").forEach(page=>{page.hidden=page.dataset.inventory!==inventory})}' +
        'itemRoot.querySelectorAll("[role=tab][data-inventory]").forEach(tab=>{' +
        'tab.addEventListener("click",()=>selectInventory(tab.dataset.inventory));tab.addEventListener("keydown",event=>{' +
        'if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();const tabs=[...itemRoot.querySelectorAll("[role=tab][data-inventory]")];const index=tabs.indexOf(tab);const step=event.key==="ArrowRight"?1:-1;selectInventory(tabs[(index+step+tabs.length)%tabs.length].dataset.inventory,true)}})});' +
        'const searchToggle=itemRoot.querySelector(".ledger-item-search-toggle"),searchRow=itemRoot.querySelector(".ledger-item-tools");' +
        'searchToggle.addEventListener("click",()=>{const open=searchRow.hidden;searchRow.hidden=!open;searchToggle.setAttribute("aria-expanded",String(open));if(!open){itemSearch.value="";filterItems()}(open?itemSearch:searchToggle).focus()});' +
        'itemSearch.addEventListener("input",filterItems);selectInventory("standard");filterItems();' +
        'const params=new URLSearchParams(location.search);if(["quests","items"].includes(params.get("view")))select("page",params.get("view"));' +
        'if(["exped","dock","build"].includes(params.get("group")))select("group",params.get("group"));' +
        'if(["standard","expansion","other"].includes(params.get("inventory")))selectInventory(params.get("inventory"));' +
        '</script></body></html>';
    return page.replaceAll('src="/icons/', 'src="/public/icons/');
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'ja', 'en'] as const) {
    for (const theme of ['dark', 'light'] as const) {
        const path = resolve(root, '.preview/panel-general-ledger-' + lang + '-' + theme + '.html');
        writeFileSync(path, render(lang, theme));
        console.log(path);
    }
}
