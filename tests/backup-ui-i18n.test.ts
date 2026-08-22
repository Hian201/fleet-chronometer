import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../utils/ui-i18n';

afterEach(() => setLang('ja'));

describe('完整備份與舊版遷移的三語安全提示', () => {
    it.each(['zh-TW', 'ja', 'en'] as const)('%s 將格式錯誤與 destination 拒絕分流', language => {
        setLang(language);
        const malformed = t('ov.backupBadFile');
        const destination = t('ov.backupDestinationNotEmpty');

        expect(malformed).not.toBe('ov.backupBadFile');
        expect(destination).not.toBe('ov.backupDestinationNotEmpty');
        expect(malformed).not.toBe(destination);
    });

    it.each(['zh-TW', 'ja', 'en'] as const)('%s 說明 clean destination 與舊雙檔遷移限制', language => {
        setLang(language);

        expect(t('ov.backupConfirm', { n: 1, date: 'fixture' })).toContain('1');
        expect(t('ov.backupFileIntro').length).toBeGreaterThan(40);
        expect(t('ov.backupFileIntro')).toContain('kanmusu-');
        expect(t('ov.backupNeedComplement').length).toBeGreaterThan(20);
        expect(t('ov.backupEmptyRefuse')).not.toBe('ov.backupEmptyRefuse');
        expect(t('ov.backupEmptyRefuse').length).toBeGreaterThan(20);
        expect(t('ov.backupWrittenTo', { name: 'Drive', n: 3, file: 'kanmusu-backup-2026-08-14-030809.json' }))
            .toContain('kanmusu-backup-2026-08-14-030809.json');
        expect(t('ov.backupExported', { n: 3, file: 'kanmusu-backup-2026-08-14-030809.json' }))
            .toContain('kanmusu-backup-2026-08-14-030809.json');
    });
});
