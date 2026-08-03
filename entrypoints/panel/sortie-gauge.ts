import { esc } from '@/utils/html-escape';

export interface SortieGaugeBarOptions {
    now: number;
    max: number;
    finalPhase: boolean;
    title: string;
    finalLabel: string;
}

/**
 * 出擊標題列的關卡量表。
 *
 * 斬殺期不能只靠換色表示：量表數值仍是封包實數，另以可見文字標籤與輪廓傳達狀態。
 * 標籤**放在量表條之內**（`斬殺期 840/4840`），不是條子外的第二顆徽章——並排兩顆會把
 * 標題列撐到換行，換行就多一整列、把下面釘死的出擊資訊往下推到需要捲動。
 * 兩種狀態的 DOM 高度必須一致（見 index.html `.s-gauge-final` 註解）。
 * 保持為純字串函式，讓 DOM 外的測試能鎖住標籤不會再次被版面改動吃掉。
 */
export function sortieGaugeBarHtml(options: SortieGaugeBarOptions): string {
    const { now, max, finalPhase, title, finalLabel } = options;
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(100 * now / max))) : 0;
    const tag = finalPhase ? `<b class="s-gauge-final">${esc(finalLabel)}</b>` : '';

    return `<div class="s-gauge bar${finalPhase ? ' zansatsu' : ''}" title="${esc(title)}">
        <span class="s-gauge-bar" role="meter" aria-label="${esc(title)}"
            aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}">
            <i style="width:${pct}%"></i>${tag}<b class="s-gauge-num">${now}/${max}</b>
        </span>
    </div>`;
}
