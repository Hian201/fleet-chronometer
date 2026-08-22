// File System Access API 封裝——「把備份寫進使用者選定的資料夾」，零 manifest 權限。
//
// 為何走這條而非 Google Drive / WebDAV 原生 API：後兩者需要 identity(OAuth)＋
// host_permissions（googleapis.com）或 optional_host_permissions（WebDAV 主機），
// 都會增加本專案的權限範圍（見 CLAUDE.md 設計原則 5）。FSA 是 secure context 的網頁 API，
// overview 是一般 extension 頁面即可用；
// 使用者選一次資料夾（可指向 Google Drive Desktop 同步夾／WebDAV 掛載的網路磁碟／
// Dropbox…），上雲同步是桌面同步客戶端的事，擴充只負責「寫檔進那個資料夾」——
// 延續 MCP 路徑「擴充存檔就結束、出不出境由使用者的 OS/同步客戶端決定」的同一套哲學。
//
// 目錄 handle 用一支獨立的原生 IndexedDB（非 Dexie）保存：handle 可被 structured-clone
// 存進 IDB，但無法序列化成 localStorage 字串；獨立小庫也讓這個 FSA 關注點不必動 Dexie
// schema（Phase 1 不碰 schema）。重開分頁後 handle 仍在，但瀏覽器會要求再次授權
// （queryPermission → requestPermission，須由使用者手勢觸發）。

// queryPermission / requestPermission 不在標準 lib.dom（屬另一份 spec），最小補宣告。
interface FsPermissionHandle {
    queryPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}
type DirHandle = FileSystemDirectoryHandle & FsPermissionHandle;

const IDB_NAME = 'kc-fsa';
const STORE = 'handles';
const KEY = 'backupDir';

function openIdb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbGet<T>(key: string): Promise<T | undefined> {
    return openIdb().then(db => new Promise<T | undefined>((resolve, reject) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result as T | undefined);
        r.onerror = () => reject(r.error);
    }));
}

function idbSet(key: string, val: unknown): Promise<void> {
    return openIdb().then(db => new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

function idbDel(key: string): Promise<void> {
    return openIdb().then(db => new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

/** 瀏覽器是否支援 FSA 目錄選取（Chromium 系有、Firefox/Safari 目前無）。 */
export function fsaSupported(): boolean {
    return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** 讓使用者選一個資料夾並儲存最新的 handle。使用者取消會 throw AbortError。 */
export async function pickBackupDir(): Promise<DirHandle> {
    const picker = (window as unknown as {
        showDirectoryPicker(opts?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    const handle = (await picker({ mode: 'readwrite' })) as DirHandle;
    await idbSet(KEY, handle);
    return handle;
}

/** 取回已儲存的資料夾 handle（沒有則 undefined）。尚未重新授權，寫入前須 ensureRw。 */
export async function savedBackupDir(): Promise<DirHandle | undefined> {
    return idbGet<DirHandle>(KEY);
}

/** 忘記已選資料夾。 */
export async function forgetBackupDir(): Promise<void> {
    await idbDel(KEY);
}

/** 確保對 handle 有讀寫權限；已授權回 true，否則以使用者手勢請求。 */
export async function ensureRw(handle: DirHandle): Promise<boolean> {
    const opt = { mode: 'readwrite' as const };
    if ((await handle.queryPermission(opt)) === 'granted') return true;
    return (await handle.requestPermission(opt)) === 'granted';
}

/** 顯示用的資料夾名稱。 */
export function dirName(handle: FileSystemDirectoryHandle): string {
    return handle.name;
}

/** 資料夾裡是否已有這個檔名（不含 create，不會誤生空檔）。 */
export async function fileExists(dir: DirHandle, name: string): Promise<boolean> {
    try {
        await dir.getFileHandle(name);
        return true;
    } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return false;
        // 同名是資料夾：視為已佔用，換下一個檔名。
        if (e instanceof DOMException && e.name === 'TypeMismatchError') return true;
        throw e;
    }
}

/** 寫一個文字檔到資料夾（同名覆寫；備份 JSON 須先用 unusedBackupFileName 避開既有檔案）。 */
export async function writeFileTo(dir: DirHandle, name: string, text: string): Promise<void> {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
}
