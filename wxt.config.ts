import { defineConfig } from 'wxt';
import { GAME_PAGE_MATCHES } from './utils/game-page';

// See https://wxt.dev/api/config.html
export default defineConfig({
    // 開發模式：擴充頁（chrome-extension://）會向 Vite 拉 @vite/client；Vite 預設
    // CORS 不放行該 origin。server.cors 反射 Origin 當雙重保險（主解仍靠下方
    // host_permissions 保留 localhost）。
    vite: () => ({
        server: {
            // 反射任意 Origin（含 chrome-extension://）；正式建置不走此路徑。
            cors: true,
        },
        build: {
            // 不產 `<link rel="modulepreload">`。Vite 一律替預載標籤加上 `crossorigin`，
            // 但擴充頁載入自家 chrome-extension:// 資源時的 fetch 模式對不上，Chrome 會在
            // 每個頁面吐一則「A preload ... is not used because it is a cross-world
            // extension resource mismatch」並白抓一次檔案。擴充頁的 chunk 都是本機檔案、
            // 零網路延遲，預載本來就沒有價值——關掉即可，模組仍由 <script type="module"> 載入。
            modulePreload: false,
        },
    }),
    manifest: {
        default_locale: 'en',
        name: '__MSG_extName__',
        short_name: '__MSG_extShortName__',
        description: '__MSG_extDescription__',
        version: '1.1.0.3',
        action: {
            default_title: '__MSG_extShortName__',
        },
        icons: {
            '16': 'icon/16.png',
            '32': 'icon/32.png',
            '48': 'icon/48.png',
            '96': 'icon/96.png',
            '128': 'icon/128.png',
        },
        // scripting：劇場模式的 content script 走動態註冊（見下方 hook）。這個權限**不會**
        // 對使用者顯示任何警告，也不授予任何網站存取權——真正的存取權在
        // optional_host_permissions，使用者按下「劇場模式」時才跳一次原生授權視窗。
        // 遊戲 BGM 與操作語音不在同一條可攔截音訊路徑；使用者確認後，靜音改以整個遊戲
        // 分頁為範圍，才能可靠涵蓋 BGM。tabs 只用於 `tabs.update({ muted })`，不讀取分頁內容。
        // activeTab：「拍照」用 `tabs.captureVisibleTab()`——查證 Chrome 官方文件後確認
        // 該 API **只認 `<all_urls>` 或 `activeTab` 兩者之一**，我們已授權的
        // optional_host_permissions（dmm.com，用於注入劇場模式 content script）並不滿足它，
        // 這正是第一版拍照「已授權仍失敗」的根因。`<all_urls>` 違反權限精簡（設計原則5），
        // 改用 activeTab：不顯示任何警告、不進 host_permissions，且只在使用者實際「呼叫
        // 擴充」（點圖示開 popup／快捷鍵／右鍵選單）當下，對「那個分頁」暫時授予，分頁換頁
        // 或關閉即失效——與拍照「按下當下要看到的畫面」的使用情境完全吻合。
        permissions: ['activeTab', 'alarms', 'notifications', 'scripting', 'tabs'],
        optional_host_permissions: [...GAME_PAGE_MATCHES],
    },
    hooks: {
        // WXT 對 `registration: 'runtime'` 的 content script 會**自動把 matches 塞進
        // `host_permissions`**（見 wxt/dist/types.d.mts 的 registration 說明）。那等於安裝時
        // 就要求 dmm.com 權限，正是本專案「權限精簡」硬約束要避免的事（CLAUDE.md 設計原則 5）。
        // 故剝掉網站權限；存取權改由上方的 optional_host_permissions 於執行期索取。
        //
        // **開發模式例外**：WXT serve 會把 Vite origin（localhost:3000）寫進
        // host_permissions，Chrome 靠它才能讓擴充頁跨源載入 @vite/client（否則 CORS
        // 擋下、面板／popup 一片空白）。正式 build 不需要——腳本已打包進擴充。
        // `tests/manifest.test.ts` 斷言的是正式產物 host_permissions 為空。
        'build:manifestGenerated'(wxt, manifest) {
            const m = manifest as { host_permissions?: string[] };
            if (wxt.config.command === 'serve') {
                // WXT 會寫入無 port 的 localhost pattern（等同涵蓋 :3000）；
                // 這裡固定覆寫，避免 theater matches 或剝除邏輯誤傷。
                m.host_permissions = [
                    'http://localhost/*',
                    'http://127.0.0.1/*',
                ];
            } else {
                delete m.host_permissions;
            }
        },
    },
});
