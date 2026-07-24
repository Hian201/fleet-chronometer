import { defineConfig } from 'wxt';
import { GAME_PAGE_MATCHES } from './utils/game-page';

// See https://wxt.dev/api/config.html
export default defineConfig({
    manifest: {
        default_locale: 'en',
        name: '__MSG_extName__',
        short_name: '__MSG_extShortName__',
        description: '__MSG_extDescription__',
        version: '1.0.0',
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
        // 故在這裡剝掉；存取權改由上方的 optional_host_permissions 於執行期索取。
        // `tests/manifest.test.ts` 常駐斷言 host_permissions 為空，改壞了會立刻亮紅燈。
        'build:manifestGenerated'(_wxt, manifest) {
            delete (manifest as { host_permissions?: string[] }).host_permissions;
        },
    },
});
