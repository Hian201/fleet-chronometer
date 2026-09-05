// 離線 viewer.html：無擴充 CSP，載入的 JSON 不可信——esc／rank class 必須擋住屬性跳出。
import { describe, expect, it } from 'vitest';
import {
    viewerEsc, viewerHtml, viewerRankCellHtml, viewerRankClass,
} from '../entrypoints/overview/viewer-html';

describe('viewerEsc', () => {
    it('跳脫文字與屬性語境字元', () => {
        expect(viewerEsc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
    });
});

describe('viewerRankClass', () => {
    it('只放行 S/A/B/C/D（大小寫不拘）', () => {
        expect(viewerRankClass('S')).toBe('S');
        expect(viewerRankClass('a')).toBe('A');
        expect(viewerRankClass('  b ')).toBe('B');
        expect(viewerRankClass('SS')).toBe('');
        expect(viewerRankClass('')).toBe('');
        expect(viewerRankClass(null)).toBe('');
    });
    it('惡意字串不進 class', () => {
        expect(viewerRankClass('" autofocus onfocus="alert(1)')).toBe('');
        expect(viewerRankClass('S"><img src=x onerror=alert(1)>')).toBe('');
    });
});

describe('viewerRankCellHtml', () => {
    it('合法 rank：class 與文字分開、文字仍跳脫', () => {
        expect(viewerRankCellHtml('S')).toBe('<td class="rank S">S</td>');
        expect(viewerRankCellHtml('')).toBe('<td class="rank">—</td>');
    });
    it('惡意 rank 不得產出可執行 HTML', () => {
        const evil = '" autofocus onfocus="alert(1)';
        const html = viewerRankCellHtml(evil);
        // class 空白名單；引號跳脫後無法跳出 class／注入屬性
        expect(html).toBe(`<td class="rank">${viewerEsc(evil)}</td>`);
        expect(html).toMatch(/^<td class="rank">/);
        expect(html).not.toMatch(/class="rank [^"]*"/); // 不得附加惡意 class token
        expect(html.indexOf('&quot;')).toBeGreaterThan(-1);
        expect(html.indexOf('" autofocus')).toBe(-1); // 未跳脫的屬性跳出片段
    });
    it('含標籤字元的 rank 只出現跳脫後的文字', () => {
        const evil = 'A"><img src=x onerror=alert(1)>';
        const html = viewerRankCellHtml(evil);
        expect(html).toBe(`<td class="rank">${viewerEsc(evil)}</td>`);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
        expect(html).toContain('&quot;');
        expect(html).toContain('&gt;');
    });
});

describe('viewerHtml 內嵌腳本與 helper 對齊', () => {
    it('內嵌 esc 含屬性跳脫；內嵌 rankClass 含白名單', () => {
        const src = viewerHtml();
        expect(src).toContain('&quot;');
        expect(src).toContain('&#39;');
        expect(src).toContain('function rankClass(rank)');
        expect(src).toContain('r === "S" || r === "A" || r === "B" || r === "C" || r === "D"');
        // class 組字：白名單字母才附加，避免 esc(rank) 直接進 class
        expect(src).toContain('\'<td class="rank\' + (rc ? (\' \' + rc) : \'\') + \'">\'');
        expect(src).not.toContain('class="rank \' + esc(rank)');
    });

    it('預設說明完整備份，仍用 tables.replays 相容舊重播檔', () => {
        const src = viewerHtml();
        expect(src).toContain('kanmusu-backup-YYYY-MM-DD-HHmmss.json');
        expect(src).toContain('kanmusu-backup.json');
        expect(src).toContain('kanmusu-replays.json');
        expect(src).toContain('env.tables && env.tables.replays');
    });

    it('內聯輸出以空物件表示無夜戰，短資料直接播放、長資料保留複製 fallback', () => {
        const src = viewerHtml();
        expect(src).toContain('yasen: b.yasen || {}');
        expect(src).toContain('lv: s.lv, level: s.lv');
        expect(src).toContain('sourceFleetnum: row.fleetnum');
        expect(src).toContain('time: Math.floor(row.ts / 1000)');
        expect(src).toContain('var url = BATTLEPLAYER + "#fromLZString=" + compressToEncodedURIComponent(JSON.stringify(obj))');
        expect(src).toContain('function compressToEncodedURIComponent(input)');
        expect(src).toContain('window.open(url, "_blank", "noopener")');
        expect(src).toContain('url.length < 30000');
        expect(src).toContain('window.open(BATTLEPLAYER, "_blank", "noopener")');
        expect(src).toContain('navigator.clipboard.writeText(JSON.stringify(obj))');
    });
});
