// 面板「出擊」分頁的演習畫面：對手清單、演習戰況標頭、夜戰目標格。
// 純字串函式，資料由 main.ts 從 GameState 組好傳入；離線預覽 tools/preview/panel-practice.ts 共用。
import type { NightRankNeed } from '@/utils/battle';
import { esc } from '@/utils/html-escape';
import { t } from '@/utils/ui-i18n';

export interface PracticeRow {
    name: string;
    level: number | null;
    /** 階級原字串，只放提示。 */
    rank: string;
    flagshipName: string;
    stype: string;
    comment: string;
    medals: number;
    /** 評價字母；null＝本輪未交戰；'?'＝已開戰但沒有結算。 */
    result: string | null;
    /** 目前正在打這位對手。 */
    current: boolean;
}

/** 對手狀態記號：未交戰＝虛線圈、交戰中＝實心圈、已交戰＝評價字樣。 */
export function practiceMarkHtml(result: string | null, current: boolean, mini = false): string {
    if (current) return `<span class="pr-open now${mini ? ' mini' : ''}" role="img" aria-label="${esc(t('practice.inBattle'))}" title="${esc(t('practice.inBattle'))}"></span>`;
    if (result === null) return `<span class="pr-open${mini ? ' mini' : ''}" role="img" aria-label="${esc(t('practice.notFought'))}" title="${esc(t('practice.notFought'))}"></span>`;
    const known = /^[SABCDE]$/.test(result);
    const label = known ? result : t('practice.resultUnknown');
    return `<span class="s-rank-grade ${known ? `rank-${result.toLowerCase()}` : 'rank-unknown'}${mini ? ' pr-mini' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${known ? result : '?'}</span>`;
}

/**
 * 對手清單。rows 為 null＝本輪清單不可考（換新後還沒進演習畫面，或從沒看過清單），
 * 不猜場數。left 為本輪剩餘場數（idle-check 同一算法）。
 */
export function practiceListHtml(rows: PracticeRow[] | null, left: number | null, resetTime: string, createKind: number | null = null): string {
    const reset = `<span class="pr-reset">${esc(t('practice.reset', { time: resetTime }))}</span>`;
    if (!rows) {
        return `<div class="pr-list"><div class="pr-head"><strong>${esc(t('practice.title'))}</strong><span class="pr-push"></span>${reset}</div>
            <p class="pr-empty">${esc(t('practice.unknown'))}</p></div>`;
    }
    const body = rows.map(row => {
        const tip = [
            row.name,
            row.level !== null ? t('practice.admiral', { lv: row.level, rank: row.rank }) : row.rank,
            row.flagshipName ? `${t('practice.flagship')} ${row.flagshipName}` : '',
            row.comment,
            row.medals > 0 ? t('practice.medals', { n: row.medals }) : '',
        ].filter(Boolean).join('\n');
        const done = row.result !== null && !row.current;
        return `<li class="pr-row${done ? ' done' : ''}${row.current ? ' current' : ''}" title="${esc(tip)}">
            <span class="pr-mark">${practiceMarkHtml(row.result, row.current)}</span>
            <span class="pr-main">
                <span class="pr-l1"><b class="pr-name">${esc(row.name)}</b>${row.level !== null ? `<span class="pr-lv">Lv${row.level}</span>` : ''}</span>
                <span class="pr-l2">${row.stype ? `<span class="pr-stype">${esc(row.stype)}</span>` : ''}<span class="pr-flag">${esc(row.flagshipName)}</span>${row.comment ? `<span class="pr-comment">${esc(row.comment)}</span>` : ''}</span>
            </span>
            ${row.medals > 0 ? `<span class="pr-medal" title="${esc(t('practice.medals', { n: row.medals }))}"><i aria-hidden="true">甲</i>${row.medals}</span>` : '<span></span>'}
        </li>`;
    }).join('');
    const leftText = left === null ? '' : left > 0 ? t('practice.left', { n: left }) : t('practice.allDone');
    // 清單抽自哪一群：只認 0–2（KC3Kai 對照），其他值不猜、不顯示。
    const group = createKind !== null && createKind >= 0 && createKind <= 2
        ? `<span class="pr-group" title="${esc(t(`practice.groupFull${createKind}`))}">${esc(t(`practice.group${createKind}`))}</span>` : '';
    return `<div class="pr-list"><div class="pr-head"><strong>${esc(t('practice.title'))}</strong>${group}
            <span class="pr-left">${esc(leftText)}</span>${reset}</div>
        <ol class="pr-rows">${body}</ol></div>`;
}

/** 演習戰況標頭：取代出擊的海域代號＋量表＋節點軌跡。 */
export function practiceBattleHeadHtml(rows: PracticeRow[] | null, opponent: number | null): string {
    const row = opponent === null ? null : rows?.[opponent] ?? null;
    const vs = row
        ? `<span class="pr-vs"><span class="pr-vs-word">${esc(t('practice.vs'))}</span><b class="pr-name">${esc(row.name)}</b>${row.level !== null ? `<span class="pr-lv">Lv${row.level}</span>` : ''}</span>`
        : '<span class="pr-vs"></span>';
    const slots = rows ? `<span class="pr-slots">${rows.map(r => practiceMarkHtml(r.result, r.current, true)).join('')}</span>` : '';
    return `<div class="s-header pr-battle-head"><div class="s-map-id">${esc(t('practice.label'))}</div>${vs}${slots}</div>`;
}

/**
 * 夜戰目標格（放在出擊的掉落格位置；演習沒有掉落）。
 * needs 為 null＝不適用（夜戰已開始、已結算或沒有夜戰），只留空格維持版面。
 */
export function practiceNightHtml(needs: NightRankNeed[] | null, allSunk: boolean): string {
    const label = `<span class="pr-night-label">${esc(t('practice.night'))}</span>`;
    if (needs === null) return `<div class="pr-night idle" aria-hidden="true">${label}<span class="pr-night-body"><span class="pr-need-none">—</span></span></div>`;
    // 只列下一級與 S：兩列放得進 35px 高的格子。
    const shown = needs.length > 2 ? [needs[0], needs[needs.length - 1]] : needs;
    const body = shown.length
        ? shown.map(need => `<span class="pr-need">${practiceMarkHtml(need.rank, false, true)}<span>${esc(need.sink !== undefined
            ? t('practice.needSink', { n: need.sink }) : t('practice.needHp', { n: need.hp ?? 0 }))}</span></span>`).join('')
        : `<span class="pr-need-none">${esc(allSunk ? t('practice.nightAllSunk') : '—')}</span>`;
    return `<div class="pr-night" title="${esc(t('practice.nightTitle'))}">${label}<span class="pr-night-body">${body}</span></div>`;
}
