import { esc } from '@/utils/html-escape';

export interface SortieGaugeBarOptions {
    now: number;
    max: number;
    finalPhase: boolean;
    title: string;
    /** 呼叫端可傳入；Final 固定使用量表內文案，因此不取用此值。 */
    finalLabel?: string;
}

/**
 * 出擊標題列的關卡量表。
 *
 * 斬殺期不能只靠換色表示：量表內只留 Final，封包實數放在條子外側。
 * 這讓 Final 不會和數字搶同一條窄軌道，也讓一般與斬殺期的數值位置完全一致；
 * 兩種狀態的 DOM 高度必須一致（見 index.html `.s-gauge-final` 註解）。
 * 保持為純字串函式，讓 DOM 外的測試能鎖住標籤不會再次被版面改動吃掉。
 */
export function sortieGaugeBarHtml(options: SortieGaugeBarOptions): string {
    const { now, max, finalPhase, title } = options;
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(100 * now / max))) : 0;
    const tag = finalPhase ? `<b class="s-gauge-final">Final</b>` : '';

    return `<div class="s-gauge bar${finalPhase ? ' zansatsu' : ''}" title="${esc(title)}">
        <span class="s-gauge-bar" role="meter" aria-label="${esc(title)}"
            aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}">
            <i style="width:${pct}%"></i>${tag}
        </span><span class="s-gauge-num"><strong>${now}</strong><small>/${max}</small></span>
    </div>`;
}
