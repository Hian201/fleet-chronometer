// 遠征分區的「開放」子頁：月常解鎖路徑（每期前置、消耗、成功收入），以及一般遠征的開放狀況。
// 依最近一次遠征清單與本期成功紀錄判斷狀態；開放條件表只用來寫「還缺什麼」。
// 一般遠征全開時收成一行放在最後，沒開完才展開並放在路徑前面，只列還有未開放遠征的海域。
import type { GameState } from '@/utils/state';
import EXPEDITION_DATA from '@/utils/expedition-data';
import { MONTHLY_PATHS, unlockView, type ExpeditionResult, type UnlockKind, type UnlockView } from '@/utils/expedition-unlock';
import { areaName } from '@/utils/map-names';
import { formatDateTime } from '@/utils/date-format';
import { expedDisplayName, getLang, t } from '@/utils/ui-i18n';
import { esc, itemName, matIconHtml, USE_ITEM_ICONS } from '../lib';

const MATS = ['fuel', 'ammo', 'steel', 'bauxite'] as const;
const REWARDS = new Map(EXPEDITION_DATA.map(d => [d.id, [d.reward_fuel, d.reward_bullet, d.reward_steel, d.reward_alum]]));
const hourMinute = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

type Mission = GameState['masterMissions'] extends Map<number, infer M> ? M : never;

function missingText(view: UnlockView, state: GameState, id: number): string {
    const miss = view.missing(id);
    const no = (x: number) => state.masterMissions.get(x)?.dispNo ?? `#${x}`;
    return [
        miss.missions.length ? t('ov.euNeeds', { x: miss.missions.map(no).join('＋') }) : '',
        miss.maps.length ? t('ov.euNeedsMap', { x: miss.maps.join('、') }) : '',
        miss.quest ? t('ov.euNeedsQuest') : '',
    ].filter(Boolean).join('；');
}

const costHtml = (m: Mission) => `<span class="eu-cost" title="${esc(t('ov.euCostTip'))}">`
    + `${matIconHtml('fuel', t('mat.fuel.full'))}${Math.round(m.use[0] * 100)}%`
    + `${matIconHtml('ammo', t('mat.ammo.full'))}${Math.round(m.use[1] * 100)}%</span>`;

/** 成功收入：四資源取遠征資料（沒收錄寫不可考），道具取主檔 api_win_item1（成功時隨機）／2（大成功限定）。 */
function rewardHtml(id: number, m: Mission): string {
    const amounts = REWARDS.get(id);
    const mats = amounts
        ? amounts.map((value, i) => value > 0 ? `<span class="eu-chip" title="${esc(t(`mat.${MATS[i]}.full`))}">${matIconHtml(MATS[i], t(`mat.${MATS[i]}.full`))}<b>${value}</b></span>` : '').join('')
        : `<span class="el-unknown">${esc(t('ov.expedUnknown'))}</span>`;
    const item = ([itemId, n]: [number, number], great: boolean) => {
        if (itemId <= 0 || n <= 0) return '';
        const name = itemName(itemId);
        const tip = t(great ? 'ov.euItemGreat' : 'ov.euItemUpTo', { item: name, n });
        const icon = USE_ITEM_ICONS[itemId] ? `<img class="m-icon" src="/icons/${USE_ITEM_ICONS[itemId]}.svg" alt="${esc(name)}">` : esc(name);
        return `<span class="eu-chip" title="${esc(tip)}">${great ? `<i>${esc(t('ov.euGreat'))}</i>` : ''}${icon}<b>×${n}</b></span>`;
    };
    return `<div class="eu-chips">${mats}${item(m.winItems[0], false)}${item(m.winItems[1], true)}</div>`;
}

function pathsHtml(view: UnlockView, state: GameState): string {
    const monthly = [...state.masterMissions].filter(([, m]) => m.resetType === 1).map(([id]) => id);
    const inPaths = new Set(MONTHLY_PATHS.flatMap(path => path.ids));
    const groups = [
        ...MONTHLY_PATHS.map(path => ({ title: path.areas.map(a => areaName(a, getLang()) ?? state.mapAreaName(a)).join('・'), ids: path.ids, path: true })),
        { title: t('ov.euFree'), ids: monthly.filter(id => !inPaths.has(id)), path: false },
    ];
    const body = groups.map(group => {
        const ids = group.ids.filter(id => state.masterMissions.has(id));
        if (!ids.length) return '';
        const done = ids.filter(id => view.kind(id) === 'done').length;
        const total = ids.reduce((sum, id) => sum + state.masterMissions.get(id)!.time, 0);
        let nextShown = false;
        const rows = ids.map(id => {
            const m = state.masterMissions.get(id)!;
            let kind: UnlockKind | 'next' = view.kind(id);
            // 每組第一個可派的就是下一步
            if (kind === 'open' && !nextShown) { kind = 'next'; nextShown = true; }
            const label = t({ done: 'ov.euDone', open: 'ov.euOpen', next: 'ov.euNext', absent: 'ov.euAbsent', locked: 'ov.euLocked' }[kind]);
            const need = kind === 'absent' || kind === 'locked' ? missingText(view, state, id) : '';
            const name = expedDisplayName(id, m.name);
            return `<tr class="eu-tr is-${kind}"><td class="eu-st">${kind === 'done' ? '✓ ' : ''}${esc(label)}</td>
                <td><div class="el-type"><b title="${esc(name)}">${esc(name)}</b><span>${esc(m.dispNo)}${need ? ` · ${esc(need)}` : ''}</span></div></td>
                <td class="el-plan-time">${hourMinute(m.time)}</td><td>${costHtml(m)}</td><td>${rewardHtml(id, m)}</td></tr>`;
        }).join('');
        const meta = [t('ov.euProgress', { a: done, b: ids.length }), group.path ? t('ov.euTotal', { t: hourMinute(total) }) : ''].filter(Boolean).join(' · ');
        return `<tbody><tr class="eu-gh"><th colspan="5">${esc(group.title)}<span class="eu-gmeta">${esc(meta)}</span></th></tr>${rows}</tbody>`;
    }).join('');
    return `<h4 class="el-h" title="${esc(t('ov.euPathsTip'))}">${esc(t('ov.euPaths'))}</h4>
        <div class="el-table-wrap eu-wrap"><table class="el-table eu-table"><thead><tr>
        <th>${esc(t('ov.euColState'))}</th><th>${esc(t('ov.expedColMission'))}</th><th>${esc(t('ov.epColTime'))}</th>
        <th title="${esc(t('ov.euCostTip'))}">${esc(t('ov.euColCost'))}</th><th>${esc(t('ov.euColReward'))}</th></tr></thead>${body}</table></div>`;
}

function generalHtml(view: UnlockView, state: GameState, open: boolean | undefined): { html: string; allOpen: boolean } {
    const general = [...state.masterMissions].filter(([, m]) => m.resetType === 0 && m.maparea < 10);   // 活動支援（S1／S2）掛在活動海域（world >= 10），編號每次活動不同
    const opened = general.filter(([id]) => view.kind(id) === 'done' || view.kind(id) === 'open').length;
    const allOpen = opened === general.length;
    const areas = [...new Set(general.map(([, m]) => m.maparea))];
    const cards = areas.map(area => {
        const rows = general.filter(([, m]) => m.maparea === area);
        const n = rows.filter(([id]) => view.kind(id) !== 'locked').length;
        if (!allOpen && n === rows.length) return '';
        return `<section class="eu-card"><h4 class="eu-area">${esc(areaName(area, getLang()) ?? state.mapAreaName(area))}<span class="eu-count">${n}／${rows.length}</span></h4>
            <ol class="eu-list">${rows.map(([id, m]) => {
            const kind = view.kind(id);
            const need = kind === 'locked' ? missingText(view, state, id) : '';
            const name = expedDisplayName(id, m.name);
            const label = t(kind === 'locked' ? 'ov.euLocked' : 'ov.euOpen');
            return `<li class="eu-row${kind === 'locked' ? ' is-locked' : ''}">
                <span class="eu-mark" role="img" aria-label="${esc(label)}" title="${esc(label)}">${kind === 'done' ? '✓' : kind === 'locked' ? '' : '○'}</span>
                <span class="eu-no">${esc(m.dispNo)}</span><span class="eu-name" title="${esc(name)}">${esc(name)}</span>
                <span class="eu-time">${hourMinute(m.time)}</span>${need ? `<span class="eu-need">${esc(need)}</span>` : ''}</li>`;
        }).join('')}</ol></section>`;
    }).join('');
    const sum = allOpen ? t('ov.euGeneralAll', { n: general.length }) : t('ov.euGeneralPart', { a: opened, b: general.length });
    return {
        allOpen,
        html: `<details class="eu-general"${open ?? !allOpen ? ' open' : ''}><summary class="el-h">${esc(t('ov.euGeneral'))}<span class="eu-gsum">${esc(sum)}</span></summary>
            <div class="eu-grid">${cards}</div></details>`,
    };
}

/**
 * 開放子頁的內容。generalOpen：一般遠征區塊目前的展開狀態（重繪時保留玩家的選擇）；undefined 表示第一次畫，
 * 依「沒開完才展開」決定。
 */
export function unlockPageHtml(state: GameState, now: number, generalOpen?: boolean, results?: readonly ExpeditionResult[]): string {
    const view = unlockView(state.masterMissions, state.missionList, now, results);
    if (!view || !state.masterMissions.size) return `<div class="ov-empty">${esc(t('ov.euNone'))}</div>`;
    const list = state.missionList!;
    const monthly = [...state.masterMissions].filter(([, m]) => m.resetType === 1).map(([id]) => id);
    const general = generalHtml(view, state, generalOpen);
    const stats = [
        `<span class="eu-stat">${esc(t('ov.euMonthly', { a: monthly.filter(id => view.kind(id) === 'done').length, b: monthly.length }))}</span>`,
        list.resetAt !== null && !view.stale ? `<span class="eu-stat dim">${esc(t('ov.euResetAt', { t: formatDateTime(list.resetAt, false) }))}</span>` : '',
        `<span class="eu-stat dim">${esc(t('ov.euSeen', { t: formatDateTime(list.ts, false) }))}</span>`,
    ].join('');
    return `<div class="ov-toolbar eu-bar">${stats}</div>
        ${view.stale ? `<p class="ov-note">${esc(t('ov.euStale'))}</p>` : ''}
        ${general.allOpen ? '' : general.html}${pathsHtml(view, state)}${general.allOpen ? general.html : ''}`;
}
