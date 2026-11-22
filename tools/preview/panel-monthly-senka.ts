// 由 panel-sortie.ts 傳入正式面板樣式、出擊場景與七艘編成。
// 方案 A：頁首戰果按鈕只在情報總括勾選後出現；點開後托盤取代 #tabpanel（同為 270px），
// 不覆蓋艦隊編成。收起時機（進點、新戰鬥封包）以面板外的「模擬進點」鈕示意。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { parseHTML } from 'linkedom';
import { sortieDropSlotHtml } from '../../entrypoints/panel/sortie-drop';
import { esc } from '../../utils/html-escape';
import { LANGS } from '../../utils/lang';
import { t } from '../../utils/ui-i18n';

const bundle = (file: string, globalName: string) => buildSync({
    entryPoints: [fileURLToPath(new URL(file, import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName,
}).outputFiles[0].text;
const headerFitScript = bundle('../../entrypoints/panel/header-fit.ts', 'headerFit');
// 時刻在頁面內用本機時區格式化，與正式介面走同一個 formatTime。
const dateFormatScript = bundle('../../utils/date-format.ts', 'dateFormat');

// 固定時間點（UTC）；「剩 4:00」對應模擬現在 09:00Z。
const CLOSE_AT = Date.UTC(2026, 10, 30, 13);
const QUEST_AT = Date.UTC(2026, 10, 30, 5);
const PUBLISHED_AT = Date.UTC(2026, 10, 30, 6);
const timeTag = (ts: number) => `<time data-ts="${ts}"></time>`;

const overviewLink = { 'zh-TW': '情報總括預覽', en: 'Overview preview', ja: '情報総括の表示例' };

const copy = {
    'zh-TW': {
        longName: '12 字提督名', overview: '情報總括：頁首顯示本月戰果', scenario: '情境',
        scenarios: ['月底追榜', '五位數', '僅普通戰果', '缺本月起點'],
        simulate: '模擬進點', theme: '淺色／深色', fixture: '離線假資料', plan: '設計提案',
        full: '本月戰果', trayTitle: '本月戰果', short: '戰果', shortRegular: '普通戰果', close: '關閉本月戰果',
        server: '柱島 · 11 月作戰 · 三群', estimate: '本月戰果推算', regular: '普通戰果',
        regularOnly: 'EO、任務與繼承分未計入', noStart: '本月起點不可考', observed: '觀測期間新增',
        parts: ['繼承', '普通', 'EO', '任務'], today: '今日新增', lastPublished: '上次公布',
        you: '本人', rank: '第 500 名', gap: '當次榜差', since: '統計後新增', toCutoff: '距該榜線',
        cutoff: (t: string) => `普通戰果・EO 截止 ${t} · 剩 4:00`,
        questClosed: (t: string) => `任務戰果已於 ${t} 截止`, unlisted: '未收錄的任務戰果不計入',
    },
    en: {
        longName: '12-character name', overview: 'Overview: show monthly points in header', scenario: 'Scenario',
        scenarios: ['Month end', 'Five digits', 'Regular only', 'No month start'],
        simulate: 'Simulate next node', theme: 'Light / Dark', fixture: 'Offline sample', plan: 'Design proposal',
        full: 'Monthly ranking points', trayTitle: 'Monthly points', short: 'Pts', shortRegular: 'Reg. pts', close: 'Close monthly points',
        server: 'Hashirajima · November · Top 500', estimate: 'Estimated monthly points', regular: 'Regular points',
        regularOnly: 'EO, quest and carry-over points excluded', noStart: 'Monthly start unavailable', observed: 'Earned while observed',
        parts: ['Carry-over', 'Regular', 'EO', 'Quests'], today: 'Today', lastPublished: 'Last published',
        you: 'You', rank: '500th', gap: 'Gap at publication', since: 'Since tally', toCutoff: 'Gap to that cutoff',
        cutoff: (t: string) => `Regular & EO close ${t} · 4:00 left`,
        questClosed: (t: string) => `Quest points closed at ${t}`, unlisted: 'Unlisted quest points are not counted',
    },
    ja: {
        longName: '12文字の提督名', overview: '情報一覧：見出しに今月の戦果', scenario: '場面',
        scenarios: ['月末の追い込み', '5桁', '通常戦果のみ', '月初の基準なし'],
        simulate: '進撃を模擬', theme: 'ライト／ダーク', fixture: 'オフラインの表示例', plan: '設計案',
        full: '今月の戦果', trayTitle: '今月の戦果', short: '戦果', shortRegular: '通常戦果', close: '今月の戦果を閉じる',
        server: '柱島 · 十一月作戦 · 三群', estimate: '今月の推定戦果', regular: '通常戦果',
        regularOnly: 'EO・任務・引継ぎ分は含みません', noStart: '今月の基準値は未取得', observed: '観測中の獲得',
        parts: ['引継', '通常', 'EO', '任務'], today: '本日の獲得', lastPublished: '前回の発表',
        you: '自分', rank: '500位', gap: '発表時の差', since: '集計後の獲得', toCutoff: 'その発表ボーダーとの差',
        cutoff: (t: string) => `通常戦果・EO 締切 ${t} · 残り 4:00`,
        questClosed: (t: string) => `任務戦果は ${t} に締切済み`, unlisted: '未収録の任務戦果は含みません',
    },
};

export interface SenkaExample {
    inherit: number; normal: number; eo: number; quest: number; today: number; published: number; border: number;
}
const SENKA_KEYS = ['inherit', 'normal', 'eo', 'quest', 'today', 'published', 'border'] as const;

export function readSenkaExample(markdown: string): SenkaExample {
    const block = markdown.match(/<!-- senka-preview -->\s*`{3}json\s*([\s\S]*?)\s*`{3}/);
    if (!block) throw new Error('提案缺少月底試排數值');
    const sample = JSON.parse(block[1]);
    for (const key of SENKA_KEYS) {
        if (!Number.isSafeInteger(sample?.[key]) || sample[key] < 0) throw new Error('戰果範例欄位無效：' + key);
    }
    return Object.fromEntries(SENKA_KEYS.map(key => [key, sample[key]])) as unknown as SenkaExample;
}

export function writeMonthlySenkaPreview(root: string, lang: keyof typeof copy, css: string, sortie: string, side: string, fleet: string) {
    const c = copy[lang];
    const plan = 'docs/panel-monthly-senka-plan.md';
    const sample = readSenkaExample(readFileSync(resolve(root, plan), 'utf8'));
    const fmt = new Intl.NumberFormat(lang);
    const signed = new Intl.NumberFormat(lang, { signDisplay: 'always' });
    const tabs = ['general', 'sortie', 'exped', 'factory', 'order'].map(key =>
        `<button tabindex="-1" data-key="${key}" class="${key === 'sortie' ? 'on' : ''}">${t('tab.' + key)}</button>`).join('');
    const { document } = parseHTML('<html><body>' + sortie + '</body></html>');
    document.querySelector('.s-eside')!.innerHTML = side;
    const rail = document.querySelector('.s-action-rail')!;
    rail.replaceChildren(document.querySelector('.s-system-rail')!);
    rail.insertAdjacentHTML('beforeend', sortieDropSlotHtml('', []));
    document.querySelector('.taiha-head')!.textContent = t('sortie.taihaWarning');
    document.querySelector('.taiha-hint')!.textContent = t('sortie.taihaRetreatNoEscort');

    // 情境 1 與 0 只差五位數；2、3 缺資料時不推算總額。
    const wide = { ...sample, normal: sample.normal + 10000, published: sample.published + 10000, border: sample.border + 10000 };
    const totalOf = (s: SenkaExample) => s.inherit + s.normal + s.eo + s.quest;
    const gainOf = (s: SenkaExample) => totalOf(s) - s.published;
    const row = (label: string, value: string, cls = '') => `<div class="sn-row ${cls}"><span>${label}</span><b>${value}</b></div>`;
    const full = (s: SenkaExample) => `${row(c.estimate, '≈' + fmt.format(totalOf(s)), 'sn-total')}
        <div class="sn-comp">${[s.inherit, s.normal, s.eo, s.quest].map((n, i) => `${c.parts[i]} ${fmt.format(n)}`).join(' · ')}</div>
        ${row(c.today, '≈' + signed.format(s.today))}
        <div class="sn-board"><div class="sn-sub">${c.lastPublished} ${timeTag(PUBLISHED_AT)}</div>
        <div class="sn-line">${c.you} ${fmt.format(s.published)} · ${c.rank} ${fmt.format(s.border)}</div>
        <dl>${[[c.gap, signed.format(s.published - s.border)], [c.since, '≈' + signed.format(gainOf(s))],
            [c.toCutoff, '≈' + signed.format(totalOf(s) - s.border)]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
    const bodies = [
        full(sample),
        full(wide),
        `${row(c.regular, '≈' + fmt.format(sample.normal), 'sn-total')}<div class="sn-comp">${c.regularOnly}</div>${row(c.today, '≈' + signed.format(sample.today))}`,
        `${row(c.estimate, '—', 'sn-total')}<div class="sn-comp">${c.noStart}</div>${row(c.observed, '≈' + signed.format(gainOf(sample)))}`,
    ];
    // 頁首值與短標籤：情境 2 只有普通戰果，標籤改稱「普通戰果」。
    const views = [
        { label: c.short, value: '≈' + fmt.format(totalOf(sample)) },
        { label: c.short, value: '≈' + fmt.format(totalOf(wide)) },
        { label: c.shortRegular, value: '≈' + fmt.format(sample.normal) },
        { label: c.short, value: '—' },
    ];
    const stat = (icon: string, label: string, value: string, first = '') =>
        `<span class="stat warn ${first}"><img class="h-icon" src="../public/icons/ui/${icon}.svg" alt="${label}"><b>${value}</b></span>`;
    const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${c.full} · A</title><style>${css}
html,body{height:auto;overflow:auto}body{display:block;padding:16px;background:var(--bg);color:var(--text)}
main{width:max-content;max-width:100%;margin:auto}h1{font-size:20px;margin:0 0 6px}
.controls,footer{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0;max-width:370px}
.controls label{display:inline-flex;align-items:center;gap:5px}select,.controls button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:4px;padding:4px}
a{color:var(--sparkle)}.pv-app{position:relative;width:370px;height:850px;overflow:hidden;display:flex;flex-direction:column;background:var(--bg);outline:1px solid var(--line)}
[hidden]{display:none!important}.pv-app :focus-visible{outline:2px solid var(--sparkle);outline-offset:1px}
#header #points{flex:none;display:inline-flex;align-items:baseline;gap:calc(4px*var(--hs));padding:0;border:0;background:none;color:var(--text);font:inherit;font-size:calc(13px*var(--hs));white-space:nowrap;cursor:pointer}
#header #points b{color:var(--sparkle);font-size:calc(14px*var(--hs));font-variant-numeric:tabular-nums}
/* 托盤比照 #photo-tray：固定 270px、取代 #tabpanel，內容以列高排好，不靠捲動。 */
#senka-tray{display:flex;flex-direction:column;gap:4px;height:270px;padding:6px 8px;overflow:hidden;font-size:12px;line-height:1.3}
#senka-tray .ph-close{margin-left:auto}#senka-tray .ph-title{font-weight:600}
.sn-body{display:flex;flex-direction:column;gap:4px;min-height:0}.sn-body[hidden]{display:none}
.sn-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.sn-row b{font-weight:600;font-variant-numeric:tabular-nums}
.sn-total{font-size:14px;color:var(--sparkle);font-weight:700}.sn-total b{font-weight:700}
.sn-comp,.sn-sub{color:var(--dim);font-size:11px}
.sn-board{display:flex;flex-direction:column;gap:2px;margin-top:2px;padding-top:4px;border-top:1px solid var(--line)}
.sn-line{font-variant-numeric:tabular-nums}
.sn-board dl{display:grid;grid-template-columns:1fr auto;gap:1px 10px;margin:0}.sn-board dt{color:var(--dim);font-size:11px}
.sn-board dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.sn-foot{margin-top:auto;display:flex;flex-direction:column;gap:1px;font-size:11px}.sn-foot .sn-note{color:var(--dim);font-size:10px}
</style><main><h1>${c.full} · A</h1><small>${c.fixture}</small>
<div class="controls"><label>${c.scenario}<select id="scenario">${c.scenarios.map(s => `<option>${s}</option>`).join('')}</select></label>
<label><input id="overview-pin" type="checkbox" checked>${c.overview}</label>
<label><input id="long-name" type="checkbox">${c.longName}</label>
<button id="simulate">${c.simulate}</button><button id="theme">${c.theme}</button></div>
<div class="pv-app"><div id="header">
<span class="idbox" id="idbox"><span class="nick">イケン</span><span class="num">Lv120</span></span>
<button id="points" aria-controls="senka-tray" aria-expanded="false" hidden><span class="lbl"></span> <b></b></button>
${stat('ship', t('header.ships'), '439/440', 'first')}${stat('equip', t('header.equip'), '2150/2153')}
<button class="h-cam" tabindex="-1" aria-label="${t('photo.title')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.2h2.6L5.8 3.4h4.4l1.2 1.8H14v7.4H2z"/><circle cx="8" cy="8.6" r="2.4"/></svg></button></div>
<div id="tabs">${tabs}</div><div id="tabpanel" inert><div id="tab-sortie">${document.body.innerHTML}</div></div>
<section id="senka-tray" role="region" aria-labelledby="senka-title" hidden>
<div class="ph-head"><span class="ph-title" id="senka-title">${c.trayTitle}</span><span class="ph-target">${c.server}</span><button class="ph-close" id="senka-close" aria-label="${c.close}">✕</button></div>
${bodies.map((body, i) => `<div class="sn-body" data-case="${i}" ${i ? 'hidden' : ''}>${body}</div>`).join('')}
<div class="sn-foot"><span>${c.cutoff(timeTag(CLOSE_AT))}</span><span>${c.questClosed(timeTag(QUEST_AT))}</span><span class="sn-note">${c.unlisted}</span></div></section>
<div id="fleetnav" inert>${[1,2,3,4,t('fleet.combined'),t('lbas.button')].map(n => `<button class="${n === 3 ? 'on' : ''}">${n}</button>`).join('')}</div>
<div id="fleets" inert>${fleet}</div>
</div><footer><a href="../${plan}">${c.plan}</a>${Object.keys(copy).map(l => `<a lang="${l}" href="panel-monthly-senka-${l}.html">${l}</a>`).join('')}<a href="overview-monthly-senka-${lang}.html">${overviewLink[lang]}</a></footer></main>
<script>${headerFitScript}</script>
<script>${dateFormatScript}</script>
<script>
const $ = s => document.querySelector(s);
const header = $('#header'), idbox = $('#idbox'), points = $('#points'), tray = $('#senka-tray'), tabpanel = $('#tabpanel');
const scenario = $('#scenario'), pin = $('#overview-pin'), longName = $('#long-name'), closeButton = $('#senka-close');
const tabButtons = [...document.querySelectorAll('#tabs button')];
const views = ${JSON.stringify(views)}, fullName = ${JSON.stringify(c.full)};
const pinKey = 'preview:monthly-senka:overview-pin';
// #open 供截圖：強制釘選、情境 0、開啟托盤，不讀寫儲存。
const forceOpen = location.hash === '#open';
if (!forceOpen) {
    try {
        const saved = localStorage.getItem(pinKey);
        if (saved !== null) pin.checked = saved === 'true';
    } catch { /* 本機檔案禁用儲存時，選擇仍保留到本頁關閉。 */ }
}
// 本機時區的「月/日 時:分」，省略年份（見 design-guidelines §2.6）。
for (const el of document.querySelectorAll('time[data-ts]')) {
    const ts = Number(el.dataset.ts), d = new Date(ts);
    el.textContent = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + dateFormat.formatTime(ts, false);
}
// 開啟時 #tabs 沒有任何 on；收起一律回到出擊分頁。
function setOpen(open, focus) {
    tray.hidden = !open;
    tabpanel.hidden = open;
    points.setAttribute('aria-expanded', String(open));
    for (const b of tabButtons) b.classList.toggle('on', !open && b.dataset.key === 'sortie');
    if (focus === 'close') closeButton.focus();
    else if (focus === 'points') points.focus();
}
// 頁首內容每次變動都重新量測縮放。
function render() {
    const name = longName.checked ? '海風鎮守府第一遊擊艦隊長' : 'イケン';
    idbox.querySelector('.nick').textContent = name;
    idbox.title = name + '　Lv120';
    const view = views[scenario.selectedIndex];
    idbox.hidden = pin.checked;
    points.hidden = !pin.checked;
    points.querySelector('.lbl').textContent = view.label;
    points.querySelector('b').textContent = view.value;
    points.title = points.ariaLabel = fullName + ' ' + view.value;
    document.querySelectorAll('[data-case]').forEach((el, i) => el.hidden = i !== scenario.selectedIndex);
    if (!pin.checked && !tray.hidden) setOpen(false);
    headerFit.fitHeaderScale(header);
}
points.onclick = () => (tray.hidden ? setOpen(true, 'close') : setOpen(false, 'points'));
closeButton.onclick = () => setOpen(false, 'points');
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !tray.hidden) setOpen(false, 'points'); });
for (const b of tabButtons) b.onclick = () => { if (!tray.hidden) setOpen(false); };
$('#simulate').onclick = () => { if (!tray.hidden) setOpen(false, 'points'); };
pin.onchange = () => {
    try { localStorage.setItem(pinKey, String(pin.checked)); } catch { /* 沿用本頁選擇。 */ }
    render();
};
scenario.onchange = longName.onchange = render;
$('#theme').onclick = () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
};
// 模擬正式版 onPrefsChange：情報總括在另一個分頁勾選時，面板被動同步（缺值視為勾選）。
if (!forceOpen) window.addEventListener('storage', e => {
    if (e.key !== pinKey) return;
    pin.checked = e.newValue !== 'false';
    render();
});
if (forceOpen) pin.checked = true;
render();
if (forceOpen) setOpen(true);
document.fonts.ready.then(() => headerFit.fitHeaderScale(header));
</script></html>`;
    writeFileSync(resolve(root, '.preview/panel-monthly-senka-' + lang + '.html'), html.replaceAll('src="/icons/', 'src="../public/icons/'));
}

const overviewCopy = {
    'zh-TW': {
        section: '戰果', place: '開關位置', placeSection: '戰果分區（建議）', placeHeader: '頁首全域設定', panel: '面板預覽',
        pinSection: '在面板頁首顯示本月戰果', pinHeader: '面板顯示戰果',
        month: '本月普通戰果', stage: '內容階段', stages: ['1a 普通戰果', '1b 加 EO／任務', '第二期 目標與榜線'],
        notes: ['依提督經驗值換算普通戰果；EO、任務與繼承分未計入。', '依提督經驗值、EO 擊破與任務領取推算；繼承分未計入。', '依提督經驗值、EO 擊破與任務領取推算，並以榜分校準繼承分。'],
        target: '目標', targets: ['聯合（第 5 名）', '一群（第 20 名）', '二群（第 100 名）', '三群（第 500 名）', '自訂分數'], customAria: '自訂分數', server: '柱島',
        monthTitle: '11 月作戰', observed: '已觀測戰果', exclCarry: '不含繼承分', estimated: '本月戰果推算',
        parts: ['繼承', '普通', 'EO', '任務'], calibrated: '{t} 榜分校準',
        cutoffName: '第 {n} 名榜線', cutoffCell: '第 {n} 名 {v}', published: '{t} 公布', toCutoff: '距該榜線', toCustom: '距自訂目標', noCutoff: '尚未登錄此名次的榜線',
        eoQuestTitle: 'EO 與任務', eoTitle: 'EO 擊破 8／9', cleared: '已擊破', notCleared: '未擊破', questTitle: '任務戰果 1 項',
        questName: '（季） [戰果任務] 確保基地周邊海域的安全 ！',
        logTitle: '榜線紀錄', logCols: ['公布', '本人', '名次', '榜線', '方式'], auto: '自動', manual: '手動',
        logHint: '看排行榜時自動記下本人戰果；其他名次的榜線由你登錄。', addAria: ['榜次', '名次', '戰果'], add: '登錄',
        reconTitle: '逐月對帳', reconCols: ['作戰月份', '繼承', '普通', 'EO', '任務', '推算總額', '最後公開名次', '最終結果'],
        months: ['11 月作戰', '10 月作戰', '9 月作戰'], inProgress: '進行中', startUnknown: '起點不可考', dash: '～',
        finals: ['—', '聯合', '一群', '二群', '三群', '未入選'],
        reconNote: '區間代表月界前後的回港讀數不同，無法確定歸屬。',
    },
    en: {
        section: 'Ranking points', place: 'Switch location', placeSection: 'Points section (recommended)', placeHeader: 'Global header', panel: 'Panel preview',
        pinSection: 'Show monthly points in panel header', pinHeader: 'Panel points',
        month: 'Regular points this month', stage: 'Stage', stages: ['1a Regular', '1b + EO / quests', 'Phase 2 Targets & cutoffs'],
        notes: ['Regular points converted from HQ experience; EO, quest and carry-over points are excluded.', 'Estimated from HQ experience, EO clears and quest claims; carry-over points are excluded.', 'Estimated from HQ experience, EO clears and quest claims, calibrated with ranking scores.'],
        target: 'Target', targets: ['Top 5', 'Top 20', 'Top 100', 'Top 500', 'Custom score'], customAria: 'Custom score', server: 'Hashirajima',
        monthTitle: 'November operation', observed: 'Observed points', exclCarry: 'excl. carry-over', estimated: 'Estimated monthly points',
        parts: ['Carry-over', 'Regular', 'EO', 'Quests'], calibrated: 'calibrated {t}',
        cutoffName: '{n}-place cutoff', cutoffCell: '{n} {v}', published: 'published {t}', toCutoff: 'To that cutoff', toCustom: 'To custom target', noCutoff: 'No cutoff logged for this rank',
        eoQuestTitle: 'EO & quests', eoTitle: 'EO cleared 8/9', cleared: 'Cleared', notCleared: 'Not cleared', questTitle: 'Quest points: 1',
        questName: 'Quarterly Anchorage Region',
        logTitle: 'Cutoff log', logCols: ['Published', 'You', 'Rank', 'Cutoff', 'Entry'], auto: 'Auto', manual: 'Manual',
        logHint: "Your score is saved when you view the ranking; log other ranks' cutoffs yourself.", addAria: ['Round', 'Rank', 'Points'], add: 'Add',
        reconTitle: 'Monthly reconciliation', reconCols: ['Operation', 'Carry-over', 'Regular', 'EO', 'Quests', 'Estimated total', 'Last public rank', 'Final result'],
        months: ['November', 'October', 'September'], inProgress: 'In progress', startUnknown: 'Start unknown', dash: '–',
        finals: ['—', 'Top 5', 'Top 20', 'Top 100', 'Top 500', 'Not ranked'],
        reconNote: 'A range means readings before and after the month boundary differ, so attribution is uncertain.',
    },
    ja: {
        section: '戦果', place: '切替位置', placeSection: '戦果の区画（推奨）', placeHeader: '見出しの全体設定', panel: 'パネルの表示例',
        pinSection: 'パネル見出しに今月の戦果を表示', pinHeader: 'パネルに戦果',
        month: '今月の通常戦果', stage: '段階', stages: ['1a 通常戦果', '1b EO・任務を追加', '第二期 目標とボーダー'],
        notes: ['提督経験値から通常戦果を換算。EO・任務・引継ぎ分は含みません。', '提督経験値・EO 撃破・任務達成から推定。引継ぎ分は含みません。', '提督経験値・EO 撃破・任務達成から推定し、ランキングの戦果で引継ぎ分を補正。'],
        target: '目標', targets: ['総合（5位）', '一群（20位）', '二群（100位）', '三群（500位）', '任意の戦果'], customAria: '任意の戦果', server: '柱島',
        monthTitle: '十一月作戦', observed: '観測済みの戦果', exclCarry: '引継ぎ分を除く', estimated: '今月の推定戦果',
        parts: ['引継ぎ', '通常', 'EO', '任務'], calibrated: '{t} の発表で補正',
        cutoffName: '{n}位ボーダー', cutoffCell: '{n}位 {v}', published: '{t} 発表', toCutoff: 'そのボーダーまで', toCustom: '任意目標まで', noCutoff: 'この順位のボーダーは未登録',
        eoQuestTitle: 'EO と任務', eoTitle: 'EO 撃破 8/9', cleared: '撃破済み', notCleared: '未撃破', questTitle: '任務戦果 1 件',
        questName: '泊地周辺海域の安全確保を徹底せよ！',
        logTitle: 'ボーダー記録', logCols: ['発表', '自分', '順位', 'ボーダー', '記録'], auto: '自動', manual: '手動',
        logHint: 'ランキングを開くと自分の戦果を自動記録。他の順位のボーダーは手動で登録。', addAria: ['発表', '順位', '戦果'], add: '登録',
        reconTitle: '月別照合', reconCols: ['作戦', '引継ぎ', '通常', 'EO', '任務', '推定合計', '最終発表順位', '最終結果'],
        months: ['十一月作戦', '十月作戦', '九月作戦'], inProgress: '進行中', startUnknown: '月初の基準なし', dash: '～',
        finals: ['—', '総合', '一群', '二群', '三群', '圏外'],
        reconNote: '範囲表示は、月境界前後の帰投時の値が異なり帰属を確定できないことを示します。',
    },
};
const NAV_KEYS = ['ov.fleetOverview', 'ov.eventOps', 'ov.ships', 'ov.goals', 'ov.equip', 'ov.equipRef', 'ov.sortieLog', 'ov.routeForecast',
    'ov.dropSubShip', 'ov.exped', 'ov.factory', 'ov.resourceLog', 'ov.questFlow', 'ov.llm', 'ov.backup'];
let overviewCss = '';

// 情報總括的模擬頁：開關放哪裡的兩個候選位置，戰果分區依階段（1a／1b／第二期）切換內容，其餘沿用正式 DOM 與樣式。
export function writeOverviewSenkaPreview(root: string, lang: keyof typeof copy) {
    const o = overviewCopy[lang];
    const c = copy[lang];
    const sample = readSenkaExample(readFileSync(resolve(root, 'docs/panel-monthly-senka-plan.md'), 'utf8'));
    const fmt = new Intl.NumberFormat(lang);
    const signed = new Intl.NumberFormat(lang, { signDisplay: 'always' });
    if (!overviewCss) {
        const source = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
        overviewCss = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
    }
    const nav = NAV_KEYS.flatMap(key => key === 'ov.resourceLog' ? [key, 'sk'] : [key]).map(key =>
        key === 'sk' ? `<a href="#" class="active">${esc(o.section)}</a>` : `<a href="#">${esc(t(key))}</a>`).join('');

    const total = sample.inherit + sample.normal + sample.eo + sample.quest;
    const observed = sample.normal + sample.eo + sample.quest;
    // data-min：階段不低於該值才顯示；data-only：只在該階段顯示（0=1a、1=1b、2=第二期）。
    const totalLine = (stage: number, label: string, value: number, note = '') =>
        `<div class="sk-total" data-only="${stage}"><span class="sk-tl">${esc(label)}</span><span class="sk-tv">≈${fmt.format(value)}${note ? ` <small>${esc(note)}</small>` : ''}</span></div>`;
    const cell = (label: string, value: string, note = '') => `<dt>${esc(label)}</dt><dd>${value}</dd><dd class="n">${note}</dd>`;
    const comp = [
        cell(o.parts[0], `<span data-only="1">—</span><span data-only="2">${fmt.format(sample.inherit)}</span>`,
            `<span data-only="2">${esc(o.calibrated).replace('{t}', `<time data-ts="${Date.UTC(2026, 9, 31, 18)}"></time>`)}</span>`),
        cell(o.parts[1], fmt.format(sample.normal)), cell(o.parts[2], fmt.format(sample.eo)), cell(o.parts[3], fmt.format(sample.quest)),
    ].join('');
    const EO: [string, number, boolean][] = [['1-5', 75, true], ['1-6', 75, true], ['2-5', 100, true], ['3-5', 150, true],
        ['7-5', 170, true], ['4-5', 180, true], ['5-5', 200, true], ['6-5', 250, true], ['5-6', 225, false]];
    const eoList = `<details open data-min="1" class="sk-fold"><summary>${esc(o.eoTitle)}</summary><table class="sk-list"><tbody>${EO.map(([area, pts, done]) =>
        `<tr class="${done ? '' : 'sk-off'}"><td>${area}</td><td class="n">${signed.format(pts)}</td><td>${esc(done ? o.cleared : o.notCleared)}</td></tr>`).join('')}</tbody></table></details>`;
    const questList = `<details open data-min="1" class="sk-fold"><summary>${esc(o.questTitle)}</summary><table class="sk-list"><tbody>
        <tr><td class="sk-off">893 Bq8</td><td>${esc(o.questName)}</td><td class="n">${signed.format(sample.quest)}</td></tr></tbody></table>
        <p class="sk-hint">${esc(c.unlisted)}</p></details>`;
    const monthCard = `<section class="sk-card" id="sk-month"><h3>${esc(o.monthTitle)}</h3>
${totalLine(0, o.month, sample.normal)}${totalLine(1, o.observed, observed, o.exclCarry)}${totalLine(2, o.estimated, total)}
<dl class="sk-kv sk-sep" data-min="1">${comp}</dl>
<dl class="sk-kv sk-sep">${cell(c.today, '≈' + signed.format(sample.today))}</dl>
<dl class="sk-kv sk-sep" id="sk-target" data-only="2"></dl>
<div class="sk-sep sk-closes"><span>${c.cutoff(timeTag(CLOSE_AT))}</span><span>${c.questClosed(timeTag(QUEST_AT))}</span></div>
</section>`;
    const eoCard = `<section class="sk-card" id="sk-eo" data-min="1"><h3>${esc(o.eoQuestTitle)}</h3>${eoList}${questList}</section>`;
    const logCard = `<section class="sk-card" id="sk-log" data-only="2"><h3>${esc(o.logTitle)}</h3>
<div class="rl-table-wrap"><table class="rl-table sk-table"><thead><tr>${o.logCols.map((col, i) => `<th${i === 0 || i === 4 ? '' : ' class="n"'}>${esc(col)}</th>`).join('')}</tr></thead><tbody id="sk-log-body"></tbody></table></div>
<p class="sk-hint">${esc(o.logHint)}</p>
<form class="sk-form" id="sk-add"><select id="sk-add-round" aria-label="${esc(o.addAria[0])}" required></select>
<input id="sk-add-rank" type="number" min="1" step="1" value="500" required aria-label="${esc(o.addAria[1])}" placeholder="${esc(o.addAria[1])}">
<input id="sk-add-score" type="number" min="0" step="1" required aria-label="${esc(o.addAria[2])}" placeholder="${esc(o.addAria[2])}"><button type="submit">${esc(o.add)}</button></form></section>`;
    const range = (a: number, b: number) => `${fmt.format(a)}${o.dash}${fmt.format(b)}`;
    const finalSelect = (month: string, picked: number) => `<select aria-label="${esc(month + ' ' + o.reconCols[7])}">${o.finals.map((f, i) => `<option${i === picked ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>`;
    const reconRows = [
        [`${o.months[0]} <small>${esc(o.inProgress)}</small>`, fmt.format(sample.inherit), fmt.format(sample.normal), fmt.format(sample.eo), fmt.format(sample.quest), '≈' + fmt.format(total), '512', finalSelect(o.months[0], 0)],
        [o.months[1], '295', range(2318, 2331), fmt.format(1425), '650', '≈' + range(4688, 4701), '467', finalSelect(o.months[1], 4)],
        [o.months[2], '—', `<small>${esc(o.startUnknown)}</small>`, fmt.format(1200), '350', '—', '—', finalSelect(o.months[2], 0)],
    ];
    const reconCard = `<section class="sk-card" id="sk-recon" data-only="2"><h3>${esc(o.reconTitle)}</h3>
<div class="rl-table-wrap"><table class="rl-table sk-table"><thead><tr>${o.reconCols.map((col, i) => `<th${i && i < 7 ? ' class="n"' : ''}>${esc(col)}</th>`).join('')}</tr></thead>
<tbody>${reconRows.map(r => `<tr>${r.map((v, i) => `<td${i && i < 7 ? ' class="n"' : ''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<p class="sk-hint">${esc(o.reconNote)}</p></section>`;
    // 第二期頁面內要用的字串與初始榜線紀錄（時刻為 UTC 毫秒，頁面內轉本機時區）。
    const data = {
        lang, total,
        s: { cutoffName: o.cutoffName, cutoffCell: o.cutoffCell, published: o.published, toCutoff: o.toCutoff, toCustom: o.toCustom, noCutoff: o.noCutoff, auto: o.auto, manual: o.manual },
        rounds: [PUBLISHED_AT, Date.UTC(2026, 10, 29, 18), Date.UTC(2026, 10, 29, 6), Date.UTC(2026, 9, 31, 18)],
        entries: [
            { ts: PUBLISHED_AT, you: sample.published, rank: 512, cutRank: 500, cutVal: sample.border, mode: 'auto' },
            { ts: Date.UTC(2026, 10, 29, 18), you: 4050, rank: 498, cutRank: 500, cutVal: 4010, mode: 'manual' },
            { ts: Date.UTC(2026, 9, 31, 18), you: 318, rank: null, cutRank: null, cutVal: null, mode: 'auto' },
        ],
    };
    const html = `<!doctype html><html lang="${lang}" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.section)} — ${esc(t('ov.brandShort'))}</title><style>${overviewCss}
/* 預覽控制列多佔一列；其餘版面與正式頁相同。 */
body{grid-template-rows:40px 48px 1fr;grid-template-areas:"pv pv" "header header" "nav content"}
#pv{grid-area:pv;display:flex;align-items:center;gap:12px;padding:0 16px;overflow:hidden;white-space:nowrap;border-bottom:1px dashed var(--dim);background:var(--bg);font-size:12px}
#pv label{display:inline-flex;align-items:center;gap:6px}#pv select{background:var(--panel);color:var(--text);border:1px dashed var(--dim);border-radius:4px;padding:2px 4px;font:inherit}
#pv a{color:var(--sparkle);flex:none}
[hidden]{display:none!important}
#header label{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dim);white-space:nowrap}
.sk select,.sk input[type=number],.sk button{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font:inherit;font-size:12px}
.sk button{cursor:pointer}.sk button:active{border-color:var(--sparkle);transform:scale(.97)}
.sk input[type=number]{width:96px;font-variant-numeric:tabular-nums}
.sk .ov-toolbar{align-items:center}.sk .ov-toolbar label{display:inline-flex;align-items:center;gap:6px;color:var(--dim);font-size:12px}
.sk .ov-toolbar .grow{flex:1}.sk .ov-toolbar .dim{color:var(--dim);font-size:12px}
#sk-toolbar:not([data-custom="true"]) #sk-custom{display:none}
.sk-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px;align-items:start}
.sk[data-stage="0"] .sk-cols,.sk[data-stage="1"] .sk-cols{display:flex;flex-direction:column;align-items:stretch;max-width:560px}
.sk-side{display:flex;flex-direction:column;gap:16px;min-width:0}
.sk-card h3+.sk-fold{margin-top:0;padding-top:0;border-top:0}
.sk-wide{margin-top:16px}
.sk-card{min-width:0;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.sk-card h3{margin:0 0 8px;font-size:14px;color:var(--sparkle)}
.sk-total{display:flex;flex-direction:column;gap:2px}.sk-tl{color:var(--dim);font-size:12px}
.sk-tv{font-size:24px;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--sparkle)}.sk-tv small{font-size:12px;color:var(--dim)}
.sk-sep{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.sk-kv{display:grid;grid-template-columns:auto auto 1fr;column-gap:16px;row-gap:3px;margin-bottom:0;margin-left:0;margin-right:0;align-items:baseline;font-size:13px}
.sk-kv dt{margin:0;color:var(--dim)}.sk-kv dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.sk-kv dd.n{text-align:left;color:var(--dim);font-size:11px;font-variant-numeric:normal}
.sk-closes{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--dim)}
.sk-fold{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.sk-fold summary{cursor:pointer;font-size:13px}
.sk-list{width:max-content;max-width:100%;margin-top:6px;border-collapse:collapse;font-size:12px}
.sk-list td{padding:2px 0;white-space:nowrap}.sk-list td+td{padding-left:16px}.sk-list td:nth-child(2):not(.n){white-space:normal}
.sk-list td.n{text-align:right;font-variant-numeric:tabular-nums}.sk-off,.sk-off td{color:var(--dim)}
.sk-hint{margin:8px 0 0;font-size:11px;color:var(--dim)}
.sk-table td,.sk-table th{padding:6px 12px}.sk-table th{text-align:left}.sk-table th.n,.sk-table td.n{text-align:right;font-variant-numeric:tabular-nums}
.sk-table small{color:var(--dim);font-size:11px}
.sk-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.sk-form.tried input:invalid,.sk-form.tried select:invalid{outline:2px solid var(--sparkle)}
</style></head><body data-nav="pinned" data-nav-side="left">
<div id="pv"><label>${esc(o.place)}<select id="place"><option value="section">${esc(o.placeSection)}</option><option value="header">${esc(o.placeHeader)}</option></select></label>
<label>${esc(o.stage)}<select id="stage">${o.stages.map((s, i) => `<option value="${i}">${esc(s)}</option>`).join('')}</select></label>
<span class="grow" style="flex:1"></span><a href="panel-monthly-senka-${lang}.html">${esc(o.panel)}</a></div>
<div id="header"><button id="nav-toggle" aria-pressed="true" aria-controls="nav" title="${esc(t('ov.navHide'))}">⟨</button>
<h1 id="page-title">${esc(t('ov.title'))}</h1><span class="grow"></span>
<label id="pin-header-label"><input type="checkbox" class="pin" checked>${esc(o.pinHeader)}</label>
<select id="lang-select" title="Language">${LANGS.map(l => `<option value="${l.code}"${l.code === lang ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select>
<button id="theme-toggle" title="Theme">${esc(t('ov.themeLight'))}</button>
<button id="nav-side-toggle" title="${esc(t('ov.navSideToRight'))}">⇥</button></div>
<nav id="nav">${nav}</nav>
<main id="content"><div class="sk" id="sk">${o.notes.map((n, i) => `<p class="ov-note" data-only="${i}">${esc(n)}</p>`).join('')}
<div class="ov-toolbar" id="sk-toolbar"><label class="rs-inline" id="pin-section-label"><input type="checkbox" class="pin" checked><span>${esc(o.pinSection)}</span></label>
<label data-min="2">${esc(o.target)}<select id="sk-target-select">${[5, 20, 100, 500].map((n, i) => `<option value="${n}"${n === 500 ? ' selected' : ''}>${esc(o.targets[i])}</option>`).join('')}<option value="custom">${esc(o.targets[4])}</option></select></label>
<input id="sk-custom" data-min="2" type="number" min="0" step="1" value="4500" aria-label="${esc(o.customAria)}">
<span class="grow" data-min="2"></span><span class="dim" data-min="2">${esc(o.server)}</span></div>
<div class="sk-cols">${monthCard}<div class="sk-side" data-min="1">${logCard}${eoCard}</div></div>${reconCard.replace('class="sk-card"', 'class="sk-card sk-wide"')}</div></main>
<script>${dateFormatScript}</script>
<script>
const $ = s => document.querySelector(s);
const D = ${JSON.stringify(data)};
const pins = [...document.querySelectorAll('.pin')], place = $('#place'), stageSel = $('#stage'), toolbar = $('#sk-toolbar');
const targetSel = $('#sk-target-select'), customIn = $('#sk-custom'), targetEl = $('#sk-target'), logBody = $('#sk-log-body');
const pinKey = 'preview:monthly-senka:overview-pin', placeKey = 'preview:monthly-senka:overview-placement', stageKey = 'preview:monthly-senka:overview-stage';
stageSel.value = '2';
try {
    pins.forEach(p => p.checked = localStorage.getItem(pinKey) !== 'false');
    if (localStorage.getItem(placeKey) === 'header') place.value = 'header';
    const saved = localStorage.getItem(stageKey);
    if (saved === '0' || saved === '1' || saved === '2') stageSel.value = saved;
} catch { /* 儲存不可用時沿用預設。 */ }
const nf = new Intl.NumberFormat(D.lang), sg = new Intl.NumberFormat(D.lang, { signDisplay: 'always' });
// 本機時區的「月/日 時:分」，省略年份（見 design-guidelines §2.6）。
const fmtTs = ts => { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + dateFormat.formatTime(ts, false); };
const tm = ts => '<time data-ts="' + ts + '">' + fmtTs(ts) + '</time>';
const ord = n => {
    if (D.lang !== 'en') return String(n);
    const r = n % 100;
    return n + (r >= 11 && r <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
};
const dash = v => v == null ? '—' : nf.format(v);
const entries = D.entries.slice();
function renderLog() {
    logBody.innerHTML = entries.map(e => '<tr><td>' + tm(e.ts) + '</td><td class="n">' + dash(e.you) + '</td><td class="n">' + dash(e.rank) + '</td><td class="n">'
        + (e.cutRank == null ? '—' : D.s.cutoffCell.replace('{n}', ord(e.cutRank)).replace('{v}', nf.format(e.cutVal))) + '</td><td>' + (e.mode === 'auto' ? D.s.auto : D.s.manual) + '</td></tr>').join('');
}
// 只改目標區文字；工具列的下拉與輸入框不重繪。
function renderTarget() {
    const row = (k, v, note = '') => '<dt>' + k + '</dt><dd>' + v + '</dd><dd class="n">' + note + '</dd>';
    const gap = (k, n) => row(k, '≈' + sg.format(D.total - n));
    toolbar.dataset.custom = String(targetSel.value === 'custom');
    if (targetSel.value === 'custom') {
        const n = Number(customIn.value);
        targetEl.innerHTML = customIn.value !== '' && Number.isFinite(n) ? gap(D.s.toCustom, n) : row(D.s.toCustom, '—');
        return;
    }
    const rank = Number(targetSel.value), name = D.s.cutoffName.replace('{n}', ord(rank));
    // 同名次取最新公布；同時刻時先登錄的沿用。
    let hit = null;
    for (const e of [...entries].reverse()) if (e.cutRank === rank && (!hit || e.ts > hit.ts)) hit = e;
    targetEl.innerHTML = hit
        ? row(name, nf.format(hit.cutVal), D.s.published.replace('{t}', tm(hit.ts))) + gap(D.s.toCutoff, hit.cutVal)
        : row(name, '—', D.s.noCutoff);
}
function layout() {
    const inHeader = place.value === 'header', stage = Number(stageSel.value);
    $('#pin-header-label').hidden = !inHeader;
    $('#pin-section-label').hidden = inHeader;
    toolbar.hidden = inHeader && stage < 2;
    $('#sk').dataset.stage = stage;
    for (const el of document.querySelectorAll('[data-min]')) el.hidden = stage < Number(el.dataset.min);
    for (const el of document.querySelectorAll('[data-only]')) el.hidden = stage !== Number(el.dataset.only);
}
place.onchange = () => { try { localStorage.setItem(placeKey, place.value); } catch { /* 沿用本頁選擇。 */ } layout(); };
stageSel.onchange = () => { try { localStorage.setItem(stageKey, stageSel.value); } catch { /* 沿用本頁選擇。 */ } layout(); };
for (const p of pins) p.onchange = () => {
    pins.forEach(q => q.checked = p.checked);
    try { localStorage.setItem(pinKey, String(p.checked)); } catch { /* 沿用本頁選擇。 */ }
};
// 另一個分頁（含面板預覽）改了釘選時同步兩個開關。
window.addEventListener('storage', e => { if (e.key === pinKey) pins.forEach(p => p.checked = e.newValue !== 'false'); });
$('#lang-select').onchange = e => { location.href = 'overview-monthly-senka-' + e.target.value + '.html' + location.hash; };
const themeLabels = ${JSON.stringify({ dark: t('ov.themeLight'), light: t('ov.themeDark') })};
$('#theme-toggle').onclick = e => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    e.currentTarget.textContent = themeLabels[next];
};
for (const a of document.querySelectorAll('#nav a')) a.onclick = e => e.preventDefault();
targetSel.onchange = customIn.oninput = renderTarget;
// 登錄榜線：原生驗證擋下空值、負數與小數；通過後插到表格最上方（僅預覽，不存檔）。
const addForm = $('#sk-add'), addRound = $('#sk-add-round');
addRound.innerHTML = D.rounds.map(ts => '<option value="' + ts + '">' + fmtTs(ts) + '</option>').join('');
addForm.addEventListener('invalid', () => addForm.classList.add('tried'), true);
addForm.onsubmit = e => {
    e.preventDefault();
    addForm.classList.remove('tried');
    entries.unshift({ ts: Number(addRound.value), you: null, rank: null, cutRank: Number($('#sk-add-rank').value), cutVal: Number($('#sk-add-score').value), mode: 'manual' });
    renderLog();
    renderTarget();
};
for (const el of document.querySelectorAll('time[data-ts]')) el.textContent = fmtTs(Number(el.dataset.ts));
renderLog();
renderTarget();
layout();
</script></body></html>`;
    writeFileSync(resolve(root, '.preview/overview-monthly-senka-' + lang + '.html'), html);
}
