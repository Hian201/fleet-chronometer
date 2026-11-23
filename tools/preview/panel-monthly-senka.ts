// 由 panel-sortie.ts 傳入正式面板樣式、出擊場景與七艘編成。
// 方案 A：頁首戰果按鈕只在情報總括勾選後出現；點開後托盤取代 #tabpanel（同為 270px），
// 不覆蓋艦隊編成。收起時機（進點、新戰鬥封包）以面板外的「模擬進點」鈕示意。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { parseHTML } from 'linkedom';
import { sections } from '../../entrypoints/overview/sections';
import { renderSenkaSectionBodyHtml } from '../../entrypoints/overview/sections/senka';
import { senkaHeaderButtonHtml, senkaTrayInnerHtml } from '../../entrypoints/panel/senka-tray';
import { sortieDropSlotHtml } from '../../entrypoints/panel/sortie-drop';
import type { Lang } from '../../utils/gamedata-i18n';
import { esc } from '../../utils/html-escape';
import { LANGS } from '../../utils/lang';
import { localizedQuestName } from '../../utils/quest-catalog-localization';
import { questSenkaCatalogEntry } from '../../utils/quest-senka';
import {
    EO_SENKA_MAPS, senkaMonthWindow, type EoSortieInput, type ExpReading, type QuestClaimInput,
} from '../../utils/senka';
import {
    buildObservedSenkaSummary, formatSenkaInt, formatSenkaRank, formatSignedSenka, senkaDeadlineLines,
} from '../../utils/senka-view';
import { tFor } from '../../utils/ui-i18n';

const bundle = (file: string, globalName: string) => buildSync({
    entryPoints: [fileURLToPath(new URL(file, import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName,
}).outputFiles[0].text;
const headerFitScript = bundle('../../entrypoints/panel/header-fit.ts', 'headerFit');
// 時刻在頁面內用本機時區格式化，與正式介面走同一個 formatTime。
const dateFormatScript = bundle('../../utils/date-format.ts', 'dateFormat');

// 固定基準時刻：2026/11/30 18:00 JST（09:00 UTC），任務戰果已於 05:00Z 截止、月界 13:00Z 剩 4:00。
const NOW_AT = Date.UTC(2026, 10, 30, 9, 0);
const PUBLISHED_AT = Date.UTC(2026, 10, 30, 6);
const timeTag = (ts: number) => `<time data-ts="${ts}"></time>`;

// 僅保留預覽頁控制列、切換文案與第二期離線假資料專屬字串；正式文案一律走 utils/ui-i18n.ts。
interface PreviewCopy {
    longName: string;
    overview: string;
    scenario: string;
    scenarios: [string, string, string, string];
    simulate: string;
    theme: string;
    fixture: string;
    plan: string;
    overviewLink: string;
    place: string;
    placeSection: string;
    placeHeader: string;
    panel: string;
    pinHeader: string;
    stage: string;
    stages: [string, string, string];
    server: string;
}

const previewCopy: Record<Lang, PreviewCopy> = {
    'zh-TW': {
        longName: '12 字提督名',
        overview: '情報總括：頁首顯示本月戰果',
        scenario: '情境',
        scenarios: ['月底追榜', '五位數', '已觀測（EO＋任務）', '缺本月起點'],
        simulate: '模擬進點',
        theme: '淺色／深色',
        fixture: '離線假資料',
        plan: '設計提案',
        overviewLink: '情報總括預覽',
        place: '開關位置',
        placeSection: '戰果分區（建議）',
        placeHeader: '頁首全域設定',
        panel: '面板預覽',
        pinHeader: '面板顯示戰果',
        stage: '內容階段',
        stages: ['1a 普通戰果', '1b 加 EO／任務', '第二期 目標與榜線'],
        server: '柱島',
    },
    en: {
        longName: '12-character name',
        overview: 'Overview: show monthly points in header',
        scenario: 'Scenario',
        scenarios: ['Month end', 'Five digits', 'Observed (EO + quests)', 'No month start'],
        simulate: 'Simulate next node',
        theme: 'Light / Dark',
        fixture: 'Offline sample',
        plan: 'Design proposal',
        overviewLink: 'Overview preview',
        place: 'Switch location',
        placeSection: 'Points section (recommended)',
        placeHeader: 'Global header',
        panel: 'Panel preview',
        pinHeader: 'Panel points',
        stage: 'Stage',
        stages: ['1a Regular', '1b + EO / quests', 'Phase 2 Targets & cutoffs'],
        server: 'Hashirajima',
    },
    ja: {
        longName: '12文字の提督名',
        overview: '情報一覧：見出しに今月の戦果',
        scenario: '場面',
        scenarios: ['月末の追い込み', '5桁', '観測済み（EO・任務）', '月初の基準なし'],
        simulate: '進撃を模擬',
        theme: 'ライト／ダーク',
        fixture: 'オフラインの表示例',
        plan: '設計案',
        overviewLink: '情報総括の表示例',
        place: '切替位置',
        placeSection: '戦果の区画（推奨）',
        placeHeader: '見出しの全体設定',
        panel: 'パネルの表示例',
        pinHeader: 'パネルに戦果',
        stage: '段階',
        stages: ['1a 通常戦果', '1b EO・任務を追加', '第二期 目標とボーダー'],
        server: '柱島',
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

const totalOf = (s: SenkaExample) => s.inherit + s.normal + s.eo + s.quest;
const gainOf = (s: SenkaExample) => totalOf(s) - s.published;

function buildPreviewSummaries(sample: SenkaExample) {
    const win = senkaMonthWindow({ year: 2026, month: 11 });
    const baseExp = 1_000_000;
    const beforeTodayDelta = Math.round(((sample.normal - sample.today) * 10_000) / 7);
    const totalDelta = Math.round((sample.normal * 10_000) / 7);
    const regularReadings: ExpReading[] = [
        { ts: win.start - 10_000, exp: baseExp },
        { ts: win.start + 60_000, exp: baseExp },
        { ts: NOW_AT - 20 * 3_600_000, exp: baseExp + beforeTodayDelta },
        { ts: NOW_AT - 60_000, exp: baseExp + totalDelta },
    ];
    const sorties: EoSortieInput[] = EO_SENKA_MAPS
        .filter(entry => entry.map !== '5-6')
        .map(entry => ({ ts: NOW_AT - 10 * 3_600_000, map: entry.map, cleared: true }));
    const questClaims: QuestClaimInput[] = [
        { eventId: 1, questNo: 893, ts: NOW_AT - 15 * 3_600_000 },
    ];
    const observedExp = Math.round((gainOf(sample) * 10_000) / 7);
    const noStartReadings: ExpReading[] = [
        { ts: win.start + 60_000, exp: baseExp },
        { ts: NOW_AT - 60_000, exp: baseExp + observedExp },
    ];
    return {
        observedSummary: buildObservedSenkaSummary({ readings: regularReadings, sorties, questClaims }, NOW_AT),
        noStartSummary: buildObservedSenkaSummary({ readings: noStartReadings, sorties: [], questClaims: [] }, NOW_AT),
    };
}

function parseHeaderButtonView(buttonHtml: string) {
    const { document } = parseHTML(`<!doctype html><html><body>${buttonHtml}</body></html>`);
    const btn = document.querySelector('#points')!;
    return {
        label: btn.querySelector('.lbl')!.textContent ?? '',
        value: btn.querySelector('b')!.textContent ?? '',
        title: btn.getAttribute('title') ?? '',
    };
}

function parseTrayParts(trayHtml: string) {
    const { document } = parseHTML(`<!doctype html><html><body>${trayHtml}</body></html>`);
    return {
        title: document.querySelector('#senka-title')!.textContent ?? '',
        target: document.querySelector('.ph-target')!.textContent ?? '',
        closeLabel: document.querySelector('#senka-close')!.getAttribute('aria-label') ?? '',
        bodyHtml: document.querySelector('.sn-body')!.outerHTML,
        footHtml: document.querySelector('.sn-foot')!.outerHTML,
    };
}

export function writeMonthlySenkaPreview(root: string, lang: Lang, css: string, sortie: string, side: string, fleet: string) {
    const p = previewCopy[lang];
    const plan = 'docs/panel-monthly-senka-plan.md';
    const sample = readSenkaExample(readFileSync(resolve(root, plan), 'utf8'));
    const signed = new Intl.NumberFormat(lang, { signDisplay: 'always' });
    const { observedSummary, noStartSummary } = buildPreviewSummaries(sample);

    const tabs = ['general', 'sortie', 'exped', 'factory', 'order'].map(key =>
        `<button tabindex="-1" data-key="${key}" class="${key === 'sortie' ? 'on' : ''}">${esc(tFor(lang, 'tab.' + key))}</button>`).join('');
    const { document } = parseHTML('<html><body>' + sortie + '</body></html>');
    document.querySelector('.s-eside')!.innerHTML = side;
    const rail = document.querySelector('.s-action-rail')!;
    rail.replaceChildren(document.querySelector('.s-system-rail')!);
    rail.insertAdjacentHTML('beforeend', sortieDropSlotHtml('', []));
    document.querySelector('.taiha-head')!.textContent = tFor(lang, 'sortie.taihaWarning');
    document.querySelector('.taiha-hint')!.textContent = tFor(lang, 'sortie.taihaRetreatNoEscort');

    const observedBtnHtml = senkaHeaderButtonHtml(observedSummary, false, lang);
    const noStartBtnHtml = senkaHeaderButtonHtml(noStartSummary, false, lang);
    const phase2View = (s: SenkaExample) => {
        const value = `≈${formatSenkaInt(totalOf(s), lang)}`;
        return {
            label: tFor(lang, 'senka.short'),
            value,
            title: `${tFor(lang, 'senka.full')} ${value}`,
        };
    };
    // 情境 1 與 0 只差五位數；2、3 直接由正式 senkaHeaderButtonHtml 取得標籤、數值與無障礙標題。
    const wide = { ...sample, normal: sample.normal + 10000, published: sample.published + 10000, border: sample.border + 10000 };
    const views = [
        phase2View(sample),
        phase2View(wide),
        parseHeaderButtonView(observedBtnHtml),
        parseHeaderButtonView(noStartBtnHtml),
    ];

    const observedTray = parseTrayParts(senkaTrayInnerHtml(observedSummary, lang));
    const noStartTray = parseTrayParts(senkaTrayInnerHtml(noStartSummary, lang));
    const phase2Target = `${p.server} · ${tFor(lang, 'senka.monthShort11')} · ${tFor(lang, 'ov.skFinal500')}`;
    const caseTargets = [phase2Target, phase2Target, observedTray.target, noStartTray.target];

    const row = (label: string, value: string, cls = '') =>
        `<div class="sn-row${cls ? ` ${cls}` : ''}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
    const parts = [
        [tFor(lang, 'senka.partCarry'), 'inherit'],
        [tFor(lang, 'senka.partRegular'), 'normal'],
        [tFor(lang, 'senka.partEo'), 'eo'],
        [tFor(lang, 'senka.partQuest'), 'quest'],
    ] as const;
    const rank500 = tFor(lang, 'senka.rankN', { rank: formatSenkaRank(500, lang) });
    const phase2Body = (s: SenkaExample) => `<div class="sn-body">`
        + row(tFor(lang, 'senka.estimate'), `≈${formatSenkaInt(totalOf(s), lang)}`, 'sn-total')
        + `<div class="sn-comp">${parts.map(([label, key]) => `${esc(label)} ${esc(formatSenkaInt(s[key], lang))}`).join(' · ')}</div>`
        + row(tFor(lang, 'senka.today'), formatSignedSenka(s.today, lang))
        + `<div class="sn-board"><div class="sn-sub">${esc(tFor(lang, 'senka.lastPublished'))} ${timeTag(PUBLISHED_AT)}</div>`
        + `<div class="sn-line">${esc(tFor(lang, 'senka.you'))} ${esc(formatSenkaInt(s.published, lang))} · ${esc(rank500)} ${esc(formatSenkaInt(s.border, lang))}</div>`
        + `<dl>${[
            [tFor(lang, 'senka.gap'), signed.format(s.published - s.border)],
            [tFor(lang, 'senka.since'), formatSignedSenka(gainOf(s), lang)],
            [tFor(lang, 'senka.toCutoff'), formatSignedSenka(totalOf(s) - s.border, lang)],
        ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`
        + `</div>`;
    const phase2FootLines = senkaDeadlineLines(observedSummary.deadlines, lang, { includeQuest: true })
        .map(line => `<span>${esc(line)}</span>`).join('');
    const phase2Foot = `<div class="sn-foot">${phase2FootLines}<span class="sn-note">${esc(tFor(lang, 'senka.unlisted'))}</span></div>`;

    const casesHtml = [
        `${phase2Body(sample)}${phase2Foot}`,
        `${phase2Body(wide)}${phase2Foot}`,
        `${observedTray.bodyHtml}${observedTray.footHtml}`,
        `${noStartTray.bodyHtml}${noStartTray.footHtml}`,
    ].map((inner, i) => `<div class="sn-case" data-case="${i}"${i ? ' hidden' : ''}>${inner}</div>`).join('');

    const stat = (icon: string, label: string, value: string, first = '') =>
        `<span class="stat warn ${first}"><img class="h-icon" src="../public/icons/ui/${icon}.svg" alt="${esc(label)}"><b>${value}</b></span>`;
    const fullTitle = tFor(lang, 'senka.full');
    const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)} · A</title><style>${css}
html,body{height:auto;overflow:auto}body{display:block;padding:16px;background:var(--bg);color:var(--text)}
main{width:max-content;max-width:100%;margin:auto}h1{font-size:20px;margin:0 0 6px}
.controls,footer{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0;max-width:370px}
.controls label{display:inline-flex;align-items:center;gap:5px}select,.controls button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:4px;padding:4px}
a{color:var(--sparkle)}.pv-app{position:relative;width:370px;height:850px;overflow:hidden;display:flex;flex-direction:column;background:var(--bg);outline:1px solid var(--line)}
[hidden]{display:none!important}.pv-app :focus-visible{outline:2px solid var(--sparkle);outline-offset:1px}
.sn-case{display:flex;flex-direction:column;gap:4px;flex:1;min-height:0}.sn-case[hidden]{display:none}
.sn-body[hidden]{display:none}
.sn-sub{color:var(--dim);font-size:11px}
.sn-board{display:flex;flex-direction:column;gap:2px;margin-top:2px;padding-top:4px;border-top:1px solid var(--line)}
.sn-line{font-variant-numeric:tabular-nums}
.sn-board dl{display:grid;grid-template-columns:1fr auto;gap:1px 10px;margin:0}.sn-board dt{color:var(--dim);font-size:11px}
.sn-board dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
</style><main><h1>${esc(fullTitle)} · A</h1><small>${esc(p.fixture)}</small>
<div class="controls"><label>${esc(p.scenario)}<select id="scenario">${p.scenarios.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
<label><input id="overview-pin" type="checkbox" checked>${esc(p.overview)}</label>
<label><input id="long-name" type="checkbox">${esc(p.longName)}</label>
<button id="simulate">${esc(p.simulate)}</button><button id="theme">${esc(p.theme)}</button></div>
<div class="pv-app"><div id="header">
<span class="idbox" id="idbox"><span class="nick">イケン</span><span class="num">Lv120</span></span>
${observedBtnHtml.replace('<button ', '<button hidden ')}
${stat('ship', tFor(lang, 'header.ships'), '439/440', 'first')}${stat('equip', tFor(lang, 'header.equip'), '2150/2153')}
<button class="h-cam" tabindex="-1" aria-label="${esc(tFor(lang, 'photo.title'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.2h2.6L5.8 3.4h4.4l1.2 1.8H14v7.4H2z"/><circle cx="8" cy="8.6" r="2.4"/></svg></button></div>
<div id="tabs">${tabs}</div><div id="tabpanel" inert><div id="tab-sortie">${document.body.innerHTML}</div></div>
<section id="senka-tray" role="region" aria-labelledby="senka-title" hidden>
<div class="ph-head"><span class="ph-title" id="senka-title">${esc(observedTray.title)}</span><span class="ph-target">${esc(phase2Target)}</span><button type="button" class="ph-close" id="senka-close" aria-label="${esc(observedTray.closeLabel)}">✕</button></div>
${casesHtml}
</section>
<div id="fleetnav" inert>${[1, 2, 3, 4, tFor(lang, 'fleet.combined'), tFor(lang, 'lbas.button')].map(n => `<button class="${n === 3 ? 'on' : ''}">${esc(String(n))}</button>`).join('')}</div>
<div id="fleets" inert>${fleet}</div>
</div><footer><a href="../${plan}">${esc(p.plan)}</a>${LANGS.map(l => `<a lang="${l.code}" href="panel-monthly-senka-${l.code}.html">${l.code}</a>`).join('')}<a href="overview-monthly-senka-${lang}.html">${esc(p.overviewLink)}</a></footer></main>
<script>${headerFitScript}</script>
<script>${dateFormatScript}</script>
<script>
const $ = s => document.querySelector(s);
const header = $('#header'), idbox = $('#idbox'), points = $('#points'), tray = $('#senka-tray'), tabpanel = $('#tabpanel');
const trayTarget = $('#senka-tray .ph-target');
const scenario = $('#scenario'), pin = $('#overview-pin'), longName = $('#long-name'), closeButton = $('#senka-close');
const tabButtons = [...document.querySelectorAll('#tabs button')];
const views = ${JSON.stringify(views)}, caseTargets = ${JSON.stringify(caseTargets)};
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
    el.textContent = dateFormat.formatShortDateTime(Number(el.dataset.ts));
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
    const idx = scenario.selectedIndex;
    const view = views[idx];
    idbox.hidden = pin.checked;
    points.hidden = !pin.checked;
    points.querySelector('.lbl').textContent = view.label;
    points.querySelector('b').textContent = view.value;
    points.title = view.title;
    points.setAttribute('aria-label', view.title);
    trayTarget.textContent = caseTargets[idx];
    document.querySelectorAll('[data-case]').forEach((el, i) => el.hidden = i !== idx);
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

let overviewCss = '';

// 情報總括的模擬頁：階段 1 直接沿用正式 renderSenkaSectionBodyHtml，階段 0／2 保留 1a 與第二期對照；側欄順序與正式 sections 一致。
export function writeOverviewSenkaPreview(root: string, lang: Lang) {
    const p = previewCopy[lang];
    const sample = readSenkaExample(readFileSync(resolve(root, 'docs/panel-monthly-senka-plan.md'), 'utf8'));
    const signed = new Intl.NumberFormat(lang, { signDisplay: 'always' });
    const { observedSummary } = buildPreviewSummaries(sample);

    if (!overviewCss) {
        const source = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
        overviewCss = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
    }
    const nav = sections.map(s =>
        `<a href="#"${s.titleKey === 'ov.senka' ? ' class="active"' : ''}>${esc(tFor(lang, s.titleKey))}</a>`,
    ).join('');

    const total = totalOf(sample);
    const cell = (label: string, value: string, note = '') => `<dt>${esc(label)}</dt><dd>${value}</dd><dd class="n">${note}</dd>`;
    const calibratedHtml = esc(tFor(lang, 'ov.skCalibrated', { t: '__TIME__' }))
        .replace('__TIME__', timeTag(Date.UTC(2026, 9, 31, 18)));
    const comp = [
        cell(tFor(lang, 'ov.skPartCarry'), esc(formatSenkaInt(sample.inherit, lang)), calibratedHtml),
        cell(tFor(lang, 'senka.partRegular'), esc(formatSenkaInt(sample.normal, lang))),
        cell(tFor(lang, 'senka.partEo'), esc(formatSenkaInt(sample.eo, lang))),
        cell(tFor(lang, 'senka.partQuest'), esc(formatSenkaInt(sample.quest, lang))),
    ].join('');

    const EO: [string, number, boolean][] = [['1-5', 75, true], ['1-6', 75, true], ['2-5', 100, true], ['3-5', 150, true],
        ['7-5', 170, true], ['4-5', 180, true], ['5-5', 200, true], ['6-5', 250, true], ['5-6', 225, false]];
    const clearedText = tFor(lang, 'ov.skCleared');
    const notClearedText = tFor(lang, 'ov.skNotCleared');
    const eoList = `<details open class="sk-fold"><summary>${esc(tFor(lang, 'ov.skEoTitle', { done: 8, total: 9 }))}</summary><table class="sk-list"><tbody>${EO.map(([area, pts, done]) =>
        `<tr class="${done ? '' : 'sk-off'}"><td>${area}</td><td class="n">${esc(signed.format(pts))}</td><td>${esc(done ? clearedText : notClearedText)}</td></tr>`).join('')}</tbody></table></details>`;
    const q893 = questSenkaCatalogEntry(893);
    const q893Name = localizedQuestName(893, lang, q893?.nameJa ?? '#893');
    const questList = `<details open class="sk-fold"><summary>${esc(tFor(lang, 'ov.skQuestTitle', { n: 1 }))}</summary><table class="sk-list"><tbody>
        <tr><td class="sk-off">893 Bq8</td><td>${esc(q893Name)}</td><td class="n">${esc(signed.format(sample.quest))}</td></tr></tbody></table>
        <p class="sk-hint">${esc(tFor(lang, 'senka.unlisted'))}</p></details>`;

    const stage0Closes = senkaDeadlineLines(observedSummary.deadlines, lang)
        .map(line => `<span>${esc(line)}</span>`).join('');
    const stage0Card = `<div data-only="0"><section class="sk-card">`
        + `<h3>${esc(tFor(lang, 'senka.month11'))}</h3>`
        + `<div class="sk-total"><span class="sk-tl">${esc(tFor(lang, 'ov.skMonthRegular'))}</span><span class="sk-tv">≈${esc(formatSenkaInt(sample.normal, lang))}</span></div>`
        + `<dl class="sk-kv sk-sep">${cell(tFor(lang, 'senka.today'), esc(formatSignedSenka(sample.today, lang)))}</dl>`
        + `<div class="sk-sep sk-closes">${stage0Closes}</div>`
        + `</section></div>`;

    const stage1Wrap = `<div data-only="1" style="display:contents">${renderSenkaSectionBodyHtml(observedSummary, lang)}</div>`;

    const stage2Card = `<section class="sk-card" data-only="2"><h3>${esc(tFor(lang, 'senka.month11'))}</h3>
<div class="sk-total"><span class="sk-tl">${esc(tFor(lang, 'senka.estimate'))}</span><span class="sk-tv">≈${esc(formatSenkaInt(total, lang))}</span></div>
<dl class="sk-kv sk-sep">${comp}</dl>
<dl class="sk-kv sk-sep">${cell(tFor(lang, 'senka.today'), esc(formatSignedSenka(sample.today, lang)))}</dl>
<dl class="sk-kv sk-sep" id="sk-target"></dl>
<div class="sk-sep sk-closes">${senkaDeadlineLines(observedSummary.deadlines, lang, { includeQuest: true }).map(line => `<span>${esc(line)}</span>`).join('')}</div>
</section>`;

    const eoCard = `<section class="sk-card"><h3>${esc(tFor(lang, 'ov.skEoQuestTitle'))}</h3>${eoList}${questList}</section>`;
    const logCols = ['ov.skLogColPublished', 'ov.skLogColYou', 'ov.skLogColRank', 'ov.skLogColCutoff', 'ov.skLogColMode'];
    const addAria = ['ov.skAddRound', 'ov.skAddRank', 'ov.skAddScore'].map(k => tFor(lang, k));
    const logCard = `<section class="sk-card" id="sk-log"><h3>${esc(tFor(lang, 'ov.skLogTitle'))}</h3>
<div class="rl-table-wrap"><table class="rl-table sk-table"><thead><tr>${logCols.map((key, i) => `<th${i === 0 || i === 4 ? '' : ' class="n"'}>${esc(tFor(lang, key))}</th>`).join('')}</tr></thead><tbody id="sk-log-body"></tbody></table></div>
<p class="sk-hint">${esc(tFor(lang, 'ov.skLogHint'))}</p>
<form class="sk-form" id="sk-add"><select id="sk-add-round" aria-label="${esc(addAria[0])}" required></select>
<input id="sk-add-rank" type="number" min="1" step="1" value="500" required aria-label="${esc(addAria[1])}" placeholder="${esc(addAria[1])}">
<input id="sk-add-score" type="number" min="0" step="1" required aria-label="${esc(addAria[2])}" placeholder="${esc(addAria[2])}"><button type="submit">${esc(tFor(lang, 'ov.skAdd'))}</button></form></section>`;

    const dashRange = tFor(lang, 'senka.rangeDash');
    const range = (a: number, b: number) => `${formatSenkaInt(a, lang)}${dashRange}${formatSenkaInt(b, lang)}`;
    const finals = ['ov.skFinalNone', 'ov.skFinal5', 'ov.skFinal20', 'ov.skFinal100', 'ov.skFinal500', 'ov.skFinalOut'].map(k => tFor(lang, k));
    const finalColLabel = tFor(lang, 'ov.skReconColFinal');
    const finalSelect = (month: string, picked: number) => `<select aria-label="${esc(month + ' ' + finalColLabel)}">${finals.map((f, i) => `<option${i === picked ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>`;
    const m11 = tFor(lang, 'senka.monthShort11');
    const m10 = tFor(lang, 'senka.monthShort10');
    const m9 = tFor(lang, 'senka.monthShort9');
    const reconCols = [
        tFor(lang, 'ov.skReconColMonth'), tFor(lang, 'ov.skPartCarry'), tFor(lang, 'senka.partRegular'),
        tFor(lang, 'senka.partEo'), tFor(lang, 'senka.partQuest'), tFor(lang, 'ov.skReconColTotal'),
        tFor(lang, 'ov.skReconColLastRank'), finalColLabel,
    ];
    const reconRows = [
        [`${esc(m11)} <small>${esc(tFor(lang, 'ov.skInProgress'))}</small>`, esc(formatSenkaInt(sample.inherit, lang)), esc(formatSenkaInt(sample.normal, lang)), esc(formatSenkaInt(sample.eo, lang)), esc(formatSenkaInt(sample.quest, lang)), `≈${esc(formatSenkaInt(total, lang))}`, '512', finalSelect(m11, 0)],
        [esc(m10), '295', esc(range(2318, 2331)), esc(formatSenkaInt(1425, lang)), '650', `≈${esc(range(4688, 4701))}`, '467', finalSelect(m10, 4)],
        [esc(m9), '—', `<small>${esc(tFor(lang, 'ov.skStartUnknown'))}</small>`, esc(formatSenkaInt(1200, lang)), '350', '—', '—', finalSelect(m9, 0)],
    ];
    const reconCard = `<section class="sk-card sk-wide" id="sk-recon" data-only="2"><h3>${esc(tFor(lang, 'ov.skReconTitle'))}</h3>
<div class="rl-table-wrap"><table class="rl-table sk-table"><thead><tr>${reconCols.map((col, i) => `<th${i && i < 7 ? ' class="n"' : ''}>${esc(col)}</th>`).join('')}</tr></thead>
<tbody>${reconRows.map(r => `<tr>${r.map((v, i) => `<td${i && i < 7 ? ' class="n"' : ''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<p class="sk-hint">${esc(tFor(lang, 'ov.skReconNote'))}</p></section>`;

    // 第二期頁面內要用的字串與初始榜線紀錄（時刻為 UTC 毫秒，頁面內轉本機時區）；名次序數由 formatSenkaRank 算好。
    const data = {
        lang,
        total,
        ranks: Object.fromEntries([5, 20, 100, 500].map(n => [n, formatSenkaRank(n, lang)])),
        s: {
            cutoffName: tFor(lang, 'ov.skCutoffName'),
            cutoffCell: tFor(lang, 'ov.skCutoffCell'),
            published: tFor(lang, 'ov.skPublished'),
            toCutoff: tFor(lang, 'ov.skToCutoff'),
            toCustom: tFor(lang, 'ov.skToCustom'),
            noCutoff: tFor(lang, 'ov.skNoCutoff'),
            auto: tFor(lang, 'ov.skAuto'),
            manual: tFor(lang, 'ov.skManual'),
        },
        rounds: [PUBLISHED_AT, Date.UTC(2026, 10, 29, 18), Date.UTC(2026, 10, 29, 6), Date.UTC(2026, 9, 31, 18)],
        entries: [
            { ts: PUBLISHED_AT, you: sample.published, rank: 512, cutRank: 500, cutVal: sample.border, mode: 'auto' },
            { ts: Date.UTC(2026, 10, 29, 18), you: 4050, rank: 498, cutRank: 500, cutVal: 4010, mode: 'manual' },
            { ts: Date.UTC(2026, 9, 31, 18), you: 318, rank: null, cutRank: null, cutVal: null, mode: 'auto' },
        ],
    };
    const notes = ['ov.skNoteRegular', 'ov.skNoteObserved', 'ov.skNoteCalibrated'];
    const targetItems: [number, string][] = [
        [5, 'ov.skTarget5'], [20, 'ov.skTarget20'], [100, 'ov.skTarget100'], [500, 'ov.skTarget500'],
    ];
    const html = `<!doctype html><html lang="${lang}" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tFor(lang, 'ov.senka'))} — ${esc(tFor(lang, 'ov.brandShort'))}</title><style>${overviewCss}
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
.sk .ov-toolbar label{display:inline-flex;align-items:center;gap:6px;color:var(--dim);font-size:12px}
.sk .ov-toolbar .grow{flex:1}.sk .ov-toolbar .dim{color:var(--dim);font-size:12px}
#sk-toolbar:not([data-custom="true"]) #sk-custom{display:none}
.sk-side{display:flex;flex-direction:column;gap:16px;min-width:0}
.sk-wide{margin-top:16px}
.sk-table td,.sk-table th{padding:6px 12px}.sk-table th{text-align:left}.sk-table th.n,.sk-table td.n{text-align:right;font-variant-numeric:tabular-nums}
.sk-table small{color:var(--dim);font-size:11px}
.sk-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.sk-form.tried input:invalid,.sk-form.tried select:invalid{outline:2px solid var(--sparkle)}
</style></head><body data-nav="pinned" data-nav-side="left">
<div id="pv"><label>${esc(p.place)}<select id="place"><option value="section">${esc(p.placeSection)}</option><option value="header">${esc(p.placeHeader)}</option></select></label>
<label>${esc(p.stage)}<select id="stage">${p.stages.map((s, i) => `<option value="${i}">${esc(s)}</option>`).join('')}</select></label>
<span class="grow" style="flex:1"></span><a href="panel-monthly-senka-${lang}.html">${esc(p.panel)}</a></div>
<div id="header"><button id="nav-toggle" aria-pressed="true" aria-controls="nav" title="${esc(tFor(lang, 'ov.navHide'))}">⟨</button>
<h1 id="page-title">${esc(tFor(lang, 'ov.title'))}</h1><span class="grow"></span>
<label id="pin-header-label"><input type="checkbox" class="pin" checked>${esc(p.pinHeader)}</label>
<select id="lang-select" title="Language">${LANGS.map(l => `<option value="${l.code}"${l.code === lang ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select>
<button id="theme-toggle" title="Theme">${esc(tFor(lang, 'ov.themeLight'))}</button>
<button id="nav-side-toggle" title="${esc(tFor(lang, 'ov.navSideToRight'))}">⇥</button></div>
<nav id="nav">${nav}</nav>
<main id="content"><div class="sk" id="sk">${notes.map((k, i) => `<p class="ov-note" data-only="${i}">${esc(tFor(lang, k))}</p>`).join('')}
<div class="ov-toolbar" id="sk-toolbar"><label class="rs-inline" id="pin-section-label"><input type="checkbox" class="pin" checked><span>${esc(tFor(lang, 'ov.skPinPanel'))}</span></label>
<label data-min="2">${esc(tFor(lang, 'ov.skTarget'))}<select id="sk-target-select">${targetItems.map(([n, k]) => `<option value="${n}"${n === 500 ? ' selected' : ''}>${esc(tFor(lang, k))}</option>`).join('')}<option value="custom">${esc(tFor(lang, 'ov.skTargetCustom'))}</option></select></label>
<input id="sk-custom" data-min="2" type="number" min="0" step="1" value="4500" aria-label="${esc(tFor(lang, 'ov.skTargetCustom'))}">
<span class="grow" data-min="2"></span><span class="dim" data-min="2">${esc(p.server)}</span></div>
<div class="sk-cols">${stage0Card}${stage1Wrap}${stage2Card}<div class="sk-side" data-only="2">${logCard}${eoCard}</div></div>${reconCard}</div></main>
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
const fmtTs = ts => dateFormat.formatShortDateTime(ts);
const tm = ts => '<time data-ts="' + ts + '">' + fmtTs(ts) + '</time>';
// 已知目標名次直接使用預先算好的 formatSenkaRank；僅手動輸入新名次時使用最小序數 helper。
const ord = n => D.ranks[n] ?? (D.lang === 'en' ? (() => {
    const abs = Math.abs(n), r = abs % 100;
    return n + (r >= 11 && r <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][abs % 10] || 'th');
})() : String(n));
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
const themeLabels = ${JSON.stringify({ dark: tFor(lang, 'ov.themeLight'), light: tFor(lang, 'ov.themeDark') })};
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
