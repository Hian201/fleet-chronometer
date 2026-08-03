// 關卡量表（含斬殺期）的**離線版面預覽產生器**（開發用，不進擴充 bundle）。
//
// 為什麼需要它：量表的問題全是版面問題——斬殺態會不會比一般態高、會不會撐寬到讓
// `.s-header` 換行，這些用讀 CSS 是看不出來的，而唯一的實機驗證途徑是「花一次出擊的
// 資源打進斬殺線」，成本高到不可能拿來調字重。本腳本套面板的**同一份 CSS**與同一支
// `sortieGaugeBarHtml()`，把兩種狀態並排輸出成純靜態 HTML，離線即可比對。
//
//   npx vite-node --config vitest.config.ts tools/preview/sortie-gauge.ts
//   → .preview/sortie-gauge.html（瀏覽器直接開）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sortieGaugeBarHtml } from '../../entrypoints/panel/sortie-gauge';
import { setLang, t } from '../../utils/ui-i18n';
import type { Lang } from '../../utils/gamedata-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
// 直接借面板的 <style>，預覽與實機不可能配色/尺寸不一致
const css = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

/** 一列對照：左邊標題列（含海域代號＋節點，重現真實寬度壓力），右邊量表本身 */
function row(label: string, now: number, max: number, finalPhase: boolean): string {
    const hint = finalPhase ? t('sortie.hintEstRuns', { n: 1, kind: t('sortie.kindDefeat') }) : '';
    const bar = sortieGaugeBarHtml({
        now, max, finalPhase,
        title: t('sortie.gaugeTitle', { now, max, hint }),
        finalLabel: t('sortie.zansatsuLabel'),
    });
    // 節點軌跡刻意放到最多，用來檢查標題列會不會被量表擠到換行
    const nodes = ['A', 'C', 'D', 'H', 'K', 'M', 'P']
        .map(n => `<div class="s-node visited${n === 'P' ? ' boss' : ''}">${n}</div>`).join('');
    return `<div class="pv-row">
        <div class="pv-label">${label}</div>
        <div class="sortie-container"><div class="s-header">
            <div class="s-map-id">E2<i>甲</i></div>
            ${bar}
            <div class="s-nodes">${nodes}</div>
            <div class="s-phase active">Boss</div>
        </div></div>
    </div>`;
}

const langs: Lang[] = ['zh-TW', 'ja', 'en'];
let body = '';
for (const lang of langs) {
    setLang(lang);
    body += `<h2>${lang}</h2>`;
    body += row('一般', 2760, 4600, false);
    body += row('斬殺期', 840, 4840, true);
    body += row('斬殺期(floor 1)', 1, 4840, true);
}

const out = `<!doctype html><html><head><meta charset="utf-8">
<title>關卡量表版面預覽</title><style>${css}
body { padding: 16px; background: var(--bg, #1a1f2e); }
h2 { color: var(--dim); font-size: 12px; margin: 18px 0 6px; }
.pv-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
          padding: 4px; outline: 1px dashed rgba(255,255,255,.15); }
.pv-label { width: 110px; color: var(--dim); font-size: 11px; }
/* 面板實際寬度，用來重現換行壓力 */
.sortie-container { width: 420px; }
</style></head><body>
<p style="color:var(--dim);font-size:11px">虛線框＝每列的實際佔用高度。斬殺態與一般態的框高必須相同，
且標題列不得換行。</p>
${body}</body></html>`;

mkdirSync(resolve(root, '.preview'), { recursive: true });
writeFileSync(resolve(root, '.preview/sortie-gauge.html'), out);
console.log('→ .preview/sortie-gauge.html');
