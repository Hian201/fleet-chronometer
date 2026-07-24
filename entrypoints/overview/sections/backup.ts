// 資料備份與還原：真正「可還原」的結構化 JSON 匯出/匯入，跟 llm.ts 的完整報告
// （Markdown，設計給人/LLM 讀、近期紀錄節錄、不可逆解析）是完全不同性質的東西。
//
// 檔案分層（Phase 1 定案）：刻意拆成兩個檔案——
//   · kanmusu-restore.json（輕量還原檔）：db.snapshot（母港快照，見 utils/db.ts
//     SnapshotRow——全新安裝匯入後靠它立即重建艦娘/裝備/艦隊/基地航空隊，不必等重新登入）
//     ＋ sorties/expeditions/factory（永久保留的消化後摘要，每筆 <1KB）＋ wanted。
//     永遠很小、每次覆寫同檔名滾動，是「還原目前狀態」所需的最小必要子集。
//   · kanmusu-replays.json（重播層）：db.replays（每次出擊原始戰鬥封包＋艦隊快照，
//     每筆數 KB～數十 KB，會隨出擊數線性膨脹——這正是 KC3Kai 備份長到 300MB＋的同源
//     資料）。獨立成檔，之後（Phase 2）依保留規則裁剪；還原狀態「不需要」它。
// 刻意不含：db.events（原始封包日誌，本就設計成會被裁剪，db.snapshot 已是重建現狀的
//   最小子集）與 localStorage 偏好（語言/主題）。
//
// 資料夾備份（FSA）：把上述兩檔＋離線提取器 viewer.html 一次寫進使用者選定的資料夾
// （可指向 Google Drive Desktop／WebDAV 掛載磁碟等同步夾），上雲同步交給桌面同步客戶端，
// 擴充零新權限（見 fsa.ts 開頭決策脈絡）。無 FSA 支援的瀏覽器退回純下載。
import type { OverviewSection } from './types';
import { db } from '@/utils/db';
import {
    BackupDestinationError, BackupValidationError, buildReplaysEnvelope, buildRestoreEnvelope,
    countBackupRecords, parseBackupJson, restoreBackup,
} from '@/utils/backup';
import { t } from '@/utils/ui-i18n';
import { esc, downloadText, fmtTs } from '../lib';
import { fsaSupported, pickBackupDir, savedBackupDir, forgetBackupDir, ensureRw, dirName, writeFileTo } from '../fsa';
import { viewerHtml } from '../viewer-html';
import { planRetention, DEFAULT_RETENTION, type RetentionConfig } from '@/utils/retention';
import type { GameState } from '@/utils/state';

const RETENTION_CFG_KEY = 'kc-retention-cfg';

function loadRetentionCfg(): RetentionConfig {
    try {
        const raw = localStorage.getItem(RETENTION_CFG_KEY);
        if (raw) return { ...DEFAULT_RETENTION, ...JSON.parse(raw) };
    } catch { /* 壞值退回預設 */ }
    return { ...DEFAULT_RETENTION };
}
function saveRetentionCfg(cfg: RetentionConfig) {
    localStorage.setItem(RETENTION_CFG_KEY, JSON.stringify(cfg));
}

// 目前尚未通關的海域（來自當前 GameState 量表）——保留規則「攻略中全保護」用。
// 只納入「仍有作用中量表且未擊破」的圖；gaugeType 0 或已擊破者不算未通關。
function unclearedMapsOf(state: GameState): Set<string> {
    const s = new Set<string>();
    for (const [id, g] of state.mapGauges) {
        const broken = g.cleared
            || (g.gaugeType === 2 && g.maxHp > 0 && g.nowHp === 0)
            || (g.gaugeType === 1 && g.requiredDefeatCount > 0 && g.defeatCount >= g.requiredDefeatCount);
        if (!broken && g.gaugeType > 0) s.add(`${Math.floor(id / 10)}-${id % 10}`);
    }
    return s;
}

const RESTORE_FILE = 'kanmusu-restore.json';
const REPLAYS_FILE = 'kanmusu-replays.json';
const VIEWER_FILE = 'viewer.html';

export const backupSection: OverviewSection = {
    id: 'backup',
    titleKey: 'ov.backup',
    render(el, ctx) {
        const folderBlock = fsaSupported() ? `
            <h3 class="ov-subhead">${esc(t('ov.backupFolderTitle'))}</h3>
            <p class="ov-note">${esc(t('ov.backupFolderIntro'))}</p>
            <div class="ov-toolbar">
                <button class="ov-btn" id="backup-pick">${esc(t('ov.backupPickFolder'))}</button>
                <button class="ov-btn" id="backup-folder-run">${esc(t('ov.backupToFolder'))}</button>
                <button class="ov-btn" id="backup-forget">${esc(t('ov.backupForgetFolder'))}</button>
            </div>
            <p id="backup-folder-status" class="ov-note dim"></p>`
            : `<p class="ov-note dim">${esc(t('ov.backupNoFsa'))}</p>`;

        el.innerHTML = `
            <p class="ov-note">${esc(t('ov.backupIntro'))}</p>
            ${folderBlock}
            <h3 class="ov-subhead">${esc(t('ov.backupFileTitle'))}</h3>
            <p class="ov-note dim">${esc(t('ov.backupFileIntro'))}</p>
            <div class="ov-toolbar">
                <button class="ov-btn" id="backup-export-restore">${esc(t('ov.backupExportRestore'))}</button>
                <button class="ov-btn" id="backup-export-replays">${esc(t('ov.backupExportReplays'))}</button>
                <button class="ov-btn" id="backup-import">${esc(t('ov.backupImport'))}</button>
                <input type="file" id="backup-file" accept="application/json,.json" style="display:none">
            </div>
            <p id="backup-status" class="ov-note dim"></p>

            <h3 class="ov-subhead">${esc(t('ov.retentionTitle'))}</h3>
            <p class="ov-note dim">${esc(t('ov.retentionIntro'))}</p>
            <div class="ov-retention" id="backup-retention">
                <label><input type="checkbox" data-rc="protectNewShip"> ${esc(t('ov.retNewShip'))}</label>
                <label><input type="checkbox" data-rc="protectCleared"> ${esc(t('ov.retCleared'))}</label>
                <label><input type="checkbox" data-rc="protectEventBoss"> ${esc(t('ov.retEventBoss'))}</label>
                <label><input type="checkbox" data-rc="protectUncleared"> ${esc(t('ov.retUncleared'))}</label>
                <label class="num">${esc(t('ov.retDays'))} <input type="number" min="0" data-rc="keepRecentDays"></label>
                <label class="num">${esc(t('ov.retCount'))} <input type="number" min="0" data-rc="keepRecentCount"></label>
            </div>
            <p id="backup-retention-stat" class="ov-note"></p>
            <div class="ov-toolbar">
                <button class="ov-btn danger" id="backup-prune">${esc(t('ov.retPrune'))}</button>
            </div>
            <p id="backup-retention-status" class="ov-note dim"></p>`;

        const status = el.querySelector<HTMLElement>('#backup-status')!;
        const fileInput = el.querySelector<HTMLInputElement>('#backup-file')!;

        // ── 檔案匯出（fallback／個別下載）──
        el.querySelector('#backup-export-restore')!.addEventListener('click', async () => {
            const env = await buildRestoreEnvelope(db);
            downloadText(RESTORE_FILE, JSON.stringify(env), 'application/json');
            status.textContent = t('ov.backupExported', { n: countBackupRecords(env.tables) });
        });
        el.querySelector('#backup-export-replays')!.addEventListener('click', async () => {
            const env = await buildReplaysEnvelope(db);
            downloadText(REPLAYS_FILE, JSON.stringify(env), 'application/json');
            status.textContent = t('ov.backupExported', { n: countBackupRecords(env.tables) });
        });

        // ── 資料夾備份（FSA）──
        if (fsaSupported()) {
            const folderStatus = el.querySelector<HTMLElement>('#backup-folder-status')!;
            const refreshFolderLabel = async () => {
                const dir = await savedBackupDir();
                folderStatus.textContent = dir
                    ? t('ov.backupFolderCurrent', { name: dirName(dir) })
                    : t('ov.backupFolderNone');
            };
            void refreshFolderLabel();

            el.querySelector('#backup-pick')!.addEventListener('click', async () => {
                try {
                    await pickBackupDir();
                    await refreshFolderLabel();
                } catch { /* 使用者取消選取，靜默 */ }
            });
            el.querySelector('#backup-forget')!.addEventListener('click', async () => {
                await forgetBackupDir();
                await refreshFolderLabel();
            });
            el.querySelector('#backup-folder-run')!.addEventListener('click', async () => {
                let dir = await savedBackupDir();
                if (!dir) {
                    try { dir = await pickBackupDir(); } catch { return; }
                }
                if (!(await ensureRw(dir))) { folderStatus.textContent = t('ov.backupFolderDenied'); return; }
                folderStatus.textContent = t('ov.backupWriting');
                try {
                    const [restore, replays] = await Promise.all([buildRestoreEnvelope(db), buildReplaysEnvelope(db)]);
                    await writeFileTo(dir, RESTORE_FILE, JSON.stringify(restore));
                    await writeFileTo(dir, REPLAYS_FILE, JSON.stringify(replays));
                    await writeFileTo(dir, VIEWER_FILE, viewerHtml());
                    const total = countBackupRecords(restore.tables) + countBackupRecords(replays.tables);
                    folderStatus.textContent = t('ov.backupWrittenTo', { name: dirName(dir), n: total });
                } catch (e) {
                    folderStatus.textContent = t('ov.backupWriteError', { msg: String(e) });
                }
            });
        }

        // ── 匯入（restore／replays／legacy-full 三種 envelope 皆吃）──
        el.querySelector('#backup-import')!.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';   // 允許使用者連續選同一個檔案也能再次觸發 change
            if (!file) return;

            let env;
            try {
                // 不可信的 JSON 只會在核心通過完整 runtime validation 後才取得可寫入的 env。
                env = parseBackupJson(await file.text());
            } catch (e) {
                status.textContent = e instanceof BackupValidationError
                    ? t('ov.backupBadFile')
                    : t('ov.backupImportError', { msg: e instanceof Error ? e.message : String(e) });
                return;
            }

            const total = countBackupRecords(env.tables);
            if (!confirm(t('ov.backupConfirm', { n: total, date: fmtTs(env.exportedAt ?? 0) }))) return;

            status.textContent = t('ov.backupImporting');
            try {
                await restoreBackup(db, env);
                await ctx.reloadState();
                status.textContent = t('ov.backupImported', { n: total });
            } catch (e) {
                if (e instanceof BackupDestinationError) {
                    status.textContent = t('ov.backupDestinationNotEmpty');
                } else if (e instanceof BackupValidationError) {
                    status.textContent = t('ov.backupBadFile');
                } else {
                    status.textContent = t('ov.backupImportError', { msg: String(e) });
                }
            }
        });

        // ── 重播層裁剪（保留規則）──
        const cfg = loadRetentionCfg();
        const retStat = el.querySelector<HTMLElement>('#backup-retention-stat')!;
        const retStatus = el.querySelector<HTMLElement>('#backup-retention-status')!;
        const cfgBag = cfg as unknown as Record<string, boolean | number>;
        el.querySelectorAll<HTMLInputElement>('#backup-retention [data-rc]').forEach(inp => {
            const k = inp.dataset.rc!;
            if (inp.type === 'checkbox') inp.checked = cfgBag[k] as boolean;
            else inp.value = String(cfgBag[k]);
            inp.addEventListener('change', () => {
                cfgBag[k] = inp.type === 'checkbox' ? inp.checked : Math.max(0, Number(inp.value) || 0);
                saveRetentionCfg(cfg);
                void refreshRetention();
            });
        });
        // 目前規則下「可裁剪場數／估計釋放大小」；prunable=0 時停用裁剪鈕。
        let prunableKeys: number[] = [];
        const refreshRetention = async () => {
            const [replays, sorties, shipObtained] = await Promise.all([
                db.replays.toArray(), db.sorties.toArray(), db.shipObtained.toArray(),
            ]);
            const decisions = planRetention(
                replays,
                sorties,
                shipObtained,
                unclearedMapsOf(ctx.state),
                cfg,
                Date.now(),
            );
            const pruneSet = new Set(decisions.filter(d => !d.keep).map(d => d.sortieKey));
            prunableKeys = [...pruneSet];
            const prunables = replays.filter(r => pruneSet.has(r.sortieKey));
            const bytes = prunables.reduce((n, r) => n + JSON.stringify(r).length, 0);
            retStat.textContent = t('ov.retStat', {
                total: replays.length, keep: replays.length - prunables.length,
                prune: prunables.length, size: (bytes / 1048576).toFixed(2),
            });
            el.querySelector<HTMLButtonElement>('#backup-prune')!.disabled = prunables.length === 0;
        };
        void refreshRetention();

        el.querySelector('#backup-prune')!.addEventListener('click', async () => {
            if (!prunableKeys.length) return;
            if (!confirm(t('ov.retPruneConfirm', { n: prunableKeys.length }))) return;
            await db.replays.bulkDelete(prunableKeys);
            retStatus.textContent = t('ov.retPruned', { n: prunableKeys.length });
            await refreshRetention();
        });
    },
};
