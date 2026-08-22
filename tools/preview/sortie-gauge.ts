// 關卡量表（含斬殺期）的**離線版面預覽產生器**（開發用，不進擴充 bundle）。
//
// 為什麼需要它：量表的問題全是版面問題——斬殺態會不會比一般態高、會不會撐寬到讓
// `.s-header` 換行，這些用讀 CSS 是看不出來的，而唯一的實機驗證途徑是「花一次出擊的
// 資源打進斬殺線」，成本高到不可能拿來調字重。本腳本套面板的**同一份 CSS**與同一支
// `sortieGaugeBarHtml()`，並把三種 Final pill 方案與殘值 1 的臨界狀態輸出成純靜態 HTML，離線即可比對。
//
//   npx vite-node --config vitest.config.ts tools/preview/sortie-gauge.ts
//   → .preview/sortie-gauge.html（瀏覽器直接開）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sortieGaugeBarHtml } from '../../entrypoints/panel/sortie-gauge';
import { esc } from '../../utils/html-escape';
import { setLang, t } from '../../utils/ui-i18n';
import type { Lang } from '../../utils/gamedata-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
// 直接借面板的 <style>，預覽與實機不可能配色/尺寸不一致
const css = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

// 容量檢查固定放 10 個節點（含 Boss）；僅驗證標頭寬度，不表示實際海域路線。
const nodeLetters = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'B'];

function nodeHtml(): string {
    return nodeLetters
        .map(n => `<div class="s-node visited${n === 'B' ? ' boss' : ''}">${n}</div>`)
        .join('');
}

type GaugeVariant = 'split' | 'focus' | 'critical';

/** 只供離線比較的三種 Final pill；不改正式 sortieGaugeBarHtml。 */
function variantBarHtml(variant: GaugeVariant, now: number, max: number): string {
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(100 * now / max))) : 0;
    const critical = now <= 1 ? ' critical' : '';
    const label = 'Final';
    const value = esc(String(now));
    const total = esc(String(max));
    const title = esc(`Final ${now}/${max}`);
    const fill = `<i class="pv-gauge-fill" style="width:${pct}%"></i>`;
    const alert = variant === 'critical' ? '<span class="pv-gauge-alert" aria-hidden="true">!</span>' : '';

    return `<span class="pv-gauge-shell pv-gauge-shell-${variant}" role="meter" aria-label="${title}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}" title="${title}">
        <span class="pv-gauge-variant pv-gauge-${variant}${critical}">${fill}${alert}<span class="pv-gauge-label">${label}</span></span>
        <span class="pv-gauge-external final"><strong>${value}</strong><small>/${total}</small></span>
    </span>`;
}

/** 一列對照：左邊標題列（含海域代號＋節點，重現真實寬度壓力），右邊量表本身 */
function row(label: string, now: number, max: number, finalPhase: boolean): string {
    const hint = finalPhase ? t('sortie.hintEstRuns', { n: 1, kind: t('sortie.kindDefeat') }) : '';
    const bar = finalPhase
        ? variantBarHtml('focus', now, max)
        : sortieGaugeBarHtml({
            now, max, finalPhase,
            title: t('sortie.gaugeTitle', { now, max, hint }),
            finalLabel: 'Final',
        });
    return `<div class="pv-row">
        <div class="pv-label">${label}</div>
        <div class="sortie-container"><div class="s-header">
            <div class="s-map-id">E2<i>甲</i></div>
            ${bar}
            <div class="s-nodes">${nodeHtml()}</div>
            <div class="s-phase active">${esc(t('sortie.boss'))}</div>
        </div></div>
    </div>`;
}

function variantRow(variant: GaugeVariant, label: string, now: number, max: number): string {
    return `<div class="pv-row pv-variant-row">
        <div class="pv-label">${label}</div>
        <div class="sortie-container"><div class="s-header">
            <div class="s-map-id">E2<i>甲</i></div>
            ${variantBarHtml(variant, now, max)}
            <div class="s-nodes">${nodeHtml()}</div>
            <div class="s-phase active">${esc(t('sortie.boss'))}</div>
        </div></div>
    </div>`;
}

const langs: Lang[] = ['zh-TW', 'ja', 'en'];
let body = '';
for (const lang of langs) {
    setLang(lang);
    body += `<h2>${lang}</h2>`;
    body += row('一般', 2760, 4600, false);
    body += row('Final', 840, 4840, true);
    body += row('Final（殘值 1）', 1, 4840, true);
    body += `<h3>Final pill 方案</h3>`;
    body += variantRow('split', 'A｜分段警示', 840, 4840);
    body += variantRow('focus', 'B｜殘值主位', 840, 4840);
    body += variantRow('critical', 'C｜臨界框線', 840, 4840);
    body += variantRow('split', 'A｜殘值 1', 1, 4840);
    body += variantRow('focus', 'B｜殘值 1', 1, 4840);
    body += variantRow('critical', 'C｜殘值 1', 1, 4840);
}

const out = `<!doctype html><html><head><meta charset="utf-8">
<title>關卡量表版面預覽</title><style>${css}
body { padding: 16px; background: var(--bg, #1a1f2e); }
h2 { color: var(--dim); font-size: 12px; margin: 18px 0 6px; }
h3 { color: var(--text); font-size: 11px; font-weight: 600; margin: 14px 0 6px; }
.pv-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
          padding: 4px; outline: 1px dashed rgba(255,255,255,.15); }
.pv-label { width: 110px; color: var(--dim); font-size: 11px; }
.pv-variant-row { margin-bottom: 4px; }
.pv-gauge-shell {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 132px; width: 132px; min-width: 0;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pv-gauge-variant {
  position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 82px; width: 82px; min-width: 0; max-width: 82px;
  height: 15px; box-sizing: border-box; border-radius: 999px; overflow: hidden;
  color: #e0bd70; background: var(--gauge-track); white-space: nowrap;
}
.pv-gauge-fill { position: absolute; inset: 0 auto 0 0; z-index: 0; pointer-events: none; background: var(--dmg-major); opacity: .84; }
.pv-gauge-label { position: relative; z-index: 2; color: #e0bd70; font-size: 8px; font-weight: 700; line-height: 1; letter-spacing: .04em; }
.pv-gauge-external { display: inline-flex; align-items: baseline; gap: 1px; line-height: 1; }
.pv-gauge-external strong { font-size: 10px; font-weight: 750; color: var(--dmg-major); }
.pv-gauge-external small { font-size: 8px; color: #8caab8; }
.pv-gauge-split { border: 1px solid color-mix(in srgb, var(--dmg-major) 72%, var(--line)); }
.pv-gauge-split .pv-gauge-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--dmg-major) 88%, var(--gauge-track)), var(--dmg-major)); }
.pv-gauge-focus { border: 1px solid color-mix(in srgb, var(--dmg-major) 62%, var(--line)); box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--dmg-major) 70%, transparent); }
.pv-gauge-focus .pv-gauge-fill { bottom: 0; height: 3px; top: auto; background: var(--dmg-major); opacity: .92; }
.pv-gauge-critical { border: 1px solid color-mix(in srgb, var(--dmg-major) 78%, var(--line)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dmg-major) 32%, transparent); }
.pv-gauge-critical .pv-gauge-fill { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--dmg-major) 82%, var(--gauge-track)) 0 5px, color-mix(in srgb, var(--dmg-major) 58%, var(--gauge-track)) 5px 10px); }
.pv-gauge-critical .pv-gauge-alert { position: absolute; left: 4px; z-index: 2; display: inline-flex; align-items: center; justify-content: center; width: 11px; height: 11px; border-radius: 50%; color: #f29b8f; border: 1px solid #d8766c; font-size: 8px; font-weight: 800; line-height: 1; }
.pv-gauge-variant.critical { box-shadow: inset 0 0 0 2px var(--dmg-major); }
.s-gauge-num { color: #c7dfec; }
.s-gauge-final { color: #e0bd70; }
/* 面板實際寬度，用來重現換行壓力 */
.sortie-container { width: 420px; }
</style></head><body>
<p style="color:var(--dim);font-size:11px">虛線框＝每列的實際佔用高度。斬殺態與一般態的框高必須相同，
且標題列不得換行。</p>
${body}</body></html>`;

mkdirSync(resolve(root, '.preview'), { recursive: true });
writeFileSync(resolve(root, '.preview/sortie-gauge.html'), out);
console.log('→ .preview/sortie-gauge.html');
