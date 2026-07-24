// 鎮守府情報總括各分區共用的小工具。overview 是獨立分頁、不消費 live 事件，
// 需要「當前狀態」時就地重建一個 GameState（重播 db.snapshot 墊底＋db.events，同面板
// 啟動流程）——讀取用途，不寫任何 DB（擷取/歸檔是面板的職責，見 panel/main.ts）。
import { db } from '@/utils/db';
import { GameState } from '@/utils/state';
import { applyStateRecoveryPlan, planStateRecovery } from '@/utils/state-recovery';
import { t } from '@/utils/ui-i18n';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 重建當前 GameState：共用規劃器會依 retained raw events 的第一筆 ID 選出安全 baseline。
// overview 僅套用 reducer，不經 EventProjector，因此不寫任何 derived tables。
export async function loadGameState(): Promise<GameState> {
    const gs = new GameState();
    const [snapshots, events] = await Promise.all([
        db.snapshot.toArray(),
        db.events.orderBy('id').toArray(),
    ]);
    applyStateRecoveryPlan(gs, planStateRecovery(snapshots, events));
    return gs;
}

// 裝備圖示（extension 根 root-relative；同面板作法）。icon<=0 用文字退路避免破圖。
export const gearIconHtml = (icon: number, short = '') =>
    icon > 0 ? `<img class="g-icon" src="/icons/equipment/${icon}.svg" alt="${esc(short)}" loading="lazy">` : esc(short);
export const matIconHtml = (file: string, alt = '') =>
    `<img class="m-icon" src="/icons/resource/${file}.svg" alt="${esc(alt)}">`;

// 檔案下載（Blob + 臨時 <a download>）；純前端、不需任何權限。
export function downloadText(filename: string, text: string, mime = 'text/plain') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 剪貼簿複製＋按鈕暫態回饋（複製成功把按鈕文字換成 doneLabel 1.5 秒）。
export async function copyWithFeedback(btn: HTMLButtonElement, text: string, doneLabel: string) {
    const orig = btn.textContent ?? '';
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = doneLabel;
        setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch { /* 剪貼簿不可用時靜默 */ }
}

export const fmtTs = (ts: number) => new Date(ts).toLocaleString();
export const fmtShortTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 四艦隊＋基地航空隊的 Markdown 片段。原本只在 fleet-overview.ts 內用，抽到這裡是因為
// llm.ts 的「完整報告」匯出（#7 通用備份檔）也需要同一段內容——兩處輸出格式完全一致，
// 只差外層要嵌在哪一級標題底下，故用 h 參數控制標題層級（fleet-overview 獨立成文件時
// 用 '##'；嵌進完整報告的某個章節底下時用 '###'）。
const AIR_ACTION_KEYS = ['lbas.standby', 'lbas.sortie', 'lbas.airDefense', 'lbas.retreat', 'lbas.rest'];
// lbas：依基地 rid（1-3，穩定的「第幾個基地」）決定去留，不用陣列索引——sort 過的
// airBases_() 順序會先依 areaId 分組，rid 不一定對得上索引位置（見 fleet-overview.ts
// baseHtml() 的同一個註解）。
export interface FleetMarkdownScope { fleets: boolean[]; lbas: boolean[] }

export function fleetMarkdown(state: GameState, h = '##', scope?: FleetMarkdownScope): string {
    const lines: string[] = [];
    state.fleets().forEach((f, i) => {
        if (!f.ships.length) return;
        if (scope && scope.fleets[i] === false) return;
        lines.push(`${h} ${t('ov.fleetN', { n: i + 1 })} — ${f.name}${f.mission ? `（${t('ov.onMission')}）` : ''}`);
        for (const s of f.ships) {
            const gears = s.gears.filter(Boolean).map(g => `${g!.name}${g!.level > 0 ? `★${g!.level}` : ''}`).join(' / ');
            lines.push(`- **${s.stype} ${s.name}** Lv${s.lv}　HP ${s.hp}/${s.maxhp}　cond ${s.cond}${gears ? `　│ ${gears}` : ''}`);
        }
        lines.push('');
    });
    const bases = state.airBases_().filter(b => !scope || scope.lbas[b.rid - 1] !== false);
    if (bases.length) {
        lines.push(`${h} ${t('ov.airCorps')}`);
        for (const b of bases) {
            const sq = b.squadrons.map(s => `${s.name}${s.level > 0 ? `★${s.level}` : ''}`).join(' / ');
            lines.push(`- **${b.name}**（${state.mapAreaName(b.areaId)}） ${t(AIR_ACTION_KEYS[b.actionKind] ?? 'lbas.standby')}　${t('ov.airRadius', { n: b.distance })}　${t('ov.airPower', { min: b.airPower.min, max: b.airPower.max })}${sq ? `　│ ${sq}` : ''}`);
        }
    }
    return lines.join('\n');
}
