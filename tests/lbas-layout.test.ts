import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 基地航空隊版面的硬約束（見 panel/index.html「基地航空隊」段）：一個海域最多三隊、
// 一隊最多四個中隊，**三隊必須在不捲動的前提下全部看得完**（區塊可用高度約 440px）。
// 原本逐列排法量到 626px；現行為「抬頭列（隊名＋制空＋半徑＋行動）＋中隊 2×2」，
// 最壞情況量到 329px。高度本身要用離線預覽量：
//   npx vite-node --config vitest.config.ts tools/preview/lbas-layout.ts
// 這裡鎖的是「別把它改回逐列排」與那條救命的 min-width。
const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const panelMain = readFileSync(new URL('../entrypoints/panel/main.ts', import.meta.url), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));

describe('基地航空隊版面', () => {
    it('中隊排成 2×2（renderAirBases 產出 .ab-sq-grid，CSS 給兩欄）', () => {
        expect(panelMain).toContain('ab-sq-grid');
        expect(css).toMatch(/\.ab-sq-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
    });

    it('隊名與制空/半徑併在同一列，不再各佔一列', () => {
        expect(panelMain).toContain('ab-head1');
        expect(panelMain).toContain('ab-inline-stats');
        // 舊的獨立制空列不得復活——那是每卡多 23px 的來源
        expect(panelMain).not.toContain('class="ab-stats"');
        expect(panelMain).not.toContain('class="ab-header"');
    });

    // grid item 預設 min-width:auto，會被最長的中隊名（「一式戦 隼III型甲(54戦隊)」等）
    // 撐破卡片右緣，機數與疲勞標記直接被切掉。拿掉這條就等於版面壞掉。
    it('.ab-sq 及其子元素保有 min-width: 0（否則長中隊名會撐破卡片）', () => {
        expect(css).toMatch(/\.ab-sq\s*\{[^}]*min-width:\s*0/);
        expect(css).toMatch(/\.ab-sq>\*\s*\{\s*min-width:\s*0/);
    });

    // 雙欄下 nth-child(odd) 會變成左右交錯的棋盤格，讀起來像壞掉
    it('斑馬紋以「上排一組」表示，不用 nth-child(odd)', () => {
        expect(css).toMatch(/\.ab-sq-grid \.ab-sq:nth-child\(-n\+2\)/);
        expect(css).not.toMatch(/\.ab-sq:nth-child\(odd\)/);
    });
});

describe('中隊疲勞標記', () => {
    // 表情用**內聯** SVG：走 <img src> 時 SVG 是獨立文件、吃不到面板 CSS，
    // 就沒辦法用 currentColor 沿用 .cond-tired／.cond-exhausted 的語意色。
    it('黃/紅兩段用內聯 SVG 表情，不是 <img>、不是 emoji 字元', () => {
        expect(panelMain).toMatch(/<svg class="cond-face"/);
        expect(panelMain).toContain('stroke="currentColor"');
        expect(panelMain).not.toMatch(/cond-face[^>]*<img/);
        expect(css).toMatch(/\.ab-sq \.cond-face\s*\{[^}]*width:\s*11px/);
    });

    // 只靠顏色分兩段，色覺障礙者與 11px 縮小後都分不出來
    it('黃臉與紅臉的造型不同（階序不只靠顏色）', () => {
        const tired = panelMain.slice(panelMain.indexOf("kind === 'tired'"));
        // 黃臉：兩顆圓眼＋平嘴；紅臉：閉眼斜線＋苦笑曲線
        expect(tired).toMatch(/circle cx="5\.6"/);
        expect(tired).toMatch(/q2\.7-2\.6 5\.4 0/);
    });

    // 文字被符號取代，但語意不能消失——title 仍掛既有的三語字典字串
    it('表情仍帶 title（i18n 說明與可及性）', () => {
        expect(panelMain).toMatch(/class="sq-cond face cond-\$\{kind\}\$\{unsure\}" title="\$\{title\}"/);
        expect(panelMain).toMatch(/const title = esc\(hint \? `\$\{label\}\\n\$\{hint\}` : label\)/);
    });

    // 未知狀態沒有對應表情，維持誠實顯示原始值（不猜、不硬套一張臉）
    it('未知狀態維持文字顯示', () => {
        expect(panelMain).toMatch(/return `<span class="sq-cond cond-\$\{kind\}" title="\$\{title\}">\$\{esc\(label\)\}<\/span>`/);
    });
});

describe('編成列的基地航空隊鈕', () => {
    it('依最嚴重的中隊疲勞段染色（黃 --lbas-tired／紅 --dmg-major）', () => {
        expect(panelMain).toContain('lbasCondSeverity');
        expect(css).toMatch(/#fleetnav button\.cond-tired\s*\{[^}]*color:\s*var\(--lbas-tired\)/);
        expect(css).toMatch(/#fleetnav button\.cond-tired\s*\{[^}]*border-color:\s*var\(--lbas-tired\)/);
        expect(css).toMatch(/#fleetnav button\.cond-exhausted\s*\{[^}]*color:\s*var\(--dmg-major\)/);
        expect(css).toMatch(/#fleetnav button\.cond-exhausted\s*\{[^}]*border-color:\s*var\(--dmg-major\)/);
    });

    // 值目前與 --dmg-mid 相同，但要維持成獨立變數：疲勞與艦娘中破是兩種語意，
    // 改其中一邊時不該連動另一邊（design-guidelines §4.5）
    it('--lbas-tired 是獨立變數而非指向 --dmg-mid', () => {
        expect(css).toMatch(/--lbas-tired:\s*#e08b3d/);
        expect(css).not.toMatch(/--lbas-tired:\s*var\(/);
    });

    // 分區內的黃臉與按鈕共用同一個色源，不得各自寫死
    it('分區內的黃臉也走 --lbas-tired', () => {
        expect(css).toMatch(/\.ab-sq \.sq-cond\.cond-tired\s*\{\s*color:\s*var\(--lbas-tired\)/);
    });

    // 同 specificity，後者勝：分區開著（.on）時仍要看得到疲勞
    it('疲勞規則排在 #fleetnav button.on 之後', () => {
        expect(css.indexOf('#fleetnav button.cond-tired')).toBeGreaterThan(css.indexOf('#fleetnav button.on'));
        expect(css.indexOf('#fleetnav button.cond-exhausted')).toBeGreaterThan(css.indexOf('#fleetnav button.on'));
    });

    // 疲勞（框線色）與未補給（.attn 外圈紅框）是兩套語意，不能互相取代
    it('疲勞不影響既有的未補給 .attn 紅框', () => {
        expect(css).toMatch(/#fleetnav button\.attn\s*\{\s*box-shadow/);
        expect(panelMain).toContain("lbasNeedsAttention() ? 'attn' : ''");
    });
});

// 「可能已回復」的淡化表現（實機回報 2026-08-04：遊戲已退掉黃臉、面板還畫實心臉）
describe('疲勞標記的把握程度表現', () => {
    it('存疑時加 unsure class，並仍保留標記本身', () => {
        expect(panelMain).toContain("certainty === 'possiblyRecovered' ? ' unsure' : ''");
        expect(css).toMatch(/\.ab-sq \.sq-cond\.face\.unsure\s*\{[^}]*opacity/);
    });

    // 「不能斷定」不等於「已回復」——淡化可以，直接不顯示是把仍疲勞的中隊謊報成正常
    it('unsure 只淡化，不得整個隱藏', () => {
        const rule = css.slice(css.indexOf('.ab-sq .sq-cond.face.unsure'));
        expect(rule.slice(0, 120)).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    });

    // 每秒的重繪簽章要含把握程度，否則 certain→unsure 的那一刻不會重畫
    it('tick 簽章包含把握程度', () => {
        expect(panelMain).toMatch(/lbasCondCertaintyNow\(sq\.cond, ab\)\?\.\[0\]/);
    });
});
