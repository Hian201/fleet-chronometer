// utils/html-escape.ts：HTML 跳脫與圖示 markup 的合約。
import { describe, expect, it } from 'vitest';
import {
    esc, gearIconHtml, idleLabelHtml, matIconHtml, questCategoryMarkHtml,
} from '../utils/html-escape';
import type { QuestCategory } from '../utils/quest-category';

const PAYLOAD = '"><img src=x onerror=1>';

describe('esc', () => {
    it('跳脫 & < > " \' 五個字元', () => {
        expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('先跳脫 & 再處理其他字元，不會重複跳脫', () => {
        expect(esc('<a>')).toBe('&lt;a&gt;');
        expect(esc('&lt;')).toBe('&amp;lt;');
    });

    it('一般文字與空字串原樣回傳', () => {
        expect(esc('鎮守府 abc 123')).toBe('鎮守府 abc 123');
        expect(esc('')).toBe('');
    });

    it('攻擊字串不留下原始標籤', () => {
        const out = esc(PAYLOAD);
        expect(out).not.toContain('<img');
        expect(out).not.toContain('"');
    });
});

describe('gearIconHtml', () => {
    it('icon > 0 輸出帶 root-relative 路徑的 img', () => {
        const html = gearIconHtml(12, '主砲');
        expect(html).toContain('src="/icons/equipment/12.svg"');
        expect(html).toContain('alt="主砲"');
        expect(html).toContain('class="g-icon"');
    });

    it('icon 為 0、負數、NaN 時退回跳脫後的文字，不產生 img', () => {
        expect(gearIconHtml(0, '<b>砲</b>')).toBe('&lt;b&gt;砲&lt;/b&gt;');
        expect(gearIconHtml(-3, 'x')).toBe('x');
        expect(gearIconHtml(Number.NaN, 'x')).toBe('x');
        expect(gearIconHtml(Number('abc'), '<i>')).not.toContain('<img');
    });

    it('未提供 short 時文字退路為空字串', () => {
        expect(gearIconHtml(0)).toBe('');
        expect(gearIconHtml(5)).toContain('alt=""');
    });

    it('alt 與退路文字都經過跳脫', () => {
        expect(gearIconHtml(7, PAYLOAD)).not.toContain('<img src=x');
        expect(gearIconHtml(0, PAYLOAD)).not.toContain('<img src=x');
    });
});

describe('matIconHtml', () => {
    it('輸出資源圖示路徑與 alt', () => {
        const html = matIconHtml('fuel', '燃料');
        expect(html).toBe('<img class="m-icon" src="/icons/resource/fuel.svg" alt="燃料">');
    });

    it('alt 經過跳脫', () => {
        const html = matIconHtml('ammo', PAYLOAD);
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('alt="&quot;&gt;&lt;img src=x onerror=1&gt;"');
    });
});

describe('questCategoryMarkHtml', () => {
    it('label 同時寫入 aria-label 與 title，且跳脫', () => {
        const html = questCategoryMarkHtml('daily' as QuestCategory, PAYLOAD);
        expect(html).not.toContain('<img src=x');
        expect(html.match(/&quot;&gt;&lt;img src=x onerror=1&gt;/g)).toHaveLength(2);
        expect(html).toContain('class="qc-mark qc-daily"');
        expect(html).toContain('role="img"');
    });
});

describe('idleLabelHtml', () => {
    it('tip 為 null 時只輸出名稱 span，沒有圓點', () => {
        expect(idleLabelHtml('標籤', null)).toBe('<span>標籤</span>');
    });

    it('tip 為空字串視同沒有提示', () => {
        expect(idleLabelHtml('標籤', '')).toBe('<span>標籤</span>');
    });

    it('有 tip 時加閒置圓點與提示，label 與 tip 都跳脫', () => {
        const html = idleLabelHtml(PAYLOAD, PAYLOAD);
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('class="idle-host"');
        expect(html).toContain('class="idle-mark"');
    });

    it('無 tip 時 label 也跳脫', () => {
        expect(idleLabelHtml(PAYLOAD, null)).not.toContain('<img src=x');
    });
});
