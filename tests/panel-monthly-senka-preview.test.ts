import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it } from 'vitest';
import { sections } from '../entrypoints/overview/sections';
import { renderSenkaSectionBodyHtml } from '../entrypoints/overview/sections/senka';
import { senkaHeaderButtonHtml, senkaTrayInnerHtml } from '../entrypoints/panel/senka-tray';
import {
    readSenkaExample, writeMonthlySenkaPreview, writeOverviewSenkaPreview,
} from '../tools/preview/panel-monthly-senka';
import type { Lang } from '../utils/gamedata-i18n';
import { senkaMonthWindow, type ExpReading } from '../utils/senka';
import { buildRegularSenkaSummary, formatSenkaRank } from '../utils/senka-view';
import { LANGS, setLang, tFor } from '../utils/ui-i18n';

const REPO_ROOT = resolve(__dirname, '..');
const NOW_AT = Date.UTC(2026, 10, 30, 9, 0);

const keys = ['inherit', 'normal', 'eo', 'quest', 'today', 'published', 'border'];
const block = (value: unknown) => '<!-- senka-preview -->\n```json\n' + JSON.stringify(value) + '\n```';
const valid = { inherit: 310, normal: 2450, eo: 1200, quest: 300, today: 96, published: 4180, border: 4200 };

function createPreviewTempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fc-senka-preview-'));
    mkdirSync(join(dir, '.preview'), { recursive: true });
    mkdirSync(join(dir, 'docs'), { recursive: true });
    mkdirSync(join(dir, 'entrypoints', 'overview'), { recursive: true });
    copyFileSync(resolve(REPO_ROOT, 'docs/panel-monthly-senka-plan.md'), join(dir, 'docs/panel-monthly-senka-plan.md'));
    copyFileSync(resolve(REPO_ROOT, 'entrypoints/overview/index.html'), join(dir, 'entrypoints/overview/index.html'));
    return dir;
}

function buildExpectedSummaries() {
    const sample = readSenkaExample(readFileSync(resolve(REPO_ROOT, 'docs/panel-monthly-senka-plan.md'), 'utf8'));
    const win = senkaMonthWindow({ year: 2026, month: 11 });
    const baseExp = 1_000_000;
    const beforeTodayDelta = Math.round(((sample.normal - sample.today) * 10_000) / 7);
    const totalDelta = Math.round((sample.normal * 10_000) / 7);
    const gain = sample.inherit + sample.normal + sample.eo + sample.quest - sample.published;
    const observedExp = Math.round((gain * 10_000) / 7);
    const regularReadings: ExpReading[] = [
        { ts: win.start - 10_000, exp: baseExp },
        { ts: win.start + 60_000, exp: baseExp },
        { ts: NOW_AT - 20 * 3_600_000, exp: baseExp + beforeTodayDelta },
        { ts: NOW_AT - 60_000, exp: baseExp + totalDelta },
    ];
    const noStartReadings: ExpReading[] = [
        { ts: win.start + 60_000, exp: baseExp },
        { ts: NOW_AT - 60_000, exp: baseExp + observedExp },
    ];
    return {
        regularSummary: buildRegularSenkaSummary(regularReadings, NOW_AT),
        noStartSummary: buildRegularSenkaSummary(noStartReadings, NOW_AT),
    };
}

function collectVisibleAndAccessibleText(html: string): string {
    const { document } = parseHTML(html);
    for (const el of document.querySelectorAll('style, script')) el.remove();
    const parts: string[] = [document.body?.textContent ?? '', document.title ?? ''];
    for (const el of document.querySelectorAll('[title], [aria-label], [alt], [placeholder]')) {
        for (const attr of ['title', 'aria-label', 'alt', 'placeholder']) {
            const val = el.getAttribute(attr);
            if (val) parts.push(val);
        }
    }
    return parts.join('\n');
}

afterEach(() => setLang('zh-TW'));

describe('戰果預覽與提案共用試排數值', () => {
    it('讀取提案中標記的範例', () => {
        const text = readFileSync(new URL('../docs/panel-monthly-senka-plan.md', import.meta.url), 'utf8');
        expect(readSenkaExample(text)).toEqual(Object.fromEntries(keys.map(key => [key, expect.any(Number)])));
    });

    it('讀出七個欄位', () => {
        expect(readSenkaExample(block(valid))).toEqual(valid);
    });

    it('缺少標記、缺欄或無效數值時停止產生，允許已確認的零', () => {
        expect(() => readSenkaExample('')).toThrow('提案缺少月底試排數值');
        for (const key of keys) {
            const { [key as keyof typeof valid]: _omit, ...rest } = valid;
            expect(() => readSenkaExample(block(rest))).toThrow(key);
            expect(() => readSenkaExample(block({ ...valid, [key]: -1 }))).toThrow(key);
            expect(() => readSenkaExample(block({ ...valid, [key]: 1.5 }))).toThrow(key);
            expect(() => readSenkaExample(block({ ...valid, [key]: null }))).toThrow(key);
        }
        expect(readSenkaExample(block({ ...valid, today: 0, quest: 0 })).today).toBe(0);
    });
});

describe('離線戰果預覽使用正式函式與正式 markup（三語）', () => {
    const panelSource = readFileSync(resolve(REPO_ROOT, 'entrypoints/panel/index.html'), 'utf8');
    const panelCss = panelSource.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    const sortieStub = '<div class="s-eside"></div><div class="s-action-rail"><div class="s-system-rail"></div></div><div class="taiha-head"></div><div class="taiha-hint"></div>';
    const sideStub = '<div class="s-side-stub"></div>';
    const fleetStub = '<section class="fleet"></section>';
    const { regularSummary, noStartSummary } = buildExpectedSummaries();

    it('產生器原始碼已移除與 ui-i18n 重複的 copy／overviewCopy 定義', () => {
        const src = readFileSync(resolve(REPO_ROOT, 'tools/preview/panel-monthly-senka.ts'), 'utf8');
        expect(src).not.toMatch(/\boverviewCopy\b/);
        expect(src).not.toMatch(/\b(trayTitle|shortRegular|regularOnly|reconCols|eoQuestTitle|pinSection)\s*:/);
    });

    for (const { code } of LANGS) {
        it(`${code}：面板與情報總括預覽符合正式函式輸出、無鍵名外露且無資料來源字樣`, () => {
            // 故意將全域語言設為另一語系，確認預覽產生器嚴格依傳入的 lang 渲染。
            setLang(code === 'ja' ? 'en' : 'ja');
            const tmpRoot = createPreviewTempRoot();
            try {
                writeMonthlySenkaPreview(tmpRoot, code as Lang, panelCss, sortieStub, sideStub, fleetStub);
                writeOverviewSenkaPreview(tmpRoot, code as Lang);

                const panelOut = readFileSync(join(tmpRoot, `.preview/panel-monthly-senka-${code}.html`), 'utf8');
                const overviewOut = readFileSync(join(tmpRoot, `.preview/overview-monthly-senka-${code}.html`), 'utf8');

                // ── 面板預覽檢查 ──
                const panelDoc = parseHTML(panelOut).document;
                const panelIds = [...panelDoc.querySelectorAll('[id]')].map(e => e.id);
                expect(new Set(panelIds).size).toBe(panelIds.length);

                const regularBtnDoc = parseHTML(senkaHeaderButtonHtml(regularSummary, false, code)).document;
                const noStartBtnDoc = parseHTML(senkaHeaderButtonHtml(noStartSummary, false, code)).document;
                expect(panelOut).toContain(regularBtnDoc.querySelector('.lbl')!.textContent!);
                expect(panelOut).toContain(noStartBtnDoc.querySelector('.lbl')!.textContent!);
                expect(panelOut).toContain(tFor(code, 'senka.short'));
                expect(panelOut).toContain(tFor(code, 'senka.full'));

                const expectedRegularTrayDoc = parseHTML(senkaTrayInnerHtml(regularSummary, code)).document;
                const expectedNoStartTrayDoc = parseHTML(senkaTrayInnerHtml(noStartSummary, code)).document;
                expect(panelDoc.querySelector('#senka-title')!.textContent).toBe(tFor(code, 'senka.trayTitle'));
                expect(panelDoc.querySelector('#senka-close')!.getAttribute('aria-label')).toBe(tFor(code, 'senka.close'));

                const case2 = panelDoc.querySelector('[data-case="2"]')!;
                const case3 = panelDoc.querySelector('[data-case="3"]')!;
                expect(case2.querySelector('.sn-body')!.innerHTML).toBe(expectedRegularTrayDoc.querySelector('.sn-body')!.innerHTML);
                expect(case2.querySelector('.sn-foot')!.innerHTML).toBe(expectedRegularTrayDoc.querySelector('.sn-foot')!.innerHTML);
                expect(case3.querySelector('.sn-body')!.innerHTML).toBe(expectedNoStartTrayDoc.querySelector('.sn-body')!.innerHTML);
                expect(case3.querySelector('.sn-foot')!.innerHTML).toBe(expectedNoStartTrayDoc.querySelector('.sn-foot')!.innerHTML);
                expect(case2.textContent).toContain(tFor(code, 'senka.regularOnly'));
                expect(case3.textContent).toContain(tFor(code, 'senka.noStart'));

                if (code === 'en') {
                    expect(panelDoc.querySelector('#senka-tray .ph-target')!.textContent).toContain('November');
                    expect(panelDoc.querySelector('#senka-tray .ph-target')!.textContent).not.toContain('November operation');
                    expect(panelOut).toContain('"Reg. pts"');
                    expect(panelOut).toContain('"Pts"');
                    expect(panelOut).not.toContain('November operation');
                }
                if (code === 'zh-TW') {
                    expect(panelOut).toContain('"普通戰果"');
                    expect(panelOut).toContain('"戰果"');
                }

                // ── 情報總括預覽檢查 ──
                const ovDoc = parseHTML(overviewOut).document;
                const ovIds = [...ovDoc.querySelectorAll('[id]')].map(e => e.id);
                expect(new Set(ovIds).size).toBe(ovIds.length);
                expect(ovDoc.querySelectorAll('#sk-month')).toHaveLength(1);

                const stage0Wrap = ovDoc.querySelector('.sk-cols > [data-only="0"]')!;
                expect(stage0Wrap.innerHTML).toBe(renderSenkaSectionBodyHtml(regularSummary, code));
                expect(ovDoc.querySelector('#sk-month h3')!.textContent).toBe(tFor(code, 'senka.month11'));

                const navItems = [...ovDoc.querySelectorAll('#nav a')];
                expect(navItems.map(a => a.textContent)).toEqual(sections.map(s => tFor(code, s.titleKey)));
                const resIdx = sections.findIndex(s => s.titleKey === 'ov.resourceLog');
                const senkaIdx = sections.findIndex(s => s.titleKey === 'ov.senka');
                expect(resIdx).toBeGreaterThanOrEqual(0);
                expect(senkaIdx).toBeGreaterThan(resIdx);
                expect(navItems.filter(a => a.classList.contains('active')).map(a => a.textContent))
                    .toEqual([tFor(code, 'ov.senka')]);
                expect(overviewOut).toContain(formatSenkaRank(500, code));
                // 確認未把整份 ui-i18n 字典 bundle 進預覽 HTML
                expect(overviewOut.length).toBeLessThan(400_000);

                // ── 雙預覽跨語共同規範檢查（不含未替換鍵名／佔位符／資料來源字樣）──
                for (const html of [panelOut, overviewOut]) {
                    const withoutStyle = html.replace(/<style>[\s\S]*?<\/style>/g, '');
                    expect(withoutStyle).not.toMatch(/\b(?:senka|ov)\.[A-Za-z0-9_]+/);
                    expect(withoutStyle).not.toMatch(/wiki|KC3|\bpoi\b/i);

                    const withoutStyleScript = withoutStyle.replace(/<script>[\s\S]*?<\/script>/g, '');
                    expect(withoutStyleScript).not.toMatch(/\{[a-zA-Z0-9_]+\}/);

                    const visible = collectVisibleAndAccessibleText(html);
                    expect(visible).not.toMatch(/wiki|KC3|kc3|\bpoi\b|社群|community/i);
                }
            } finally {
                rmSync(tmpRoot, { recursive: true, force: true });
            }
        });
    }
});
