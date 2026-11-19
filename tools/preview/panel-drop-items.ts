// 面板出擊結算掉落格的離線預覽（開發用，不進擴充 bundle）。
// 套正式面板 CSS 與 entrypoints/panel/sortie-drop.ts 的同一個字串函式，三語各排出
// 「沒有掉落／只有艦娘／只有道具／艦娘＋道具／長名稱」，量測掉落格是否溢出、列高是否維持 35px。
// 艦名與道具名為示意資料；道具名走 utils/item-catalog.ts 的正式譯名。
//
//   npx vite-node --config vitest.config.ts tools/preview/panel-drop-items.ts
//   → .preview/panel-drop-items{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortieDropSlotHtml, type DropItemView } from '../../entrypoints/panel/sortie-drop';
import { esc } from '../../utils/html-escape';
import { useItemDisplayName } from '../../utils/item-catalog';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error('無法取得正式面板樣式');

type Lang = 'zh-TW' | 'en' | 'ja';
const LANGS: Lang[] = ['zh-TW', 'en', 'ja'];

// 與 entrypoints/panel/main.ts 的艦娘掉落晶片相同結構。
const shipChip = (name: string, isNew: boolean) => {
    const state = isNew ? 'new' : 'owned';
    return `<div class="s-drop-chip sakura-drop ${state}" role="group" aria-label="${esc(name)}" title="${esc(`${t('sortie.dropTitle')}：${name}`)}">
        <span class="sakura-drop-icon"><img class="s-sakura-anchor ${state}" src="../public/icons/tactical/sakura-anchor-${state}.png" alt="" draggable="false" /></span>
        <span class="sakura-drop-name">${esc(name)}</span>
      </div>`;
};

const SHIPS: Record<Lang, { short: string; long: string }> = {
    'zh-TW': { short: '睦月', long: 'Commandant Teste改' },
    en: { short: 'Mutsuki', long: 'Commandant Teste Kai' },
    ja: { short: '睦月', long: 'Commandant Teste改' },
};
const item = (lang: Lang, id: number, held: number | null): DropItemView => ({ name: useItemDisplayName(id, lang), held });

function cases(lang: Lang): [string, string][] {
    const ship = SHIPS[lang];
    return [
        ['結算前／沒有掉落', sortieDropSlotHtml('', [])],
        ['只有艦娘', sortieDropSlotHtml(shipChip(ship.short, false), [])],
        ['只有秋刀魚（滿船周回）', sortieDropSlotHtml('', [item(lang, 68, 42)])],
        ['秋刀魚，庫存未觀測', sortieDropSlotHtml('', [item(lang, 68, null)])],
        ['新艦娘＋秋刀魚', sortieDropSlotHtml(shipChip(ship.short, true), [item(lang, 68, 99)])],
        ['長艦名＋長道具名', sortieDropSlotHtml(shipChip(ship.long, false), [item(lang, 12, 1234)])],
    ];
}

function cell(lang: Lang, caption: string, slot: string) {
    return `<section class="cell"><h3>${esc(`${lang}｜${caption}`)}</h3>
        <div class="pv-app" lang="${lang}"><div class="sortie-container">
          <div class="s-action-rail with-system"><div class="pv-rail-stub">系統訊號列</div>${slot}</div>
        </div></div><p class="probe"></p></section>`;
}

const pageCss = `
html,body{overflow:auto!important;height:auto!important}
body{display:block;margin:0;padding:16px;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
.cells{display:flex;flex-wrap:wrap;gap:16px 20px;align-items:flex-start}
.cell h3{margin:0 0 4px;color:var(--dim);font-size:11px;font-weight:500;width:370px}
.pv-app{width:370px;border:1px solid var(--line);background:var(--bg);overflow:hidden}
.pv-app .sortie-container{min-height:0;height:auto}
.pv-rail-stub{border:1px dashed var(--line);color:var(--dim);font-size:10px;display:flex;align-items:center;justify-content:center}
.probe{margin:4px 0 0;color:var(--dim);font-size:10.5px;width:370px}.probe.bad{color:#e05555}
.group{margin:0 0 6px;font-size:13px;color:var(--text)}
section.wrap{margin-bottom:24px}`;

// 量測：掉落格內容不得溢出、整列維持 35px。
const probe = `<script>document.querySelectorAll('.cell').forEach(cell=>{const bad=[];
const rail=cell.querySelector('.s-action-rail');if(Math.round(rail.getBoundingClientRect().height)!==35)bad.push('列高 '+rail.getBoundingClientRect().height+'px');
const slot=cell.querySelector('.s-drop-slot');if(slot.scrollWidth>slot.clientWidth+0.5)bad.push('掉落格溢出');
slot.querySelectorAll('.sakura-drop-name,.s-drop-item-name,.s-drop-item-held').forEach(el=>{if(el.scrollWidth>el.clientWidth+0.5)bad.push('「'+el.textContent+'」省略')});
const p=cell.querySelector('.probe');p.textContent=bad.length?bad.join('、'):'列高 35px、無溢出、無省略';p.classList.toggle('bad',bad.some(x=>!x.startsWith('「')))});</script>`;

function page(theme: 'dark' | 'light') {
    const body = LANGS.map(lang => {
        setLang(lang);
        const cells = cases(lang).map(([caption, slot]) => cell(lang, caption, slot)).join('');
        return `<section class="wrap"><p class="group">${esc(lang)}</p><div class="cells">${cells}</div></section>`;
    }).join('');
    return `<!doctype html><html lang="zh-TW" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>掉落格預覽</title>
<style>${css}\n${pageCss}</style></head><body>${body}${probe}</body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const theme of ['dark', 'light'] as const) {
    const path = resolve(root, `.preview/panel-drop-items${theme === 'light' ? '-light' : ''}.html`);
    writeFileSync(path, page(theme));
    console.log(path);
}
