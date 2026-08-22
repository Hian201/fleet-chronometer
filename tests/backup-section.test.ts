import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 資料夾備份：每次新檔（日期＋時分秒，撞名加序號）；空備份在 writeFileTo 之前拒絕。
const src = readFileSync(new URL('../entrypoints/overview/sections/backup.ts', import.meta.url), 'utf8');

describe('情報總括資料備份寫檔', () => {
    it('匯出用 backupFileName；資料夾寫入用 unusedBackupFileName，不再寫死 kanmusu-backup.json', () => {
        expect(src).toContain('backupFileName(env.exportedAt)');
        expect(src).toContain('unusedBackupFileName(');
        expect(src).toContain('fileExists(dir, name)');
        expect(src).not.toContain("const BACKUP_FILE = 'kanmusu-backup.json'");
        expect(src).not.toContain("writeFileTo(dir, BACKUP_FILE");
        expect(src).not.toContain("downloadText(BACKUP_FILE");
        const folderRun = src.slice(
            src.indexOf("querySelector('#backup-folder-run')"),
            src.indexOf("querySelector('#backup-import')"),
        );
        expect(folderRun).toContain('unusedBackupFileName');
        expect(folderRun).not.toMatch(/writeFileTo\(dir,\s*backupFileName/);
    });

    it('空備份在取得寫入權限／writeFileTo 之前就拒絕', () => {
        expect(src).toContain('isEmptyBackup(env.tables)');
        expect(src).toContain('isEmptyBackup(backup.tables)');
        expect(src).toContain("t('ov.backupEmptyRefuse')");
        const folderRun = src.slice(
            src.indexOf("querySelector('#backup-folder-run')"),
            src.indexOf("querySelector('#backup-import')"),
        );
        expect(folderRun.indexOf('isEmptyBackup')).toBeLessThan(folderRun.indexOf('ensureRw'));
        expect(folderRun.indexOf('isEmptyBackup')).toBeLessThan(folderRun.indexOf('writeFileTo'));
    });
});
