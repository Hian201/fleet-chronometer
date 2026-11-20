// entrypoints/overview/fsa.ts：備份資料夾 handle 的保存／遺忘、檔案存在判斷與寫檔失敗收尾。
// IndexedDB 為模組私有，透過匯出函式以 fake-indexeddb 驗證；handle 用可 structured-clone 的
// 純物件替身（真 FileSystemDirectoryHandle 的 clone 由瀏覽器負責）。
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    dirName, ensureRw, fileExists, forgetBackupDir, fsaSupported, pickBackupDir, savedBackupDir, writeFileTo,
} from '../entrypoints/overview/fsa';

type Dir = Parameters<typeof writeFileTo>[0];

const domError = (name: string) => new DOMException(name, name);

beforeEach(async () => { await forgetBackupDir(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('備份資料夾 handle 持久化', () => {
    it('尚未選過資料夾時 savedBackupDir 回 undefined', async () => {
        expect(await savedBackupDir()).toBeUndefined();
    });

    it('pickBackupDir 儲存 handle，savedBackupDir 可取回；forgetBackupDir 後消失', async () => {
        const picker = vi.fn(async (_opts?: unknown) => ({ kind: 'directory', name: '備份' }));
        vi.stubGlobal('window', { showDirectoryPicker: picker });
        const picked = await pickBackupDir();
        expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' });
        expect(picked.name).toBe('備份');
        expect(await savedBackupDir()).toEqual({ kind: 'directory', name: '備份' });

        await forgetBackupDir();
        expect(await savedBackupDir()).toBeUndefined();
    });

    it('再次選擇會覆寫先前的 handle', async () => {
        const names = ['A', 'B'];
        vi.stubGlobal('window', { showDirectoryPicker: async () => ({ kind: 'directory', name: names.shift() }) });
        await pickBackupDir();
        await pickBackupDir();
        expect((await savedBackupDir())?.name).toBe('B');
    });

    it('使用者取消選取時 AbortError 向外傳遞，且不改動已存的 handle', async () => {
        vi.stubGlobal('window', { showDirectoryPicker: async () => ({ kind: 'directory', name: 'old' }) });
        await pickBackupDir();
        vi.stubGlobal('window', { showDirectoryPicker: async () => { throw domError('AbortError'); } });
        await expect(pickBackupDir()).rejects.toMatchObject({ name: 'AbortError' });
        expect((await savedBackupDir())?.name).toBe('old');
    });

    it('forgetBackupDir 在沒有資料時也不拋錯', async () => {
        await expect(forgetBackupDir()).resolves.toBeUndefined();
    });
});

describe('fsaSupported／dirName', () => {
    it('有 showDirectoryPicker 才算支援', () => {
        vi.stubGlobal('window', {});
        expect(fsaSupported()).toBe(false);
        vi.stubGlobal('window', { showDirectoryPicker: () => { } });
        expect(fsaSupported()).toBe(true);
    });

    it('dirName 回傳 handle 名稱', () => {
        expect(dirName({ name: 'Drive' } as FileSystemDirectoryHandle)).toBe('Drive');
    });
});

describe('ensureRw', () => {
    const handle = (query: PermissionState, request: PermissionState) => ({
        queryPermission: vi.fn(async () => query),
        requestPermission: vi.fn(async () => request),
    }) as unknown as Parameters<typeof ensureRw>[0] & {
        queryPermission: ReturnType<typeof vi.fn>; requestPermission: ReturnType<typeof vi.fn>;
    };

    it('已授權時不再請求', async () => {
        const h = handle('granted', 'denied');
        expect(await ensureRw(h)).toBe(true);
        expect(h.requestPermission).not.toHaveBeenCalled();
    });

    it('未授權時請求，依請求結果回傳', async () => {
        const ok = handle('prompt', 'granted');
        expect(await ensureRw(ok)).toBe(true);
        expect(ok.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
        expect(await ensureRw(handle('prompt', 'denied'))).toBe(false);
    });
});

describe('fileExists', () => {
    const dirWith = (getFileHandle: (name: string) => Promise<unknown>) => ({ getFileHandle }) as unknown as Dir;

    it('取得得到檔案 handle 回 true', async () => {
        expect(await fileExists(dirWith(async () => ({})), 'a.json')).toBe(true);
    });

    it('NotFoundError 回 false', async () => {
        expect(await fileExists(dirWith(async () => { throw domError('NotFoundError'); }), 'a.json')).toBe(false);
    });

    it('同名是資料夾（TypeMismatchError）視為已佔用', async () => {
        expect(await fileExists(dirWith(async () => { throw domError('TypeMismatchError'); }), 'a')).toBe(true);
    });

    it('其他錯誤向外傳遞', async () => {
        await expect(fileExists(dirWith(async () => { throw domError('NotAllowedError'); }), 'a'))
            .rejects.toMatchObject({ name: 'NotAllowedError' });
        await expect(fileExists(dirWith(async () => { throw new Error('boom'); }), 'a')).rejects.toThrow('boom');
    });

    it('查詢時不帶 create，避免誤生空檔', async () => {
        const getFileHandle = vi.fn(async (_name: string, _opts?: unknown) => ({}));
        await fileExists({ getFileHandle } as unknown as Dir, 'x.json');
        expect(getFileHandle).toHaveBeenCalledWith('x.json');
    });
});

describe('writeFileTo', () => {
    const makeDir = (writable: Record<string, unknown>) => {
        const getFileHandle = vi.fn(async (_name: string, _opts?: unknown) => ({ createWritable: async () => writable }));
        return { dir: { getFileHandle } as unknown as Dir, getFileHandle };
    };

    it('成功時以 create:true 開檔、寫入文字後 close，不呼叫 abort', async () => {
        const writable = { write: vi.fn(async () => { }), close: vi.fn(async () => { }), abort: vi.fn(async () => { }) };
        const { dir, getFileHandle } = makeDir(writable);
        await writeFileTo(dir, 'b.json', '{"a":1}');
        expect(getFileHandle).toHaveBeenCalledWith('b.json', { create: true });
        expect(writable.write).toHaveBeenCalledWith('{"a":1}');
        expect(writable.close).toHaveBeenCalledOnce();
        expect(writable.abort).not.toHaveBeenCalled();
    });

    it('write 失敗時呼叫 abort 放掉 writable，並把原錯誤向外傳遞', async () => {
        const failure = new Error('disk full');
        const writable = {
            write: vi.fn(async () => { throw failure; }),
            close: vi.fn(async () => { }),
            abort: vi.fn(async () => { }),
        };
        const { dir } = makeDir(writable);
        await expect(writeFileTo(dir, 'b.json', 'x')).rejects.toBe(failure);
        expect(writable.abort).toHaveBeenCalledOnce();
        expect(writable.close).not.toHaveBeenCalled();
    });

    it('close 失敗同樣 abort 並傳遞錯誤', async () => {
        const failure = new Error('close failed');
        const writable = {
            write: vi.fn(async () => { }),
            close: vi.fn(async () => { throw failure; }),
            abort: vi.fn(async () => { }),
        };
        const { dir } = makeDir(writable);
        await expect(writeFileTo(dir, 'b.json', 'x')).rejects.toBe(failure);
        expect(writable.abort).toHaveBeenCalledOnce();
    });

    it('abort 本身也失敗時，傳出的仍是原本的寫入錯誤', async () => {
        const failure = new Error('write failed');
        const writable = {
            write: vi.fn(async () => { throw failure; }),
            abort: vi.fn(async () => { throw new Error('abort failed'); }),
        };
        const { dir } = makeDir(writable);
        await expect(writeFileTo(dir, 'b.json', 'x')).rejects.toBe(failure);
        expect(writable.abort).toHaveBeenCalledOnce();
    });

    it('createWritable 之前失敗（取不到檔案 handle）時直接傳遞錯誤', async () => {
        const dir = { getFileHandle: async () => { throw domError('NotAllowedError'); } } as unknown as Dir;
        await expect(writeFileTo(dir, 'b.json', 'x')).rejects.toMatchObject({ name: 'NotAllowedError' });
    });
});
