// 資料備份與還原：真正「可還原」的結構化 JSON 匯出/匯入，跟 llm.ts 的完整報告
// （Markdown，設計給人/LLM 讀、近期紀錄節錄、不可逆解析）是完全不同性質的東西。
//
// 現行備份是一個完整檔：snapshot／各種紀錄摘要／**replays 原始戰鬥封包**一起匯出。
// sorties 只有摘要，沒有 replay 就無法重建出擊時編成、逐節點戰鬥、支援與基地航空隊；
// 因此完整檔是唯一的預設還原路徑；檔案大小由明確的重播保留規則管理。
//
// 仍支援 legacy 的 kanmusu-restore.json + kanmusu-replays.json 配對匯入；核心會先在
// 記憶體驗證並合併，最後以一個 IndexedDB transaction 寫入，缺任一檔不會留下半套資料。
// 刻意不含：db.events（原始封包日誌，本就設計成會被裁剪，db.snapshot 已是重建現狀的
// 最小子集）與 localStorage 偏好（語言/主題）。
//
// 資料夾備份（FSA）：把完整備份檔＋離線提取器 viewer.html 一次寫進使用者選定的資料夾
// （可指向 Google Drive Desktop／WebDAV 掛載磁碟等同步夾），上雲同步交給桌面同步客戶端，
// 擴充零新權限（見 fsa.ts 的權限說明）。無 FSA 支援的瀏覽器退回純下載。
import type { OverviewSection } from './types';
import { db } from '@/utils/db';
import {
    BackupDestinationError, BackupValidationError, backupFileName, buildFullEnvelope, combineBackupEnvelopes,
    countBackupRecords, isEmptyBackup, parseBackupJson, restoreBackup, unusedBackupFileName,
    type ValidatedBackupEnvelope,
} from '@/utils/backup';
import { t } from '@/utils/ui-i18n';
import { esc, downloadText, fmtTs } from '../lib';
import { fsaSupported, pickBackupDir, savedBackupDir, forgetBackupDir, ensureRw, dirName, writeFileTo, fileExists } from '../fsa';
import { viewerHtml } from '../viewer-html';
import { computePrunableKeys, DEFAULT_RETENTION, type RetentionConfig } from '@/utils/retention';
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
                <button class="ov-btn" id="backup-export">${esc(t('ov.backupExport'))}</button>
                <button class="ov-btn" id="backup-import">${esc(t('ov.backupImport'))}</button>
                <input type="file" id="backup-file" accept="application/json,.json" multiple style="display:none">
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
        // legacy split 備份可在兩次檔案選擇中配對；只留在本頁記憶體，湊齊前絕不碰 DB。
        let pendingLegacySplit: ValidatedBackupEnvelope | undefined;

        // ── 檔案匯出（fallback／單檔下載）──
        el.querySelector('#backup-export')!.addEventListener('click', async () => {
            const env = await buildFullEnvelope(db);
            if (isEmptyBackup(env.tables)) {
                status.textContent = t('ov.backupEmptyRefuse');
                return;
            }
            const file = backupFileName(env.exportedAt);
            downloadText(file, JSON.stringify(env), 'application/json');
            status.textContent = t('ov.backupExported', { n: countBackupRecords(env.tables), file });
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
                let backup;
                try {
                    backup = await buildFullEnvelope(db);
                } catch (e) {
                    folderStatus.textContent = t('ov.backupWriteError', { msg: String(e) });
                    return;
                }
                if (isEmptyBackup(backup.tables)) {
                    folderStatus.textContent = t('ov.backupEmptyRefuse');
                    return;
                }
                let dir = await savedBackupDir();
                if (!dir) {
                    try { dir = await pickBackupDir(); } catch { return; }
                }
                if (!(await ensureRw(dir))) { folderStatus.textContent = t('ov.backupFolderDenied'); return; }
                folderStatus.textContent = t('ov.backupWriting');
                try {
                    const file = await unusedBackupFileName(
                        backup.exportedAt,
                        name => fileExists(dir, name),
                    );
                    await writeFileTo(dir, file, JSON.stringify(backup));
                    await writeFileTo(dir, VIEWER_FILE, viewerHtml());
                    const total = countBackupRecords(backup.tables);
                    folderStatus.textContent = t('ov.backupWrittenTo', { name: dirName(dir), n: total, file });
                } catch (e) {
                    folderStatus.textContent = t('ov.backupWriteError', { msg: String(e) });
                }
            });
        }

        // ── 匯入（v6 full 單檔；v1 legacy-full；v2–v5 legacy split）──
        el.querySelector('#backup-import')!.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const files = [...(fileInput.files ?? [])];
            fileInput.value = '';   // 允許使用者連續選同一個檔案也能再次觸發 change
            if (!files.length) return;

            let parsed: ValidatedBackupEnvelope[];
            try {
                // 不可信的 JSON 先逐檔完整驗證；尚未配對的 split 檔只會留在記憶體。
                parsed = await Promise.all(files.map(async file =>
                    parseBackupJson(await file.text()),
                ));
            } catch (e) {
                status.textContent = e instanceof BackupValidationError
                    ? t('ov.backupBadFile')
                    : t('ov.backupImportError', { msg: e instanceof Error ? e.message : String(e) });
                return;
            }

            let env: ValidatedBackupEnvelope;
            const isLegacySplit = (candidate: ValidatedBackupEnvelope) =>
                candidate.kind === 'restore' || candidate.kind === 'replays';

            if (parsed.length === 1 && isLegacySplit(parsed[0])) {
                if (!pendingLegacySplit) {
                    pendingLegacySplit = parsed[0];
                    status.textContent = t('ov.backupNeedComplement');
                    return;
                }

                try {
                    // 只有 restore + replays 的正確一對能通過；完成後才繼續確認與 transaction。
                    env = combineBackupEnvelopes([pendingLegacySplit, parsed[0]]);
                    pendingLegacySplit = undefined;
                } catch (e) {
                    // 同類型、跨備份或其他錯配不可讓暫存檔殘留，下一次從頭開始。
                    pendingLegacySplit = undefined;
                    status.textContent = e instanceof BackupValidationError
                        ? t('ov.backupBadFile')
                        : t('ov.backupImportError', { msg: e instanceof Error ? e.message : String(e) });
                    return;
                }
            } else {
                // 已暫存一份 split 檔時，下一次必須只選它的配對檔，避免把三份來源混在一起。
                if (pendingLegacySplit) {
                    pendingLegacySplit = undefined;
                    status.textContent = t('ov.backupBadFile');
                    return;
                }
                try {
                    // 同次選到 split 檔時由核心合併為完整 v6 envelope；單獨 split 會被拒絕。
                    env = combineBackupEnvelopes(parsed);
                } catch (e) {
                    status.textContent = e instanceof BackupValidationError
                        ? t('ov.backupBadFile')
                        : t('ov.backupImportError', { msg: e instanceof Error ? e.message : String(e) });
                    return;
                }
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
        // 統計列用的快取：只驅動「可裁剪場數」顯示與按鈕 disabled，刪除路徑不依賴它。
        let cachedPrunableCount = 0;
        const refreshRetention = async () => {
            const [replays, sorties, shipObtained] = await Promise.all([
                db.replays.toArray(), db.sorties.toArray(), db.shipObtained.toArray(),
            ]);
            const keys = computePrunableKeys(
                replays, sorties, shipObtained, unclearedMapsOf(ctx.state), cfg, Date.now(),
            );
            cachedPrunableCount = keys.length;
            const pruneSet = new Set(keys);
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
            if (!cachedPrunableCount) return;
            if (!confirm(t('ov.retPruneConfirm', { n: cachedPrunableCount }))) return;
            // confirm 之後、bulkDelete 之前：讀最新資料重算，絕不用過期快取。
            const [replays, sorties, shipObtained] = await Promise.all([
                db.replays.toArray(), db.sorties.toArray(), db.shipObtained.toArray(),
            ]);
            const freshKeys = computePrunableKeys(
                replays, sorties, shipObtained, unclearedMapsOf(ctx.state), cfg, Date.now(),
            );
            if (!freshKeys.length) {
                retStatus.textContent = t('ov.retPruneCancelled');
                await refreshRetention();
                return;
            }
            await db.replays.bulkDelete(freshKeys);
            retStatus.textContent = t('ov.retPruned', { n: freshKeys.length });
            await refreshRetention();
        });
    },
};
