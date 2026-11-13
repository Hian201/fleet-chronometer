// 登出前閒置標記（docs/engineering/fleet-status.md「登出前閒置檢查」）：三語並排，量測圓點是否撐破 370px 內容寬。
// 只畫三排標籤列；樣式與標記 HTML 取自正式面板，數值為假設情境。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idleLabelHtml } from '../../utils/html-escape';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error('無法取得正式面板樣式');

// 一般分頁的標籤名稱在 entrypoints/panel/general.ts 的 copy，這裡照抄三語。
const labels = {
    'zh-TW': { harbor: '母港', quests: '任務', items: '道具', exped: '遠征', dock: '入渠', build: '建造', anchor: '泊地' },
    en: { harbor: 'Harbor', quests: 'Quests', items: 'Items', exped: 'Expeditions', dock: 'Repairs', build: 'Construction', anchor: 'Upkeep' },
    ja: { harbor: '母港', quests: '任務', items: 'アイテム', exped: '遠征', dock: '入渠', build: '建造', anchor: '泊地' },
} as const;
// 假設情境：遠征運作 2 隊、閒置 1 隊；入渠運作 3、可補 1；任務受注 8、達成未領 2；演習剩 3。
const marks = { exped: 1, dock: 1, quests: 2, practice: 3 };

function cell(lang: keyof typeof labels) {
    setLang(lang);
    const l = labels[lang];
    const tip = (key: keyof typeof marks) => t('idle.' + key, { n: marks[key] });
    const mainTabs = (['general', 'sortie', 'exped', 'factory', 'order'] as const).map(key =>
        `<button type="button"${key === 'general' ? ' class="on"' : ''}>${key === 'sortie' ? idleLabelHtml(t('tab.sortie'), tip('practice')) : t('tab.' + key)}</button>`).join('');
    const nav = `<div class="ledger-nav" role="tablist">
        <button type="button" role="tab" aria-selected="true">${idleLabelHtml(l.harbor, null)}</button>
        <button type="button" role="tab" aria-selected="false">${idleLabelHtml(l.quests, tip('quests'))}<span class="count">8</span></button>
        <button type="button" role="tab" aria-selected="false">${idleLabelHtml(l.items, null)}</button></div>`;
    const groups = `<div class="ledger-group-tabs has-anchor" role="tablist">
        <button type="button" role="tab" aria-selected="true">${idleLabelHtml(l.exped, tip('exped'))}<span class="count">2</span></button>
        <button type="button" role="tab" aria-selected="false">${idleLabelHtml(l.dock, tip('dock'))}<span class="count">3</span></button>
        <button type="button" role="tab" aria-selected="false">${idleLabelHtml(l.build, null)}<span class="count">2</span></button>
        <button type="button" role="tab" aria-selected="false">${idleLabelHtml(l.anchor, null)}<span class="count">1</span></button></div>`;
    return `<section class="cell"><h3>${lang}</h3><div class="frame"><div id="tabs">${mainTabs}</div>
        <div class="pad">${nav}<div class="gap"></div>${groups}</div></div><p class="probe"></p></section>`;
}

const pageCss = `
/* 正式面板 html, body 為 overflow:hidden；預覽頁要能捲動。 */
html,body{overflow:auto!important;height:auto!important}
body{margin:0;padding:16px;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
.cells{display:flex;flex-wrap:wrap;gap:16px}
.cell h3{margin:0 0 4px;color:var(--dim);font-size:11px;font-weight:500}
.frame{width:370px;border:1px solid var(--line);background:var(--bg);overflow:hidden}
.pad{padding:6px 8px}.gap{height:56px}
.probe{margin:4px 0 0;color:var(--dim);font-size:10.5px}
.probe.bad{color:#e05555}`;

// 量測：每個按鈕的內容寬不得超過按鈕本身；整排不得超過 370px。
const probe = `<script>document.querySelectorAll('.cell').forEach(cell=>{const bad=[];
cell.querySelectorAll('#tabs,.ledger-nav,.ledger-group-tabs').forEach(row=>{
if(row.scrollWidth>row.clientWidth+0.5)bad.push('整排溢出');
row.querySelectorAll('button').forEach(b=>{if(b.scrollWidth>b.clientWidth+0.5)bad.push((b.textContent||'').trim()+' 溢出')})});
const p=cell.querySelector('.probe');p.textContent=bad.length?bad.join('、'):'370px 內無溢出';p.classList.toggle('bad',bad.length>0)});</script>`;

function page(theme: 'dark' | 'light') {
    return `<!doctype html><html lang="zh-TW" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>閒置標記預覽</title>
<style>${css}\n${pageCss}</style></head><body>
<div class="cells">${(['zh-TW', 'en', 'ja'] as const).map(cell).join('')}</div>
${probe}</body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const theme of ['dark', 'light'] as const) {
    const path = resolve(root, `.preview/panel-idle-marks-${theme}.html`);
    writeFileSync(path, page(theme));
    console.log(path);
}
