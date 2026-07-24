import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getLang, setLang, t } from '../utils/ui-i18n';
import { GAME_PAGE_MATCHES, THEATER_SCRIPT_FILE } from '../utils/game-page';
import type { Lang } from '../utils/gamedata-i18n';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = new URL('../.output/chrome-mv3/manifest.json', import.meta.url);
const outputRoot = fileURLToPath(new URL('../.output/chrome-mv3/', import.meta.url));
const product = {
    packageName: 'fleet-chronometer',
    version: '1.0.0',
    description: 'Passive KanColle monitor for fleets, expeditions, battles, history, replays, and local backups.',
};

// 產品識別走 `_locales`：manifest 只放 `__MSG_*` 佔位，實際品牌名由各語言的 messages.json
// 決定（en「Fleet Chronometer」／ja「クロノメーター」／zh_TW「航海鐘」）。故這裡驗的是
// **i18n 接線完整**，不是某個固定字面值——寫死英文名等於把三語品牌鎖回單一語言。
const MSG = {
    name: '__MSG_extName__',
    shortName: '__MSG_extShortName__',
    description: '__MSG_extDescription__',
} as const;
const DEFAULT_LOCALE = 'en';
// locale 目錄名（Chrome 慣例，底線）↔ UI i18n 的語言代碼（BCP-47，連字號）
const LOCALES: [locale: string, lang: Lang][] = [['en', 'en'], ['ja', 'ja'], ['zh_TW', 'zh-TW']];

interface LocaleMessages {
    extName?: { message?: string };
    extShortName?: { message?: string };
    extDescription?: { message?: string };
}

const readLocale = (locale: string): LocaleMessages =>
    JSON.parse(readFileSync(join(outputRoot, '_locales', locale, 'messages.json'), 'utf8'));

interface ContentScript {
    all_frames?: boolean;
    js?: string[];
    matches?: string[];
    run_at?: string;
    world?: string;
}

interface Manifest {
    manifest_version: number;
    name: string;
    short_name?: string;
    default_locale?: string;
    version: string;
    description: string;
    action?: { default_popup?: string; default_title?: string };
    content_scripts: ContentScript[];
    icons?: Record<string, string>;
    permissions?: string[];
    host_permissions?: string[];
    optional_permissions?: string[];
    optional_host_permissions?: string[];
}

function pngDimensions(path: string): [number, number] {
    const png = readFileSync(path);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function outputFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? outputFiles(path) : [path];
    });
}

describe('正式版 manifest', () => {
    beforeAll(() => {
        execFileSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'pipe' });
    });

    it('使用 v1 產品識別，並保留 content script 載入邊界與安全 permissions', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
        const bridge = manifest.content_scripts.find(script => script.js?.some(file => file.endsWith('/bridge.js')));
        const interceptor = manifest.content_scripts.find(script => script.js?.some(file => file.endsWith('/interceptor.js')));

        expect(manifest.manifest_version).toBe(3);
        expect(manifest.name).toBe(MSG.name);
        expect(manifest.short_name).toBe(MSG.shortName);
        expect(manifest.description).toBe(MSG.description);
        expect(manifest.default_locale).toBe(DEFAULT_LOCALE);
        expect(manifest.version).toBe(product.version);
        expect(manifest.action).toMatchObject({
            default_title: MSG.shortName,
            default_popup: expect.any(String),
        });
        expect(bridge).toMatchObject({
            matches: ['*://*.kancolle-server.com/*'],
            all_frames: true,
            run_at: 'document_start',
        });
        expect(interceptor).toMatchObject({
            matches: ['*://*.kancolle-server.com/*'],
            all_frames: true,
            run_at: 'document_start',
            world: 'MAIN',
        });
        // scripting 只是「能動態注入」的能力，本身不授予任何網站存取權、也不顯示警告。
        // activeTab：拍照用的 tabs.captureVisibleTab() 只認 <all_urls> 或 activeTab
        // 二擇一（見 wxt.config.ts 註解），不顯示警告、不進 host_permissions、且僅在
        // 使用者實際呼叫擴充（開 popup 等）當下對那個分頁暫時授予。
        expect(manifest.permissions).toEqual(['activeTab', 'alarms', 'notifications', 'scripting', 'tabs']);
        // **這條是權限精簡的底線**：安裝時不得要求任何網站的存取權。劇場模式需要的
        // dmm.com 權限一律走 optional（使用者按下按鈕才跳授權），且 WXT 對
        // `registration: 'runtime'` 會自動把 matches 塞進 host_permissions——
        // wxt.config.ts 的 build:manifestGenerated hook 負責剝掉，壞了這裡就會亮。
        expect(manifest.host_permissions ?? []).toEqual([]);
        expect(manifest.optional_permissions ?? []).toEqual([]);
        expect(manifest.optional_host_permissions ?? []).toEqual(GAME_PAGE_MATCHES);
    });

    // 劇場模式刻意**不在** content_scripts 裡：它由 popup 在取得授權後才動態註冊／注入。
    // 檔案路徑寫錯不會有型別錯誤，只會在執行期靜靜失敗，故這裡核對產物確實存在。
    it('劇場模式 content script 只以動態註冊提供，不進 manifest', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
        const declared = manifest.content_scripts.flatMap(script => script.js ?? []);

        expect(declared.some(file => file.includes('theater'))).toBe(false);
        expect(existsSync(join(outputRoot, THEATER_SCRIPT_FILE))).toBe(true);
    });

    it('載入正式航海天文鐘圖示，且各 PNG 尺寸正確', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
        const sizes = [16, 32, 48, 96, 128] as const;

        expect(manifest.icons).toBeDefined();
        for (const size of sizes) {
            const icon = manifest.icons?.[String(size)];
            expect(icon).toBe(`icon/${size}.png`);
            expect(existsSync(join(outputRoot, icon!))).toBe(true);
            expect(pngDimensions(join(outputRoot, icon!))).toEqual([size, size]);
        }
    });

    it('不將 WXT starter 資產或 metadata 帶進 production output', () => {
        const files = outputFiles(outputRoot);
        const outputText = files
            .filter(path => /\.(?:html|js|json)$/u.test(path))
            .map(path => readFileSync(path, 'utf8'))
            .join('\n');

        expect(files.some(path => path.endsWith('/wxt.svg'))).toBe(false);
        expect(outputText).not.toContain('wxt-starter');
        expect(outputText).not.toContain('manifest.json description');
        const html = files
            .filter(path => path.endsWith('.html'))
            .map(path => readFileSync(path, 'utf8'))
            .join('\n');
        expect(html).not.toContain('KC Monitor');
    });

    // manifest 的 `__MSG_*` 只有在 `_locales/<default_locale>/messages.json` 補齊時才成立：
    // 預設語系少一個 key，Chrome 會直接拒載整個擴充（其他語系缺 key 只是回退，不致命）。
    it('三個語系都提供完整的 messages，且預設語系必須齊全', () => {
        for (const [locale] of LOCALES) {
            const messages = readLocale(locale);
            for (const key of ['extName', 'extShortName', 'extDescription'] as const) {
                expect(messages[key]?.message, `${locale}/${key}`).toBeTruthy();
            }
        }
        expect(readLocale(DEFAULT_LOCALE).extShortName?.message).toBe('Fleet Chronometer');
    });

    // 品牌名有兩份來源：manifest 走 `_locales`（瀏覽器 UI），頁面走 ui-i18n 的
    // `ov.brandShort`（panel/overview 於執行期 setTitle）。兩邊必須逐語言一致，
    // 否則同一個擴充在瀏覽器選單與視窗標題上會叫兩個名字。
    it('_locales 的品牌短名與 UI i18n 的 ov.brandShort 逐語言一致', () => {
        const original = getLang();
        try {
            for (const [locale, language] of LOCALES) {
                setLang(language);
                expect(readLocale(locale).extShortName?.message, locale).toBe(t('ov.brandShort'));
            }
        } finally {
            setLang(original);
        }
    });

    it('package metadata 與頁面 title 都與 production identity 一致', () => {
        const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
            name: string;
            version: string;
            description: string;
        };

        expect(packageJson).toMatchObject({
            name: product.packageName,
            version: product.version,
            description: product.description,
        });

        // 靜態 `<title>` 只是執行期 i18n 生效前的預設值（panel/overview 載入後會依語言改寫，
        // 見 panel/main.ts 與 overview/main.ts），故驗的是「與 zh-TW 品牌名同步」而非英文名。
        const original = getLang();
        try {
            setLang('zh-TW');
            const brand = t('ov.brandShort');
            expect(readFileSync(join(outputRoot, 'panel.html'), 'utf8')).toContain(`<title>${brand}</title>`);
            expect(readFileSync(join(outputRoot, 'overview.html'), 'utf8'))
                .toContain(`<title>${t('ov.title')} — ${brand}</title>`);
        } finally {
            setLang(original);
        }

        // popup 是例外，而且**必須是例外**：WXT 把 popup entrypoint 的 <title> 寫進
        // manifest 的 action.default_title（蓋過 wxt.config.ts 的設定），佔位字串在那裡才會
        // 被代換成當前語系的品牌名。改成實際名字會讓圖示 tooltip 鎖死單一語言——上面那條
        // default_title 斷言與這條是同一件事的兩端，改動任一邊另一邊就會亮。
        expect(readFileSync(join(outputRoot, 'popup.html'), 'utf8')).toContain(`<title>${MSG.shortName}</title>`);
    });
});
