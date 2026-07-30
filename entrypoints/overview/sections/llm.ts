// LLM 分析（#7）。三條互不相依的路徑，皆不需要新增 manifest 權限、不打破「資料不落地
// 出境」的預設立場——出不出境完全由使用者自己決定要不要把檔案／文字交給誰：
//
//   B. 鎮守府概覽（主線）：把鎮守府現況整理成一份 Markdown，複製或下載，
//      可直接貼進／上傳到任何主流 LLM（Claude.ai／ChatGPT／Gemini…）。純前端組字串
//      ＋現有的 downloadText／clipboard，零網路、零權限。
//      設計原則：能預先算好的統計（分組、計數、勝率）就不要留給 LLM 自己從一份攤平的
//      原始紀錄清單去數——那既浪費 token 又容易數錯（尤其本機小模型）。出擊紀錄依
//      海域分組（而非全域統計＋全體最近 N 筆的攤平清單）、裝備依種類彙總持有量與
//      改修分布（而非逐顆列舉），都是同一個原則：報告只放「分析所需的最小必要形狀」，
//      不是資料庫的文字版轉存（那是「資料備份與還原」的 JSON 該做的事，兩者用途不同，
//      見該分區與 CLAUDE.md「母港快照與資料備份還原」）。**內容刻意收斂**：不含艦隊
//      當下編成／開發／建造／改修這類「操作紀錄」，只留「盤點」性質的四塊——全艦娘、
//      全裝備、全資源、與有時間範圍限制的出擊紀錄（近半年，避免隨歷史筆數線性膨脹）。
//   MCP：不是程式碼功能，只是一段使用提示——把下載資料夾指給支援 MCP 的用戶端
//      （如 Claude Desktop）當 filesystem server，讓它直接讀最新報告，不必每次手動上傳。
//      這件事完全發生在擴充之外（另一支獨立行程讀擴充存到硬碟的檔案），不影響本專案
//      任何權限設定。
//   A. Chrome 內建 AI（Prompt API／Gemini Nano）：整段分析在本機裝置端跑，資料同樣
//      不出境；用 typeof 特徵偵測是否可用（見 prompt-api.d.ts），裝置/瀏覽器版本不支援
//      時直接隱藏、不報錯。**已知限制**：官方語言清單目前只列 en/ja/es/de/fr，不含繁體
//      中文，輸出品質對 zh-TW 介面文字無法保證；且裝置端模型 context window 較小，
//      這裡只餵精簡摘要（非下方的完整報告），避免超出額度。
//
// 整個分區為實驗性功能（見 UI 上的 ov.experimental 標示）：報告內容與 AI 分析結果皆
// 未經嚴謹校對，僅供輔助參考。
import type { OverviewSection } from './types';
import type { GameState } from '@/utils/state';
import { db } from '@/utils/db';
import { nodeLabel } from '@/utils/map-node-letters';
import { groupGears } from '@/utils/gear-inventory';
import { findUnknownGears, findUnknownShips, type CoverageGap } from '@/utils/gamedata-coverage';
import { rowsToCsv } from '@/utils/csv';
import { t } from '@/utils/ui-i18n';
import { esc, fmtTs, downloadText, copyWithFeedback } from '../lib';

// ── B. 鎮守府概覽（完整報告，Markdown）──────────────────────
const RESULT_LABELS = ['ov.expedFail', 'ov.expedSuccess', 'ov.expedGreat'];
const MAT_KEYS = ['fuel', 'ammo', 'steel', 'bauxite', 'torch', 'drum', 'devmat', 'screw'];
// 出擊紀錄的時間窗（月）：紀錄會隨時間線性膨脹，全量塞進報告只會擠掉真正常查的
// 近期資訊；半年份足夠回答「近期在打什麼、打得怎樣」這類問題。
const SORTIE_SCOPE_MONTHS = 6;

async function buildFullReport(state: GameState): Promise<string> {
    const lines: string[] = [
        `# ${t('ov.reportTitle')}`,
        `${state.nickname || '???'}　Lv${state.hqLv}　(${fmtTs(Date.now())})`,
        '',
    ];

    // 資源盤點：封包只給餘額（現在有多少），八項資材逐一列出。消長是差分而非本報告
    // 的職責（見 utils/resource-log.ts），這裡只呈現單次快照的事實。
    lines.push(`## ${t('ov.matInventory')}`);
    lines.push(MAT_KEYS.map((k, i) => `${t(`mat.${k}.full`)} ${state.materials[i] ?? '?'}`).join('　'));
    lines.push('');

    // 全艦娘名單：依艦種分類（依 stypeId 由小到大＝遊戲內慣用順序），種類內依等級高到低。
    // 含等級／血量／疲勞／素質／目前裝備——判斷編成、近代化改修、汰換方向所需的最小
    // 必要形狀；不含「現在帶了誰出門」（那是艦隊編成本身的事，不是名冊）。
    lines.push(`## ${t('ov.shipRoster')}`);
    const ships = state.ownedShips();
    if (ships.length) {
        const byType = new Map<number, { stype: string; ships: typeof ships }>();
        for (const s of ships) {
            let g = byType.get(s.stypeId);
            if (!g) { g = { stype: s.stype, ships: [] }; byType.set(s.stypeId, g); }
            g.ships.push(s);
        }
        for (const [, group] of [...byType.entries()].sort((a, b) => a[0] - b[0])) {
            group.ships.sort((a, b) => b.lv - a.lv);
            lines.push(`### ${group.stype}（${group.ships.length}）`);
            for (const s of group.ships) {
                const gears = s.gears.filter(Boolean).map(g => `${g!.name}${g!.level > 0 ? `★${g!.level}` : ''}`).join(' / ');
                lines.push(`- **${s.name}** Lv${s.lv}　HP ${s.hp}/${s.maxhp}　cond ${s.cond}　` +
                    `${t('ov.rsColFire')}${s.stats.firepower} ${t('ov.rsColTorp')}${s.stats.torpedo} ` +
                    `${t('ov.rsColAa')}${s.stats.aa} ${t('ov.rsColArmor')}${s.stats.armor} ` +
                    `${t('ov.rsColAsw')}${s.stats.asw} ${t('ov.rsColEvasion')}${s.stats.evasion} ` +
                    `${t('ov.rsColLos')}${s.stats.los} ${t('ov.rsColLuck')}${s.stats.luck}` +
                    `${gears ? `　│ ${gears}` : ''}`);
            }
            lines.push('');
        }
    } else lines.push(t('ov.fleetOverviewNone'));
    lines.push('');

    // 全裝備：依裝備種類（api_mst_slotitem_equiptype 的 catName）分類，種類內再依
    // 裝備（mst）彙總持有量＋改修分布，排除消耗品（無改修概念）。刻意不逐顆列舉
    // 裝備實例（同款常見數十顆，逐顆列會很冗長）——分組後的「持有量＋改修分布」
    // 才是判斷「該把哪一顆改修到底」所需的最小必要資訊。
    lines.push(`## ${t('ov.gearSummary')}`);
    const gearGroups = groupGears(state.ownedGears());
    if (gearGroups.length) {
        const byCat = new Map<string, typeof gearGroups>();
        for (const gr of gearGroups) {
            const key = gr.catName || '?';
            const list = byCat.get(key);
            if (list) list.push(gr); else byCat.set(key, [gr]);
        }
        for (const [cat, list] of byCat) {
            const total = list.reduce((sum, gr) => sum + gr.count, 0);
            lines.push(`### ${cat}（${t('ov.gearCount', { n: total })}）`);
            for (const gr of list.sort((a, b) => b.count - a.count)) {
                const levelStr = gr.levels.map(l => `★${l.level}×${l.count}`).join(' ');
                lines.push(`- ${gr.name}：${t('ov.gearCount', { n: gr.count })}（${levelStr}）`);
            }
            lines.push('');
        }
    } else lines.push(t('ov.gearSummaryNone'));
    lines.push('');

    // 出擊：依海域分組統計（rank 分布／大破次數／常見掉落／最近出擊時間），而非把
    // 個別戰鬥攤平列成一份「全海域混在一起」的清單——原本的設計讓 LLM 沒辦法回答
    // 「我在某海域的歷史勝率」（全域統計混雜所有海域，細節列表又只有全體最近 20 筆，
    // 常常根本看不到目標海域的紀錄）。分組後每個海域一行，資訊密度更高、且是回答
    // 「目標海域勝率」這類問題真正需要的形狀。**限制在最接近當下的半年份**（見檔頭
    // SORTIE_SCOPE_MONTHS）：分組運算本身很輕量，但輸出行數只該跟「去過幾個海域」
    // 成正比，全歷史下去反而會把最該關注的近期趨勢淹沒。
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - SORTIE_SCOPE_MONTHS);
    const sorties = (await db.sorties.orderBy('eventId').reverse().toArray())
        .filter(s => s.ts >= cutoff.getTime());
    lines.push(`## ${t('ov.sortieLog')}（${t('ov.sortieScopeNote', { n: SORTIE_SCOPE_MONTHS })}）`);
    if (sorties.length) {
        type MapStat = { count: number; rank: Record<string, number>; taiha: number; lastTs: number; drops: Record<string, number> };
        const byMap = new Map<string, MapStat>();
        let raidCount = 0;
        for (const s of sorties) {
            if (s.kind === 'raid') { raidCount++; continue; }
            let m = byMap.get(s.map);
            if (!m) { m = { count: 0, rank: {}, taiha: 0, lastTs: 0, drops: {} }; byMap.set(s.map, m); }
            m.count++;
            if (s.rank) m.rank[s.rank] = (m.rank[s.rank] ?? 0) + 1;
            if (s.taiha) m.taiha++;
            if (s.drop) m.drops[s.drop] = (m.drops[s.drop] ?? 0) + 1;
            m.lastTs = Math.max(m.lastTs, s.ts);
        }
        const maps = [...byMap.entries()].sort((a, b) => b[1].lastTs - a[1].lastTs);   // 最近去過的海域排前面
        lines.push(t('ov.sortieByMap'), '');
        for (const [map, m] of maps) {
            const rankStr = Object.entries(m.rank).map(([r, n]) => `${r}×${n}`).join(' ');
            const topDrops = Object.entries(m.drops).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join('、');
            lines.push(`- **${map}**　${t('ov.sortieCount', { n: m.count })}　${rankStr}` +
                `${m.taiha ? `　⚠大破×${m.taiha}` : ''}${topDrops ? `　掉落:${topDrops}` : ''}　(${t('ov.lastSortied', { date: fmtTs(m.lastTs) })})`);
        }
        if (raidCount) lines.push('', t('ov.baseRaidCount', { n: raidCount }));
        // 短版「最近出擊」保留一點時序脈絡（剛做了什麼），不做為統計依據
        lines.push('', t('ov.sortieRecent'));
        for (const s of sorties.slice(0, 5)) {
            if (s.kind === 'raid') { lines.push(`- ${t('history.baseNode')}　損失種別 ${s.raidLostKind ?? '?'}`); continue; }
            const flag = s.enemyIds[0] ? state.shipName(s.enemyIds[0]) : '?';
            // 節點用攻略圈的字母（查表，見 utils/map-node-letters.ts）——給人／LLM 讀的報告
            // 寫「node 48」對不上任何攻略資料，寫「E」才有意義；查不到才退回原始 edge 編號。
            lines.push(`- ${s.map} ${nodeLabel(s.map, s.node)}${s.boss ? '(boss)' : ''}　${s.rank || '?'}　vs ${flag}${s.drop ? `　掉落:${s.drop}` : ''}${s.taiha ? '　⚠大破' : ''}`);
        }
    } else lines.push(t('history.none'));
    lines.push('');

    // 遠征：統計＋近期清單
    const expeds = await db.expeditions.orderBy('eventId').reverse().limit(100).toArray();
    lines.push(`## ${t('ov.expedLog')}`);
    if (expeds.length) {
        const resultCount = [0, 0, 0];
        for (const e of expeds) resultCount[e.result] = (resultCount[e.result] ?? 0) + 1;
        lines.push(`統計（近 ${expeds.length} 筆）：` +
            resultCount.map((n, i) => `${t(RESULT_LABELS[i])}×${n}`).join(' '), '', '最近紀錄：');
        for (const e of expeds.slice(0, 20)) {
            lines.push(`- ${t('ov.expedDeck', { n: e.deckId })}　${e.name || '#' + e.missionId}　${t(RESULT_LABELS[e.result] ?? 'ov.expedSuccess')}`);
        }
    } else lines.push(t('ov.expedNone'));
    lines.push('', '---', t('ov.reportFooter'));

    return lines.join('\n');
}

// ── 翻譯對照缺漏匯出：samples/i18n/*.csv 只是某次下載 wiki 當下的快照，遊戲更新後
// 新增的艦娘/深海棲艦/裝備不會自動反映——用目前封包實際載入的 master id 跟快照做差集，
// 匯出「wiki 對照表沒有」的清單，供之後重新整理 wiki 對照表時知道該補哪些。
//
// 差集在 render() 時算一次就好（overview 的 ctx.state 是一次性重播出來的快照，分區生命
// 週期內不會變，不像面板會收 live 事件），狀態文字與 CSV 共用同一份結果。
type CoverageGaps = { ships: CoverageGap[]; gears: CoverageGap[] };

function coverageCsv(gaps: CoverageGaps): string {
    const rows: string[][] = [['category', 'master_id', 'name_ja']];
    for (const g of gaps.ships) rows.push(['ship', String(g.id), g.name]);
    for (const g of gaps.gears) rows.push(['gear', String(g.id), g.name]);
    return rowsToCsv(rows);
}

// ── A. Chrome 內建 AI 用的精簡摘要（非完整報告，裝置端 context window 較小）────
async function buildQuickContext(state: GameState): Promise<string> {
    const c = state.counts();
    const lines: string[] = [
        `提督：${state.nickname || '???'}　司令部Lv ${state.hqLv}`,
        `艦娘 ${c.ships}/${c.maxShips}　裝備 ${c.gears}/${c.maxGears}`,
        `資源：燃${state.materials[0] ?? '?'} 弾${state.materials[1] ?? '?'} 鋼${state.materials[2] ?? '?'} 鋁${state.materials[3] ?? '?'}`,
        '', '【艦隊】',
    ];
    state.fleets().forEach((f, i) => {
        if (!f.ships.length) return;
        lines.push(`第${i + 1}艦隊 ${f.name}${f.mission ? '（遠征中）' : ''}：` + f.ships.map(s => `${s.name}(Lv${s.lv})`).join('、'));
    });
    const sorties = await db.sorties.orderBy('eventId').reverse().limit(100).toArray();
    const rankCount: Record<string, number> = {};
    for (const s of sorties) if (s.kind === 'battle' && s.rank) rankCount[s.rank] = (rankCount[s.rank] ?? 0) + 1;
    const rankStr = Object.entries(rankCount).map(([r, n]) => `${r}×${n}`).join(' ');
    if (rankStr) lines.push('', '【近期出擊 rank】', rankStr);
    return lines.join('\n');
}

// ── A. Chrome 內建 AI 分析 UI ──────────────────────────────
function renderAiNano(el: HTMLElement, state: GameState) {
    // 特徵偵測：不支援的瀏覽器/裝置直接顯示提示，不嘗試呼叫（typeof 對不存在的
    // 識別字是安全的，不會拋錯——這是標準的漸進增強寫法）。
    if (typeof LanguageModel === 'undefined') {
        el.innerHTML = `<p class="ov-note dim">${esc(t('ov.aiNanoUnavailable'))}</p>`;
        return;
    }
    el.innerHTML = `
        <p class="ov-note dim">${esc(t('ov.aiNanoCaveat'))}</p>
        <textarea id="ai-nano-q" class="ov-textarea small" placeholder="${esc(t('ov.aiNanoPromptPlaceholder'))}"></textarea>
        <div class="ov-toolbar">
            <button class="ov-btn" id="ai-nano-run">${esc(t('ov.aiNanoRun'))}</button>
            <span id="ai-nano-status" class="dim"></span>
        </div>
        <div id="ai-nano-result" class="ov-result"></div>`;

    const q = el.querySelector<HTMLTextAreaElement>('#ai-nano-q')!;
    const runBtn = el.querySelector<HTMLButtonElement>('#ai-nano-run')!;
    const status = el.querySelector<HTMLElement>('#ai-nano-status')!;
    const result = el.querySelector<HTMLElement>('#ai-nano-result')!;

    runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        result.textContent = '';
        let session: LanguageModelSession | undefined;
        try {
            const availability = await LanguageModel.availability();
            if (availability === 'unavailable') {
                status.textContent = t('ov.aiNanoUnavailable');
                return;
            }
            if (availability !== 'available') {
                // 'downloadable'／'downloading'：首次使用需要下載模型，顯示進度
                status.textContent = t('ov.aiNanoDownloading', { n: 0 });
                session = await LanguageModel.create({
                    monitor(m) {
                        m.addEventListener('downloadprogress', ((e: Event & { loaded?: number }) => {
                            status.textContent = t('ov.aiNanoDownloading', { n: Math.round((e.loaded ?? 0) * 100) });
                        }) as EventListener);
                    },
                });
            } else {
                session = await LanguageModel.create();
            }
            status.textContent = t('ov.aiNanoRunning');
            const question = q.value.trim() || t('ov.aiNanoDefaultQuestion');
            const context = await buildQuickContext(state);
            const stream = session.promptStreaming(`${context}\n\n${question}`);
            // promptStreaming 的分塊語意曾經改版（部分版本回傳「目前為止的全文」，
            // 穩定版回傳「只有新增的 token」），且行為隨 Chrome 版本而異、無法從
            // typeof 特徵偵測分辨。用「新塊是否以目前已顯示文字開頭」判斷，兩種
            // 語意都能正確顯示，不用賭使用者裝置跑的是哪一版。
            let acc = '';
            for await (const chunk of stream) {
                acc = chunk.startsWith(acc) ? chunk : acc + chunk;
                result.textContent = acc;
            }
            status.textContent = '';
        } catch (err) {
            status.textContent = t('ov.aiNanoError', { msg: String(err) });
        } finally {
            // create 成功後無論串流成敗都銷毀，避免裝置端 session 洩漏。
            try { session?.destroy(); } catch { /* destroy 失敗不影響 UI */ }
            runBtn.disabled = false;
        }
    });
}

export const llmSection: OverviewSection = {
    id: 'llm',
    titleKey: 'ov.llm',
    render(el, ctx) {
        el.innerHTML = `
            <p class="ov-note"><span class="badge">${esc(t('ov.experimental'))}</span> ${esc(t('ov.llmExperimentalNote'))}</p>
            <h3 class="ov-subhead">${esc(t('ov.reportSectionTitle'))}</h3>
            <p class="ov-note">${esc(t('ov.reportIntro'))}</p>
            <div class="ov-toolbar">
                <button class="ov-btn" id="llm-report-dl">${esc(t('ov.downloadReport'))}</button>
                <button class="ov-btn" id="llm-report-copy">${esc(t('ov.copyReport'))}</button>
            </div>
            <p class="ov-note dim">${esc(t('ov.mcpTip'))}</p>

            <h3 class="ov-subhead">${esc(t('ov.coverageSectionTitle'))}</h3>
            <p class="ov-note">${esc(t('ov.coverageIntro'))}</p>
            <div class="ov-toolbar">
                <button class="ov-btn" id="llm-coverage-dl">${esc(t('ov.downloadCoverage'))}</button>
                <button class="ov-btn" id="llm-coverage-copy">${esc(t('ov.copyCoverage'))}</button>
                <span id="llm-coverage-status" class="dim"></span>
            </div>

            <h3 class="ov-subhead">${esc(t('ov.aiNanoTitle'))}</h3>
            <div id="ai-nano-root"></div>`;

        el.querySelector('#llm-report-dl')!.addEventListener('click', async () =>
            downloadText(`kanmusu-report-${Date.now()}.md`, await buildFullReport(ctx.state), 'text/markdown'));
        el.querySelector('#llm-report-copy')!.addEventListener('click', async e => {
            const text = await buildFullReport(ctx.state);
            copyWithFeedback(e.currentTarget as HTMLButtonElement, text, t('ov.copied'));
        });

        const coverageStatus = el.querySelector<HTMLElement>('#llm-coverage-status')!;
        // master 還沒載入（沒看過 api_start2/getData）時「沒有缺漏」與「無從比對」是兩件
        // 事，故分開講；差集只算這一次，按鈕事後不重算（狀態不會變）。
        const gaps: CoverageGaps = {
            ships: findUnknownShips(ctx.state.master),
            gears: findUnknownGears(ctx.state.masterGears),
        };
        const gapCount = gaps.ships.length + gaps.gears.length;
        coverageStatus.textContent = ctx.state.master.size === 0 ? t('ov.coverageNoMaster')
            : gapCount > 0 ? t('ov.coverageFound', { n: gapCount }) : t('ov.coverageNone');
        el.querySelector('#llm-coverage-dl')!.addEventListener('click', () => {
            downloadText(`kanmusu-i18n-gaps-${Date.now()}.csv`, coverageCsv(gaps), 'text/csv');
        });
        el.querySelector('#llm-coverage-copy')!.addEventListener('click', e => {
            copyWithFeedback(e.currentTarget as HTMLButtonElement, coverageCsv(gaps), t('ov.copied'));
        });

        renderAiNano(el.querySelector('#ai-nano-root')!, ctx.state);
    },
};
