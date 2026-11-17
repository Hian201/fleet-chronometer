// 支援語系清單與瀏覽器語言偵測。只依賴型別，讓遊戲頁的劇場模式 content script
// 不必為了這兩樣東西載入整份介面字串表（ui-i18n.ts）或 ui-prefs.ts。
import type { Lang } from './gamedata-i18n';

// 支援語系的單一真相來源。label 用各語言的自稱（下拉選單直接顯示）。
// 新增語系只要：(1) 在 gamedata-i18n.ts 的 Lang union 加碼、(2) 在 ui-i18n.ts 的 STRINGS
// 補一本字典（Record<Lang,…> 會逼你補，漏不了）、(3) 這裡加一列。選單生成與 localStorage
// 驗證都從此表推導，不會再有「加了語系卻忘了更新某個字面值列舉」的漏洞。
export const LANGS: { code: Lang; label: string }[] = [
    { code: 'zh-TW', label: '台灣華語' },
    { code: 'ja', label: '日本語' },
    { code: 'en', label: 'English' },
];

// 瀏覽器語言 → 支援語系。**遊戲頁的劇場模式 content script 也用這支**：它跑在 dmm.com，
// 讀不到擴充頁面的 localStorage（不同 origin），只能靠這個偵測或 background 的鏡像。
export function detectBrowserLang(): Lang {
    const n = navigator.language.toLowerCase();
    if (n.startsWith('ja')) return 'ja';
    if (n.startsWith('zh')) return 'zh-TW';
    return 'en';
}

// 把來路不明的語言碼（localStorage、background 鏡像、訊息欄位）收斂成支援語系；
// 認不出時回 null，由呼叫端決定要偵測瀏覽器語言還是維持現狀。
export function pickLang(value: unknown): Lang | null {
    return LANGS.find(l => l.code === value)?.code ?? null;
}
