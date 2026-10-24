// 情報總括的即時狀態：接收 background 的 `kc:live` 廣播，把 db.events 裡比游標新的 raw event
// 依 id 順序套用到同一份 GameState。
//
// 約束：
//   · 只套用 reducer（同 lib.ts loadGameState），不經 EventProjector、不寫任何 derived tables。
//   · 廣播只當「有新事件」的訊號：每次都從游標往後讀整段，不依賴訊息本身的 id。漏收、
//     重複或亂序的訊息都不會讓狀態缺事件或套用兩次。
//   · 監聽在載入之前就掛上：載入期間進來的訊號只標記 dirty，載入完成後一次補讀，
//     游標之前（已含在載入結果裡）的事件不會重複套用。
import { db } from '@/utils/db';
import { GameState } from '@/utils/state';
import { loadGameStateWithCursor } from './lib';

const READ_RETRY_DELAY_MS = 2000;

export interface LiveState {
    readonly state: GameState;
    /** 重新載入（備份還原後）：整個替換 state 並重設游標。 */
    reload(): Promise<void>;
}

/**
 * @param onLoaded 第一次載入完成（之後由呼叫端重繪目前分區）
 * @param onApplied 套用了新事件；paths 是這批事件的 api path（依序）
 */
export function createLiveState(onLoaded: () => void, onApplied: (paths: string[]) => void): LiveState {
    let state = new GameState();
    let cursor = 0;
    let loaded = false;
    let pumping = false;
    let dirty = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // 載入世代：reload 期間仍在跑的舊一輪補讀，不得把舊 state 的游標寫回來
    let generation = 0;

    const pump = async () => {
        if (!loaded || pumping) return;
        pumping = true;
        const gen = generation;
        try {
            while (dirty) {
                dirty = false;
                let rows;
                try {
                    rows = await db.events.where('id').above(cursor).toArray();
                } catch (error) {
                    // 暫時性讀取失敗（交易衝突等）：稍後重讀，不停止即時更新
                    console.warn('[overview] 讀取新事件失敗，稍後重試', error);
                    dirty = true;
                    if (retryTimer === null) retryTimer = setTimeout(() => { retryTimer = null; void pump(); }, READ_RETRY_DELAY_MS);
                    return;
                }
                if (gen !== generation) return;
                const paths: string[] = [];
                for (const row of rows) {
                    if (row.id === undefined || row.id <= cursor) continue;
                    try {
                        state.applyEvent(row.path, row.api, row.req, row.ts);
                    } catch {
                        // 單筆壞封包不阻斷（同 applyStateRecoveryPlan）
                    }
                    cursor = row.id;
                    paths.push(row.path);
                }
                if (paths.length) onApplied(paths);
            }
        } finally {
            pumping = false;
        }
    };

    browser.runtime.onMessage.addListener((msg: unknown) => {
        if ((msg as { type?: unknown } | null)?.type !== 'kc:live') return;
        dirty = true;
        void pump();
    });

    const load = async () => {
        loaded = false;
        generation++;
        const result = await loadGameStateWithCursor();
        state = result.state;
        cursor = result.lastEventId;
        loaded = true;
    };

    void load().then(() => {
        onLoaded();
        // 載入期間若有新事件進來，現在補讀
        void pump();
    });

    return {
        get state() { return state; },
        async reload() {
            await load();
            dirty = true;
            void pump();
        },
    };
}
