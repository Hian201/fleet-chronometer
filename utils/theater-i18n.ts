// 劇場模式工具列（跑在 dmm.com 的 content script，見 entrypoints/theater.content.ts）用到的
// 三語文案。獨立成小表是因為遊戲頁解析的腳本不該帶整份介面字串表（ui-i18n.ts）；
// ui-i18n.ts 的 t()／tFor() 查完自己的字典再查本表，popup 與擴充頁照常用 t()，文案只有這一個來源。
// 新增給 content script 用的鍵放這裡，只給擴充頁用的鍵放 ui-i18n.ts。
import type { Lang } from './gamedata-i18n';

export const THEATER_STRINGS: Record<Lang, Record<string, string>> = {
    'zh-TW': {
        'theater.enter': '適應',
        'theater.exit': '離開視窗適應',
        'theater.mute': '靜音',
        'theater.unmute': '解除靜音',
        'theater.screenshot': '拍照（只擷取遊戲畫面）',
        'theater.popIn': '回到原視窗',
        'theater.hint': '拉動瀏覽器邊框可調整大小・Esc 離開',
        'theater.popoutHint': '✕ 或 Esc 回到原視窗・直接關閉此視窗會關掉遊戲',
        'theater.muteNoTab': '尚未連線到遊戲分頁：擴充更新後請在遊戲分頁按 F5 重新整理',
        'theater.notFound': '找不到遊戲畫面：請先在這個分頁登入並開啟遊戲',
        'theater.popInFailed': '無法回到原視窗',
        'theater.popoutFailed': '無法移到獨立視窗',
        'screenshot.done': '已下載遊戲畫面截圖',
        'screenshot.failed': '拍照失敗，請稍後再試',
        // 「沒收到回覆」不等於「找不到遊戲畫面」，兩者的下一步完全不同（見 utils/runtime-reply.ts）
        'screenshot.noReply': '拍照沒有收到回覆：請在遊戲分頁按 F5 重新整理後再試一次',
    },
    ja: {
        'theater.enter': '適応',
        'theater.exit': 'ウィンドウ適応を終了',
        'theater.mute': 'ミュート',
        'theater.unmute': 'ミュート解除',
        'theater.screenshot': 'スクリーンショット（ゲーム画面のみ）',
        'theater.popIn': '元のウィンドウに戻す',
        'theater.hint': 'ウィンドウ枠をドラッグしてサイズ調整・Esc で終了',
        'theater.popoutHint': '✕ または Esc で元のウィンドウへ・このウィンドウを閉じるとゲームも閉じます',
        'theater.muteNoTab': 'ゲームタブに未接続：拡張機能の更新後はゲームタブを F5 で再読み込みしてください',
        'theater.notFound': 'ゲーム画面が見つかりません：このタブでログインしてゲームを開いてください',
        'theater.popInFailed': '元のウィンドウに戻せませんでした',
        'theater.popoutFailed': '独立ウィンドウに移せませんでした',
        'screenshot.done': 'ゲーム画面のスクリーンショットを保存しました',
        'screenshot.failed': '撮影に失敗しました。しばらくしてから再試行してください',
        'screenshot.noReply': '撮影の応答がありません：ゲームタブを F5 で再読み込みしてから再試行してください',
    },
    en: {
        'theater.enter': 'Fit',
        'theater.exit': 'Exit Fit to Window',
        'theater.mute': 'Mute',
        'theater.unmute': 'Unmute',
        'theater.screenshot': 'Screenshot (game screen only)',
        'theater.popIn': 'Return to original window',
        'theater.hint': 'Drag the browser window edge to resize · Esc to exit',
        'theater.popoutHint': '✕ or Esc returns to the original window · closing this window closes the game',
        'theater.muteNoTab': 'No game tab connected — press F5 on the game tab after updating the extension',
        'theater.notFound': 'No game frame found — log in and open the game in this tab first',
        'theater.popInFailed': 'Could not return to the original window',
        'theater.popoutFailed': 'Could not move the game to a pop-out window',
        'screenshot.done': 'Game screenshot downloaded',
        'screenshot.failed': 'Screenshot failed, please try again',
        'screenshot.noReply': 'No response for the screenshot — press F5 on the game tab and try again',
    },
};

/** 取劇場文案；缺譯退回日文、再缺回傳鍵本身（與 ui-i18n.ts 的 t() 同規則）。 */
export function tTheater(lang: Lang, key: string): string {
    return THEATER_STRINGS[lang][key] ?? THEATER_STRINGS.ja[key] ?? key;
}
