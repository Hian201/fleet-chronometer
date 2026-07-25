import { describe, expect, it } from 'vitest';
import {
    GAME_PAGE_MATCHES, GAME_TAB_MATCHES, GAME_URL,
    isGameFrameOrigin, isGamePageUrl, isGameTabUrl, matchesUrlPattern,
} from '../utils/game-page';

describe('match pattern 比對', () => {
    it('scheme 萬用字元只涵蓋 http/https', () => {
        expect(matchesUrlPattern('http://play.games.dmm.com/game/kancolle', '*://play.games.dmm.com/*')).toBe(true);
        expect(matchesUrlPattern('https://play.games.dmm.com/game/kancolle', '*://play.games.dmm.com/*')).toBe(true);
        expect(matchesUrlPattern('file:///play.games.dmm.com/game/kancolle', '*://play.games.dmm.com/*')).toBe(false);
        expect(matchesUrlPattern('chrome://extensions/', '*://*/*')).toBe(false);
    });

    it('host 的 *. 前綴涵蓋子網域與網域本身，但不涵蓋同尾綴的別的網域', () => {
        expect(matchesUrlPattern('https://dmm.com/x', '*://*.dmm.com/*')).toBe(true);
        expect(matchesUrlPattern('https://www.dmm.com/x', '*://*.dmm.com/*')).toBe(true);
        expect(matchesUrlPattern('https://evil-dmm.com/x', '*://*.dmm.com/*')).toBe(false);
        expect(matchesUrlPattern('https://dmm.com.example.net/x', '*://*.dmm.com/*')).toBe(false);
    });

    it('path 比對含 query string，且不做前綴寬鬆比對', () => {
        expect(matchesUrlPattern('https://play.games.dmm.com/game/kancolle?a=1', '*://play.games.dmm.com/game/kancolle*')).toBe(true);
        expect(matchesUrlPattern('https://play.games.dmm.com/game/kancolle', '*://play.games.dmm.com/game/kancolle*')).toBe(true);
        expect(matchesUrlPattern('https://play.games.dmm.com/game/other', '*://play.games.dmm.com/game/kancolle*')).toBe(false);
    });

    it('不合法的 URL 或 pattern 一律回 false，不丟例外', () => {
        expect(matchesUrlPattern('not a url', '*://play.games.dmm.com/*')).toBe(false);
        expect(matchesUrlPattern('https://play.games.dmm.com/', 'play.games.dmm.com')).toBe(false);
        expect(matchesUrlPattern('', '*://*/*')).toBe(false);
    });
});

describe('遊戲分頁判定', () => {
    it('注入範圍涵蓋新舊入口', () => {
        expect(isGamePageUrl(GAME_URL)).toBe(true);
        expect(isGamePageUrl('https://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/')).toBe(true);
        expect(isGamePageUrl('https://www.google.com/')).toBe(false);
        expect(isGamePageUrl(undefined)).toBe(false);
    });

    it('單例判定比注入範圍窄：DMM 上的其他遊戲不算艦これ分頁', () => {
        // 這正是用 GAME_PAGE_MATCHES 做單例會踩到的坑——會聚焦到別款遊戲的分頁。
        const otherGame = 'https://play.games.dmm.com/game/some-other-game';
        expect(isGamePageUrl(otherGame)).toBe(true);
        expect(isGameTabUrl(otherGame)).toBe(false);
        expect(isGameTabUrl(GAME_URL)).toBe(true);
        expect(isGameTabUrl('https://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/')).toBe(true);
    });

    // 劇場模式把 Alt+滾輪／Esc 的轉發訊息當成互動指令，RELAY_MARK 只是辨識碼不是憑證；
    // DMM 頁面上的第三方框（廣告／追蹤）同樣送得出來，故一律驗 e.origin。
    it('只有遊戲伺服器來源算合法轉發來源', () => {
        expect(isGameFrameOrigin('http://w01.kancolle-server.com')).toBe(true);
        expect(isGameFrameOrigin('https://kancolle-server.com')).toBe(true);
        expect(isGameFrameOrigin('https://evil-kancolle-server.com')).toBe(false);
        expect(isGameFrameOrigin('https://kancolle-server.com.attacker.example')).toBe(false);
        expect(isGameFrameOrigin('https://play.games.dmm.com')).toBe(false);
        expect(isGameFrameOrigin('null')).toBe(false);
        expect(isGameFrameOrigin('')).toBe(false);
    });

    it('單例比對範圍是注入範圍的子集（不會去聚焦一個注入不到的分頁）', () => {
        for (const url of [GAME_URL, 'https://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/']) {
            expect(isGameTabUrl(url) && isGamePageUrl(url)).toBe(true);
        }
        expect(GAME_TAB_MATCHES.length).toBeGreaterThan(0);
        expect(GAME_PAGE_MATCHES.length).toBeGreaterThan(0);
    });
});
