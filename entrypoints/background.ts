import { db, type ApiEventRow, type GamePageMetaRow } from '@/utils/db';
import {
  MSG_MUTE_GET, MSG_MUTE_SET,
  MSG_CAPTURE_TAB, MSG_THEATER_FIT_WINDOW, MSG_THEATER_TOGGLE, MSG_UI_LANG, MSG_UI_LANG_SET, PORT_MUTE,
  type TheaterFitWindowMessage,
} from '@/utils/game-page';
import { BackgroundIngestionLifecycle } from '@/utils/background-ingestion-lifecycle';
import { createEventNotificationId } from '@/utils/event-notification';
import { pruneRawEventsBefore } from '@/utils/event-pruning';
import { parseKcsapiResponse } from '@/utils/kcsapi';
import { captureResources } from '@/utils/resource-capture';
import { captureShipObtained } from '@/utils/ship-obtained';
import { replyWhenSettled } from '@/utils/runtime-reply';

// [新增] 提前通知時間：遊戲機制中剩餘 1 分鐘回港即自動結算
const EARLY_MS = 60_000;

// 母港快照（db.snapshot，見 utils/db.ts SnapshotRow 註解）要保存的 path 清單：
// 足以讓 GameState.applyEvent() 在全新安裝（db.events 為空）時重建艦娘/裝備/艦隊/
// 基地航空隊/關卡量表——api_start2/getData 尤其關鍵（艦種/裝備 master 表的唯一來源，
// 沒有它 shipName()/gearName() 只能回退顯示日文原名、stype/maxeq 等衍生欄位全部缺失）。
// 刻意不含 api_get_member/questlist：任務清單靠多頁累積（見 background.ts KEEP_RECENT
// 註解），單一 path 只留最新一筆的快照設計留不住完整分頁，優先權較低（非本次範圍）。
const SNAPSHOT_PATHS = new Set([
  'api_start2/getData',
  'api_port/port',
  'api_get_member/require_info',
  'api_get_member/slot_item',
  'api_get_member/base_air_corps',
  'api_get_member/mapinfo',
]);

// [新增] 立即發送系統通知
async function notifyNow(message: string, notificationId?: string) {
  console.log('[notify now]', message);
  const options = {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title: 'Fleet Chronometer',
    message,
  } as const;
  if (notificationId) await browser.notifications.create(notificationId, options);
  else await browser.notifications.create(options);
}

// [新增] 若剩餘 ≤ 1 分鐘就立即通知，否則建立提前 1 分鐘的 alarm
async function scheduleOrNotify(name: string, completeAt: number, notificationId?: string) {
  const target = completeAt - EARLY_MS;
  if (target <= Date.now()) {
    await notifyNow(name, notificationId);
  } else {
    await browser.alarms.create(name, { when: target });
  }
}

// ingestEvent() 失敗時的回覆內容：sender 只需要知道「這筆結束了」，錯誤本身留在 SW console。
// 舊寫法把 promise 直接回傳給瀏覽器，失敗時會變成無人接手的 unhandled rejection。
function reportIngestFailure(error: unknown): undefined {
  console.error('[KC-Monitor] ingestEvent 失敗', error);
  return undefined;
}

export default defineBackground(() => {
  // recovery 立即啟動，但下方 listener 不等待它完成才註冊，避免 SW 剛被喚醒時漏接訊息。
  // listener 交進來的 ingestion 會在 lifecycle queue 中等待 recoveryPromise。
  const ingestionLifecycle = new BackgroundIngestionLifecycle({ db, postProcess: postProcessEvent });

  // ── 事件攝入單一入口（provider 合約邊界）──────────────────
  // 所有封包來源交件的唯一窗口：先等 recovery，再由既有 Batch 2.3 狀態機保存 raw event、
  // claim post-processing，最後執行廣播、快照、裁剪與通知排程。任何 provider 都不得繞過它。
  const ingestEvent = (row: ApiEventRow): Promise<number> => ingestionLifecycle.ingest(row);

  // MAIN world 傳輸邊界：bridge content script 經 runtime message 交件，一律標 source='main'。
  // 未來新增 Native Companion（browser.runtime.onConnectNative）或 Proxy 來源時，
  // 各自在此加一個 listener、構造同格式 row 並標對應 source，同樣呼叫 ingestEvent()——
  // 下游（裁剪、通知、db.events→GameState→面板）一行都不用改（見 utils/db.ts ApiEventRow 合約）。
  // ── 遊戲頁偏好（靜音／語言鏡像）─────────────────────
  // 靜音狀態的持有者是 SW（遊戲分頁重載後仍要生效）。實機確認 BGM 不一定走遊戲框內可
  // 攔截的音訊路徑，故除既有 hook 外，以 tabs.update 靜音整個遊戲分頁，確保 BGM 一併停止。
  type MutePort = Parameters<Parameters<typeof browser.runtime.onConnect.addListener>[0]>[0];
  const mutePorts = new Set<MutePort>();
  const mutePortTabs = new Map<MutePort, number>();
  const muteGameTabs = async (muted: boolean, currentTabId?: number) => {
    const tabIds = new Set(mutePortTabs.values());
    if (typeof currentTabId === 'number') tabIds.add(currentTabId);
    await Promise.all([...tabIds].map(tabId =>
      browser.tabs.update(tabId, { muted }).catch(() => undefined),
    ));
  };
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_MUTE) return;
    mutePorts.add(port);
    const tabId = port.sender?.tab?.id;
    if (typeof tabId === 'number') mutePortTabs.set(port, tabId);
    port.onDisconnect.addListener(() => {
      mutePorts.delete(port);
      mutePortTabs.delete(port);
    });
    // 連上就先推目前狀態：遊戲分頁重新載入後不必等使用者再按一次。
    void readGamePagePrefs().then(prefs => {
      try { port.postMessage({ muted: prefs.muted }); } catch { /* 已斷線 */ }
      if (prefs.muted) void muteGameTabs(true);
    });
  });
  const broadcastMute = (muted: boolean) => {
    for (const port of mutePorts) {
      try { port.postMessage({ muted }); } catch { mutePorts.delete(port); }
    }
  };

  // 所有回覆一律走 sendResponse + return true（見 utils/runtime-reply.ts 檔頭：回傳
  // Promise 只有 Chrome 148 起才支援，舊版會讓 sender 收到 undefined 而非真正的回覆）。
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // popup 快捷選單的「開啟面板」（entrypoints/popup/）：開窗邏輯留在 SW，
    // popup 送完訊息就自關，不能自己開窗（popup 關閉會中斷其非同步流程）。
    // 必須 replyWhenSettled 撐到 windows.create 完成——若同步 return 讓通道立刻關閉，
    // MV3 SW 可能在開窗前就被掛起（dev 模式下尤甚）。setTimeout(0) 則避開
    // 「在 onMessage 裡再 sendMessage(panel-ping)」的巢狀訊息陷阱。
    if (msg?.type === 'kc:open-panel') {
      return replyWhenSettled(
        new Promise<void>((resolve, reject) => {
          setTimeout(() => { openPanelWindow().then(() => resolve(), reject); }, 0);
        }),
        sendResponse,
      );
    }
    // `connected` = 目前連著的遊戲分頁數。0 代表沒有任何分頁跑著新版 content script
    // （擴充更新後遊戲分頁未 F5），此時靜音一定無效——這種「靜靜沒反應」最難查，故回報。
    if (msg?.type === MSG_MUTE_GET) {
      return replyWhenSettled(
        readGamePagePrefs().then(p => ({ muted: p.muted, connected: mutePorts.size })),
        sendResponse,
      );
    }
    if (msg?.type === MSG_MUTE_SET) {
      const muted = !!msg.muted;
      broadcastMute(muted);
      return replyWhenSettled(
        writeGamePagePrefs({ muted })
          // 劇場底部工具列的發送者就是目前遊戲分頁；就算 bridge port 尚未連上，也必須能靜音。
          .then(() => muteGameTabs(muted, sender.tab?.id))
          .then(() => ({ muted, connected: mutePorts.size })),
        sendResponse,
      );
    }
    if (msg?.type === MSG_THEATER_FIT_WINDOW) {
      return replyWhenSettled(fitTheaterWindow(sender.tab?.windowId, msg), sendResponse);
    }
    // 拍照：content script 沒有 tabs API，一律經這裡轉手；popup 走同一條訊息，
    // 錯誤處理只寫一份。captureVisibleTab 只認 <all_urls> 或 activeTab（見 wxt.config.ts），
    // 那是分頁層級的暫時授權，跟呼叫者是 popup 還是 content script 無關。
    if (msg?.type === MSG_CAPTURE_TAB) {
      const windowId = typeof msg.windowId === 'number' ? msg.windowId : sender.tab?.windowId;
      if (typeof windowId !== 'number') { sendResponse({ error: 'no-window' }); return; }
      return replyWhenSettled(
        browser.tabs.captureVisibleTab(windowId, { format: 'png' }).then(dataUrl => ({ dataUrl })),
        sendResponse,
        e => ({ error: String((e as { message?: unknown })?.message ?? e) }),
      );
    }
    if (msg?.type === MSG_UI_LANG) {
      return replyWhenSettled(readGamePagePrefs().then(p => p.lang), sendResponse);
    }
    if (msg?.type === MSG_UI_LANG_SET) {
      return replyWhenSettled(
        writeGamePagePrefs({ lang: String(msg.lang ?? '') }).then(() => undefined),
        sendResponse,
      );
    }
    if (msg?.type !== 'kc:api') return;
    // 新 bridge 交原始文字，讓大型封包在 service worker 解析，避開遊戲 renderer 主執行緒。
    // 保留舊 bridge 的 api object 相容路徑，擴充重新載入後尚未 F5 的既有遊戲分頁不會漏事件。
    let api = msg.api;
    if (typeof msg.apiText === 'string') {
      try {
        api = parseKcsapiResponse(msg.apiText);
      } catch {
        console.warn('[KC-Monitor] 無法解析 kcsapi response，略過此筆事件', msg.path);
        return;
      }
    }
    // 帳號安全紅線的第二道防線：bridge.content.ts 已經剝過 api_token/api_verno，但那是
    // 靠 URLSearchParams 解析 req 字串的單點防線——若日後某個請求體格式跳脫這個假設而
    // 讓 token 漏網，這裡是 ingestEvent()（唯一持久化入口）前最後也是唯一的第二道關卡，
    // 不管 req 從哪個 provider、以什麼路徑送進來都會被擋下，不信任上游已經處理乾淨。
    const req = msg.req && typeof msg.req === 'object' ? { ...msg.req } : msg.req;
    if (req) {
      delete (req as Record<string, unknown>).api_token;
      delete (req as Record<string, unknown>).api_verno;
    }
    // ingestion 完成後才回覆（舊寫法是回傳 promise，等於在多數瀏覽器上立刻回覆 undefined）。
    // 這裡刻意讓通道開到寫入結束：SW 若在寫入途中被回收，通道會以錯誤關閉，bridge 的
    // sendKcApiRuntimeMessageWithRetry 便會用同一個 envelope 重試一次，而不是靜靜掉一筆封包；
    // captureId 相同，重複由既有 unique index 去重，不會產生第二筆 raw event。
    // ingestion 本身失敗（例如寫入被拒）仍只記錄不重試，與既有行為一致。
    return replyWhenSettled(
      ingestEvent({
        ts: msg.ts,
        path: msg.path,
        api,
        req,
        captureId: msg.captureId,
        source: 'main',
      }),
      sendResponse,
      reportIngestFailure,
    );
  });

  // [修改] alarm 觸發時改用 notifyNow 統一邏輯
  browser.alarms.onAlarm.addListener(a => {
    console.log('[alarm fired]', a.name);
    void notifyNow(a.name);
  });

  browser.alarms.getAll().then(console.log)

  // 點擊擴充圖示改由 popup 快捷選單接手（manifest action.default_popup，
  // entrypoints/popup/）：MV3 規格下設了 default_popup 後 action.onClicked
  // 永遠不觸發，故原本掛在 onClicked 的開面板邏輯移到上方 kc:open-panel 訊息。
});

/** 依 content script 的實際 outer-inner 差，讓內容區精準容納原始遊戲區與底部列。 */
async function fitTheaterWindow(windowId: number | undefined, msg: TheaterFitWindowMessage): Promise<void> {
  if (typeof windowId !== 'number') return;
  const { game, barHeight, inner, outer } = msg;
  const valid = [game.width, game.height, barHeight, inner.width, inner.height, outer.width, outer.height]
    .every(value => Number.isFinite(value) && value >= 0);
  if (!valid || game.width < 400 || game.height < 300) return;
  const chromeWidth = Math.max(0, outer.width - inner.width);
  const chromeHeight = Math.max(0, outer.height - inner.height);
  await browser.windows.update(windowId, {
    width: Math.round(game.width + chromeWidth),
    height: Math.round(game.height + barHeight + chromeHeight),
  }).catch(() => undefined);
}

// ── 遊戲頁偏好的持久化（db.meta['game-page']）────────────
// 只有兩個欄位：muted（遊戲靜音，狀態必須撐過遊戲分頁重載與 SW 被殺）與 lang（擴充頁面
// 語言的鏡像，供跑在 dmm.com 的劇場模式工具列讀取——那支 content script 跨 origin，
// 讀不到擴充頁面的 localStorage）。刻意不用 chrome.storage：那要新增 storage 權限。
async function readGamePagePrefs(): Promise<{ muted: boolean; lang?: string }> {
  try {
    const row = await db.meta.get('game-page') as GamePageMetaRow | undefined;
    return { muted: !!row?.muted, lang: row?.lang };
  } catch (e) {
    console.warn('[KC-Monitor] 讀取遊戲頁偏好失敗', e);
    return { muted: false };
  }
}

async function writeGamePagePrefs(patch: { muted?: boolean; lang?: string }): Promise<void> {
  try {
    const current = await readGamePagePrefs();
    await db.meta.put({
      key: 'game-page',
      muted: patch.muted ?? current.muted,
      lang: patch.lang ?? current.lang,
      updatedAt: Date.now(),
    } satisfies GamePageMetaRow);
  } catch (e) {
    console.warn('[KC-Monitor] 寫入遊戲頁偏好失敗', e);
  }
}

// 面板視窗單例化：已開著就聚焦既有視窗，不重複開新的。
// 作法是向面板 ping、由它回報自己的 windowId（面板側 listener 見 panel/main.ts）：
// tabs.query({url}) 依 url 過濾需要 tabs 權限（自家頁面亦然，無權限時一律匹配不到），
// 而本擴充刻意只保留 alarms+notifications，故不走該路。SW 隨時會死，不能靠記憶體變數。
async function openPanelWindow() {
  // 沒有面板在聽時 sendMessage 會 reject（無接收端），視同未開啟
  const winId = await browser.runtime.sendMessage({ type: 'kc:panel-ping' }).catch(() => null);
  if (typeof winId === 'number') {
    // 視窗剛好被關掉、id 已失效時 update 會 throw，落回開新視窗
    const focused = await browser.windows.update(winId, { focused: true }).then(() => true, () => false);
    if (focused) return;
  }
  await browser.windows.create({
    url: browser.runtime.getURL('/panel.html'),
    // width 420 為硬約束（使用者要求不准加寬）。
    // height 905→835：先前 800→850→915→905 一路都是純算式估計，從未量過實機。
    // 拿使用者提供的實機截圖（未保留於儲存庫，height=915 時只有 6 艘）
    // 逐像素量測：從視窗最頂（含 macOS 標題列）到最後一艘裝備列結束僅 775px，
    // 下方留白足足 140px；用 headless Chromium 載入真實 CSS＋7 艘樣板 render 交叉
    // 驗證，單艘列高確實是 49.5px（不是估計的 51.5px），tabpanel 固定高度也已生效
    // （後調為 270px 收資訊區底留白、編成上移以露出七船；165px 戰鬥列釘死不變）。
    // 775（6艘）+49.5（第7艘）+標題列已含在775內 ≈ 825，抓 835 留一點餘裕。
    // ⚠️ 此高度假設裝備列單行。若 .chips wrap 成兩行，單艘變高，第 7 艘會被裁掉——
    // 見 panel/index.html .chips／.chip 寬度預算註解，勿靠加高視窗掩蓋換行。
    type: 'popup', width: 420, height: 835,
  });
}

// 只有 ingestion persistence helper 成功取得 processing claim 才會呼叫本函式。
// 因此同一 captureId 的 done / processing duplicate 不會重複廣播、快照、裁剪或排程。
async function postProcessEvent(event: ApiEventRow & { id: number }): Promise<void> {
  const { id, ts, path, req } = event;
  const api = event.api as any;   // 合約保證為解析後的 api_data；此處為欄位存取放寬型別
  // 面板未開啟時沒有 runtime receiver 是正常情況，維持既有的 best-effort broadcast。
  browser.runtime.sendMessage({ type: 'kc:live', id, ts, path }).catch(() => { });

  // 母港快照：獨立於 M6 裁剪，撐過完全解除安裝再重裝（見 utils/db.ts SnapshotRow）。
  if (SNAPSHOT_PATHS.has(path)) await db.snapshot.put({ path, ts, api, req, eventId: id });
  // 資源時間序列＋活動特殊時間點。與 snapshot 同層（不需 GameState、面板沒開也要累積），
  // 全部 put/add-if-absent，故 recovery 重跑同一筆事件不會重複記錄（見 utils/resource-capture.ts）。
  await captureResources(db, { id, ts, path, api });
  // M6 事件裁剪：登入封包（start2）到達 = 遊戲即將重送全量狀態，更早的事件可安全清除
  if (path === 'api_start2/getData') await pruneEvents(id);
  // 超長單一 session（不重登）保險裁剪：不等 start2，events 數量過大就主動修剪一次。
  // 只在每 200 筆檢查一次，避免每筆都查 count() 的開銷。
  if (id % 200 === 0) await pruneIfOversized();
  if (path === 'api_port/port') {
    await scheduleAlarms(api, id);
    await captureShipObtained(db.shipObtained, id, ts, api);
  }
  // 遠征發出：提前 1 分鐘通知
  if (path === 'api_req_mission/start' && api?.api_complatetime) {
    await scheduleOrNotify(
      `第${req?.api_deck_id}艦隊 遠征帰投`,
      api.api_complatetime,
      createEventNotificationId(id, 'mission-start'),
    );
  }
  // 手動終止遠征（強制回港）：若新回港時間不足 1 分鐘則立即通知，並記錄 deck ID + completeAt
  // 防重複（記錄存 db.notified，SW 被殺重啟也不遺失，見 utils/db.ts NotifiedRow）
  if (path === 'api_req_mission/return_instruction' && api?.api_mission?.[2]) {
    const deckId = Number(req?.api_deck_id);
    const completeAt = api.api_mission[2];
    if (completeAt - EARLY_MS <= Date.now()) {
      await db.notified.put({ deckId, completeAt, ts: Date.now() });
    }
    await scheduleOrNotify(
      `第${deckId}艦隊 遠征帰投`,
      completeAt,
      createEventNotificationId(id, 'mission-return-instruction'),
    );
  }
  // 入渠開始：nyukyo/start 回應不含修理時間，須從艦船的 api_ndock_time 取得。
  // 高速修復（バケツ, api_highspeed=1）為即時完成，不需排程。
  if (path === 'api_req_nyukyo/start' && req?.api_highspeed !== '1') {
    const ndockMs = api?.api_ndock_time || await lookupNdockTime(Number(req?.api_ship_id));
    if (ndockMs > 0) {
      await browser.alarms.create(`入渠ドック${req?.api_ndock_id} 修理完了`, { when: Date.now() + ndockMs });
    }
  }
}

// ── M6 事件裁剪 ────────────────────────────────────────
// 原理：登入時遊戲重送全量狀態（start2=圖鑑、require_info=裝備庫、port=艦隊），
// 更早的事件重播後也會被這些覆蓋，刪除不影響面板重建結果（「基石＋近期」等同全量重播）。
// 裁剪點取「上上次 start2」而非本次：保留一個登入世代的緩衝，確保 db.sorties 的
// 出擊紀錄回填（由面板開啟時執行）在事件被刪前至少有一整個世代的機會完成。
// 保護名單：
//   1. db.wanted 引用的事件（待驗證封包的「複製 JSON」需要原始內容）
//   2. 會跨登入累積狀態的 path 各保留最近 N 筆（questlist 分頁式、quests Map 不隨 port 清空）
// 出擊紀錄已於面板消費時消化進 db.sorties（獨立表），不受裁剪影響。
async function pruneEvents(currentStart2Id: number) {
  try {
    // 找上一次 start2（本次之前最近的一筆）；不存在則資料量必然還小，跳過
    const prev = await db.events.where('path').equals('api_start2/getData')
      .and(e => e.id! < currentStart2Id).last();
    if (!prev?.id) return;
    const cutoff = prev.id;   // 刪除 cutoff 之前的事件（保留上一世代＋本世代）
    const result = await pruneRawEventsBefore(db, cutoff);
    if (result.removed > 0)
      console.log(`[KC-Monitor] 事件裁剪：刪除 ${result.removed} 筆（保留基石/待驗證＋近兩個登入世代）`);
  } catch (e) {
    console.error('[KC-Monitor] pruneEvents 失敗', e);
    throw e;
  }
}

// 超長單一 session（不重登，start2 裁剪永遠不觸發）的保險：events 超過門檻就強制
// 只留最近 SAFETY_KEEP_RAW 筆原始事件（含當前可能正在進行的出擊）＋基石＋待驗證引用。
const SAFETY_THRESHOLD = 5000;
const SAFETY_KEEP_RAW = 500;
async function pruneIfOversized() {
  try {
    const total = await db.events.count();
    if (total <= SAFETY_THRESHOLD) return;
    const cutoffRow = await db.events.orderBy('id').reverse().offset(SAFETY_KEEP_RAW).first();
    if (!cutoffRow?.id) return;
    const cutoff = cutoffRow.id;
    const result = await pruneRawEventsBefore(db, cutoff);
    if (result.removed > 0)
      console.log(`[KC-Monitor] 超長 session 保險裁剪：events 達 ${total} 筆，刪除 ${result.removed} 筆`);
  } catch (e) {
    console.error('[KC-Monitor] pruneIfOversized 失敗', e);
    throw e;
  }
}

// 從最近一次母港封包查該艦的修復所需毫秒數（nyukyo/start 回應本身不帶）
async function lookupNdockTime(shipId: number): Promise<number> {
  if (!shipId) return 0;
  const port: any = await db.events.where('path').equals('api_port/port').last();
  const ship = port?.api?.api_ship?.find((s: any) => s.api_id === shipId);
  return Number(ship?.api_ndock_time ?? 0);
}

async function scheduleAlarms(api: any, eventId: number) {
  // clearAll() 會連同「這筆 port 之前才剛建立、但這次 port 快照的 api_ndock 還沒同步反映
  // 該渠已在修理中」的入渠 alarm 一起清掉，且下面的重建迴圈因為讀到的 api_state 尚未更新
  // 而不會重新建立——先記下 clearAll 前仍在未來的入渠 alarm，快照沒涵蓋到就原樣續存。
  // 若渠真的被取消，這個殘留頂多在原訂時間誤發一次通知，Chrome 觸發後自動移除該 alarm，
  // 不會無限殘留；換來的是「不會靜默漏發」，兩者取捨後者更安全。
  const staleDockAlarms = (await browser.alarms.getAll())
    .filter(a => /^入渠ドック\d+ 修理完了$/.test(a.name) && a.scheduledTime > Date.now());

  await browser.alarms.clearAll();
  for (const [i, d] of (api.api_deck_port ?? []).entries()) {
    if (d.api_mission?.[0] > 0 && d.api_mission[2] > 0) {
      // 若此艦隊剛由 return_instruction 立即通知過同一個 completeAt，跳過避免重複
      const skip = await db.notified.get(i + 1);
      if (skip && skip.completeAt === d.api_mission[2]) {
        await db.notified.delete(i + 1);
        continue;
      }
      // key 用艦隊編號（穩定）而非 api_name（玩家可改，同名會互相覆蓋 alarm）——
      // 與 mission/start、return_instruction 兩處通知的既有慣例一致。
      await scheduleOrNotify(
        `第${i + 1}艦隊 遠征帰投`,
        d.api_mission[2],
        createEventNotificationId(eventId, `port-mission-${i + 1}`),
      );
    }
  }
  const recreatedDockNames = new Set<string>();
  for (const [i, n] of (api.api_ndock ?? []).entries()) {
    if (n.api_state > 0 && n.api_complete_time > 0) {
      const name = `入渠ドック${i + 1} 修理完了`;
      recreatedDockNames.add(name);
      await browser.alarms.create(name, { when: n.api_complete_time });
    }
  }
  for (const a of staleDockAlarms) {
    if (!recreatedDockNames.has(a.name)) await browser.alarms.create(a.name, { when: a.scheduledTime });
  }

  // 疲労（士気）回復通知：自然回復每 3 分鐘 +3、上限 49（回復點）。
  // 回復 tick 的相位未知（伺服器全域計時），取上界 ceil(缺口/3)×3 分鐘——
  // 通知響起時保證全隊已回復到 49，不會提早誤報。每次回母港以最新 cond 重排。
  const condById = new Map<number, number>(
    (api.api_ship ?? []).map((s: any) => [s.api_id, Number(s.api_cond ?? 49)]),
  );
  for (const d of api.api_deck_port ?? []) {
    const conds = (d.api_ship ?? [])
      .filter((id: number) => id > 0)
      .map((id: number) => condById.get(id) ?? 49);
    const minCond = Math.min(49, ...conds);
    if (minCond >= 49) continue;
    const mins = Math.ceil((49 - minCond) / 3) * 3;
    await browser.alarms.create(`${d.api_name} 疲労回復（cond ${minCond}→49）`, { when: Date.now() + mins * 60_000 });
  }
}
