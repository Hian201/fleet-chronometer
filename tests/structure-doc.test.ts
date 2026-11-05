// docs/structure.html 是重建備案；它只記少數版本錨點，升版時若忘了同步，這裡會失敗。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BACKUP_SCHEMA_VERSION } from '@/utils/backup';
import { PROJECTION_META_VERSION } from '@/utils/projection-cursor';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const doc = read('docs/structure.html');

function anchor(name: string): number {
    const match = doc.match(new RegExp(`data-anchor="${name}">(\\d+)<`));
    expect(match, `structure.html 缺少版本錨點 ${name}`).not.toBeNull();
    return Number(match![1]);
}

describe('structure.html 的版本錨點與程式碼一致', () => {
    it('IndexedDB schema 版本', () => {
        const versions = [...read('utils/db.ts').matchAll(/this\.version\((\d+)\)/g)].map(m => Number(m[1]));
        expect(anchor('db-schema')).toBe(Math.max(...versions));
    });

    it('完整備份格式版本', () => {
        expect(anchor('backup-schema')).toBe(BACKUP_SCHEMA_VERSION);
    });

    it('projection cursor metadata 版本', () => {
        expect(anchor('projection-meta')).toBe(PROJECTION_META_VERSION);
    });
});
