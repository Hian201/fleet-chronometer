// 改修日程的介面層：情報總括「改修日程」分區與面板工廠「今日改修」的 HTML 純函式。
// master 與艦隊取自 samples（真實封包）；裝備庫在 sample 的 port 裡沒有，下面補一份測試用的。
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { LANGS, setLang, t, tFor, uiStringKeys } from '../utils/ui-i18n';
import type { Lang } from '../utils/gamedata-i18n';
import { AKASHI_SCHEDULE } from '../utils/akashi-schedule-data';
import type { HelperCandidate } from '../entrypoints/overview/sections/improve-plan';
import { akashiDataDate, groupHelpers } from '../utils/akashi-owned';
import {
    defaultOptions, helperCandidates, helperGroups, helperPickHtml, helperResultHtml, improvePlanHtml, statsBodyHtml, weekBodyHtml, weekRows,
} from '../entrypoints/overview/sections/improve-plan';
import { TODAY_HELPER_LIMIT, factoryTodayView } from '../entrypoints/panel/factory-today';

// 本測試斷言的是顯示名稱：匯入 state-display 安裝真正的實作（見 utils/state-format.ts），
// 否則 t() 會回傳 key、艦名與艦種名會回退成封包原名或數字。
import '../utils/state-display';

const readJson = (rel: string) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const scheduled = new Set(AKASHI_SCHEDULE.map(([mst]) => mst));

function makeState(heldMasters: readonly number[], withShips = true): GameState {
    const state = new GameState();
    state.applyEvent('api_start2/getData', readJson('samples/start2-master.json'));
    if (withShips) state.applyEvent('api_port/port', readJson('samples/slot_to_port.json').api_data);
    if (heldMasters.length) {
        state.applyEvent('api_get_member/slot_item', {
            api_slot_item: heldMasters.map((mst, index) => ({ api_id: 800000 + index, api_slotitem_id: mst, api_level: 0, api_alv: 0 })),
        });
    }
    return state;
}

// 87 新型高温高圧缶：週二有四個形態的第二艦（島風／島風改／天津風改／天津風改二）。
// 2 是每天明石單獨；8 週三沒有任何可用組合。
const TUESDAY = Date.UTC(2026, 10, 17, 3, 0, 0); // 2026-11-17 12:00 JST
const WEDNESDAY = Date.UTC(2026, 10, 18, 3, 0, 0);
// 表內查不到的持有裝備，用來走「尚未收錄」
const uncoveredMst = [...makeState([]).masterGears.keys()].find(id => !scheduled.has(id))!;
const state = makeState([87, 87, 2, 8, uncoveredMst]);

afterEach(() => setLang('zh-TW'));

const NEW_PREFIXES = ['ov.ip', 'ov.improvePlan', 'factory.today'];
const newKeys = (lang: Lang) => uiStringKeys(lang).filter(key => NEW_PREFIXES.some(prefix => key.startsWith(prefix)));

describe('文案', () => {
    for (const { code } of LANGS) {
        it(`${code}：新增的鍵都有非空字串`, () => {
            const keys = newKeys(code);
            expect(keys.length).toBeGreaterThan(40);
            for (const key of keys) {
                const text = tFor(code, key);
                expect(text.trim(), key).not.toBe('');
                expect(text, key).not.toBe(key);
            }
        });
    }
});

describe('情報總括「改修日程」', () => {
    for (const { code } of LANGS) {
        it(`${code}：不露出原始鍵名、沒有空欄頭`, () => {
            setLang(code);
            const html = improvePlanHtml(state, TUESDAY, [
                { gearMst: 87, attempts: 3, successes: 2, certain: 1, lastTs: TUESDAY },
            ]);
            expect(html).not.toMatch(/\b(?:ov\.ip|ov\.improvePlan|factory\.today)\w*/);
            expect(html).not.toMatch(/<(?:th|button|summary|label|option)[^>]*>\s*<\/(?:th|button|summary|label|option)>/);
            expect(html).toContain(t('ov.ipDataDate', { date: akashiDataDate() }));
        });
    }

    it('不寫資料來源（§2.5）', () => {
        for (const { code } of LANGS) {
            for (const key of newKeys(code)) expect(tFor(code, key), `${code} ${key}`).not.toMatch(/wiki|KC3|kc3|社群|community/i);
        }
    });

    it('一週總表的第二艦提示：同一艘艦的各形態併成一個名字', () => {
        const opts = { ...defaultOptions(TUESDAY), heldOnly: false, day: 'all' as const };
        const html = weekBodyHtml(state, TUESDAY, weekRows(state, opts), opts);
        const titles = [...html.matchAll(/class="ip-need[^"]*" role="img" title="改修秘書艦：([^"]*)"/g)].map(match => match[1]);
        expect(titles.length).toBeGreaterThan(100);
        for (const title of titles) {
            const names = title.split('、').map(name => name.replace(/^✓/, ''));
            expect(new Set(names).size, title).toBe(names.length);
        }
        // 41cm連装砲(8) 的長門系三個形態併成一個名字；持有改二就顯示改二
        expect(html).toContain('改修秘書艦：✓長門改二、');
        expect(html).not.toMatch(/改修秘書艦：[^"]*長門[^"]*、[^"]*長門改/);
    });

    it('遊戲資料未載入時只有一句說明', () => {
        expect(improvePlanHtml(new GameState(), TUESDAY, null)).toContain(t('ov.glNoMaster'));
    });

    it('一週總表：預設今天、只看持有；持有且可改修的列才出現，今天那欄有標記', () => {
        const opts = defaultOptions(TUESDAY);
        expect(opts).toMatchObject({ day: 2, heldOnly: true });
        const rows = weekRows(state, opts);
        expect(rows.map(row => row.gearMst)).toEqual([2, 8, 87]); // 沒持有的、以及週二不能改修的都不列
        const html = weekBodyHtml(state, TUESDAY, rows, opts);
        expect(html).toContain('ip-solo');
        expect(html).toContain('ip-today');
        expect(html).toContain('×2'); // 87 持有兩件
    });

    it('全部／曜日不限：顯示未持有者，並可用名稱搜尋', () => {
        const all = weekRows(state, { ...defaultOptions(TUESDAY), heldOnly: false, day: 'all' });
        expect(all.length).toBe(AKASHI_SCHEDULE.length);
        expect(all.slice(0, 3).every(row => row.held > 0)).toBe(true); // 持有的排前面
        const found = weekRows(state, { ...defaultOptions(TUESDAY), heldOnly: false, day: 'all', query: state.gearName(87) });
        expect(found.map(row => row.gearMst)).toContain(87);
        expect(found.length).toBeLessThan(all.length);
    });

    it('總括的名稱搜尋三語比對：顯示語言是繁中時，日文與英文關鍵字也找得到', () => {
        setLang('zh-TW');
        const base = { ...defaultOptions(TUESDAY), heldOnly: false, day: 'all' as const };
        expect(state.gearName(87)).toBe('新型高溫高壓罐');
        for (const query of ['高温高圧缶', 'New Model High Temperature', 'HIGH TEMPERATURE', '新型高溫']) {
            expect(weekRows(state, { ...base, query }).map(row => row.gearMst), query).toContain(87);
        }
        // 與「只看持有」並用：87 有持有，搜日文仍在；沒持有的 13 在只看持有下不出現
        expect(weekRows(state, { ...defaultOptions(TUESDAY), day: 'all', query: '高温高圧缶' }).map(row => row.gearMst)).toEqual([87]);
        expect(weekRows(state, { ...defaultOptions(TUESDAY), day: 'all', query: 'torpedo' }).map(row => row.gearMst)).not.toContain(13);
        // 搜尋框的說明寫明三種語言可用
        for (const { code } of LANGS) {
            setLang(code);
            const html = improvePlanHtml(state, TUESDAY, [], base);
            expect(html).toContain(`aria-label="${t('ov.ipSearchLabel')}"`);
            expect(t('ov.ipSearchLabel')).toMatch(code === 'zh-TW' ? /繁體中文.*日文.*英文/ : code === 'ja' ? /繁体字.*日本語.*英語/ : /Traditional Chinese.*Japanese.*English/);
        }
    });

    it('沒有結果時是空狀態文字而不是空白', () => {
        const opts = { ...defaultOptions(TUESDAY), query: '不存在的裝備名稱zzz' };
        expect(weekBodyHtml(state, TUESDAY, weekRows(state, opts), opts)).toContain(t('ov.ipEmptyWeek'));
        const noGear = makeState([]);
        const noGearOpts = defaultOptions(TUESDAY);
        expect(weekBodyHtml(noGear, TUESDAY, weekRows(noGear, noGearOpts), noGearOpts)).toContain(t('ov.ipNoHeld'));
    });

    it('第二艦反查：候選只含今天會多出裝備的持有艦，結果不含明石單獨裝備', () => {
        const candidates = helperCandidates(state, TUESDAY);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates.every(candidate => candidate.n > 0)).toBe(true);
        const html = helperResultHtml(state, TUESDAY, candidates, candidates[0].id);
        expect(html).toContain(state.gearName(87));
        expect(html).not.toContain(`>${state.gearName(2)}<`); // 2 號每天明石單獨，不算多出
        expect(helperPickHtml(state, candidates, candidates[0].id)).toContain('<select');
    });

    it('改修秘書艦選單依艦種分組：組序為 stype id、組內維持多出件數多者在前，標籤不重複', () => {
        for (const { code } of LANGS) {
            setLang(code);
            const candidates = helperCandidates(state, TUESDAY);
            const groups = helperGroups(candidates);
            const html = helperPickHtml(state, candidates, null);
            const labels = [...html.matchAll(/<optgroup label="([^"]*)">/g)].map(match => match[1]);
            expect(labels.length, code).toBe(groups.length);
            expect(new Set(labels).size, code).toBe(labels.length);
            expect(groups.map(group => group.stypeId), code).toEqual([...new Set(candidates.map(candidate => candidate.stypeId))].sort((a, b) => a - b));
            expect(groups.flatMap(group => group.items).length, code).toBe(candidates.length);
            for (const group of groups) {
                expect(group.items.every(item => item.stypeId === group.stypeId)).toBe(true);
                expect(group.items.map(item => item.n), code).toEqual([...group.items.map(item => item.n)].sort((a, b) => b - a));
                expect(group.label).toBe(state.shipStypeLabel(group.items[0].id));
            }
        }
    });

    it('同名艦種經 stype-label 消歧；選項文字、預設選中與退回第一艘不變', () => {
        const ship = (id: number, stypeId: number, soku: number, n: number): HelperCandidate =>
            ({ id, name: `艦${id}`, n, stypeId, stype: '戰艦', soku });
        // stype 8 多數高速、stype 9 低速：兩組都叫「戰艦」，高速那組要加註
        const candidates = [ship(2, 9, 5, 5), ship(1, 8, 10, 4), ship(3, 8, 10, 3)];
        const groups = helperGroups(candidates);
        expect(groups.map(group => group.stypeId)).toEqual([8, 9]);
        expect(groups.map(group => group.label)).toEqual([t('ov.rsStypeFast', { stype: '戰艦' }), '戰艦']);
        // 個別艦的航速取自自己：stype 9 的高速艦不會讓整組被加註
        expect(helperGroups([ship(4, 9, 10, 1), ship(5, 9, 5, 1), ship(6, 9, 5, 1), ship(7, 8, 5, 1)]).map(group => group.label)).toEqual(['戰艦', '戰艦']);
        const html = helperPickHtml(state, candidates, 3);
        expect(html).toContain('<option value="3" selected>艦3（+3）</option>');
        expect(html.match(/ selected>/g)).toHaveLength(1);
        // 指定者不在名單內就退回第一艘（名單第一個，不是分組後第一個）
        expect(helperPickHtml(state, candidates, 999)).toContain('<option value="2" selected>艦2（+5）</option>');
        expect(helperResultHtml(state, TUESDAY, candidates, 999)).toBe(helperResultHtml(state, TUESDAY, candidates, 2));
        // 名單沒變，HTML 完全相同（分區據此決定要不要重建選單）
        expect(helperPickHtml(state, candidates, 3)).toBe(html);
    });

    it('第二艦沒有候選時有說明文字', () => {
        const candidates = helperCandidates(state, WEDNESDAY);
        const picked = helperPickHtml(state, candidates, null);
        if (!candidates.length) expect(picked).toContain(t('ov.ipHelperNone'));
        const empty = makeState([]);
        expect(helperPickHtml(empty, [], null)).toContain(t('ov.ipNoHeld'));
    });

    it('改修紀錄彙總：沒有紀錄寫明，不畫空表；有紀錄時含成功率', () => {
        expect(statsBodyHtml(state, null)).toContain(t('ov.loading'));
        const none = statsBodyHtml(state, []);
        expect(none).toContain(t('ov.ipStNone'));
        expect(none).not.toContain('<table');
        const html = statsBodyHtml(state, [{ gearMst: 87, attempts: 3, successes: 2, certain: 1, lastTs: TUESDAY }]);
        expect(html).toContain('67%');
        expect(html).toContain('<table');
    });
});

describe('groupHelpers', () => {
    it('同一艘艦的改造形態歸成一組：持有者顯示持有的形態，否則顯示起點形態', () => {
        // 13 號艦的改造鏈：11（起點）→ 204 等形態
        expect(groupHelpers([{ masterId: 11, owned: false }, { masterId: 204, owned: false }])).toEqual([{ base: 11, shown: 11, owned: false }]);
        expect(groupHelpers([{ masterId: 11, owned: false }, { masterId: 204, owned: true }])).toEqual([{ base: 11, shown: 204, owned: true }]);
    });

    it('持有的組排前面；表外的艦以自己為起點', () => {
        expect(groupHelpers([{ masterId: 12, owned: false }, { masterId: 13, owned: true }, { masterId: 999999, owned: false }]).map(group => [group.shown, group.owned]))
            .toEqual([[13, true], [12, false], [999999, false]]);
    });
});

describe('面板「今日改修」', () => {
    // 13 號裝備（九七式艦攻）週一有 11／12／13／14／33 五艘不同的第二艦（各有多個改造形態）。
    const MONDAY = Date.UTC(2026, 10, 16, 3, 0, 0); // 2026-11-16 12:00 JST
    const withShips = (masters: number[], held: number[]) => {
        const custom = makeState(held, false);
        masters.forEach((mst, index) => custom.ships.set(700000 + index, { api_ship_id: mst }));
        return custom;
    };
    const rowOf = (html: string, name: string) => html.split('<div class="fac-t-row">').find(chunk => chunk.includes(`title="${name}"`))!;

    it('主清單只列今天動得了的持有裝備；明石單獨給線框徽章；標頭件數＝主清單件數', () => {
        const view = factoryTodayView(state, TUESDAY);
        const mainList = view.list.split('<details')[0];
        expect(mainList).toContain(state.gearName(2));
        expect(mainList).toContain('fac-solo');
        expect(mainList).toContain(state.gearName(8));
        expect(mainList).toContain(state.gearName(87));
        const rows = mainList.split('<div class="fac-t-row">').length - 1;
        expect(view.head).toContain(t('factory.todayHead', { day: t('factory.todayDay2'), n: rows }));
        expect(factoryTodayView(state, WEDNESDAY).list).not.toContain(state.gearName(8)); // 週三沒有任何可用組合
    });

    it('第二艦欄只列持有的艦；超過 3 艘只顯示前 3 艘，完整名單收進 title', () => {
        const owned = withShips([11, 12, 13, 14], [13]);
        const row = rowOf(factoryTodayView(owned, MONDAY).list, owned.gearName(13));
        expect((row.match(/class="fac-h"/g) ?? []).length).toBe(TODAY_HELPER_LIMIT);
        expect(row).not.toContain('fac-h off');
        expect(row).toContain('fac-more">+1<');
        const title = row.match(/class="fac-t-side" title="([^"]*)"/)![1];
        for (const id of [11, 12, 13, 14]) expect(title).toContain(owned.shipName(id));
        expect(title).not.toContain(owned.shipName(33)); // 沒持有的不列
    });

    it('同一艘艦的各形態只出現一次，顯示持有的形態', () => {
        // 13 與 195 同屬一條改造鏈
        const owned = withShips([195], [13]);
        const row = rowOf(factoryTodayView(owned, MONDAY).list, owned.gearName(13));
        expect([...row.matchAll(/class="fac-h">([^<]*)</g)].map(match => match[1])).toEqual([owned.shipName(195)]);
    });

    it('需要未持有改修秘書艦的裝備收進清單下方的 <details>，不計入標頭件數', () => {
        const none = withShips([], [13]);
        const view = factoryTodayView(none, MONDAY);
        expect(view.head).toContain(t('factory.todayHead', { day: t('factory.todayDay1'), n: 0 }));
        expect(view.list).toContain(t('factory.todayNoneNow'));
        expect(view.list).toContain(t('factory.todayNeedHelper', { n: 1 }));
        const details = view.list.slice(view.list.indexOf('<details'));
        expect(details).toContain('fac-h off');
        expect(details).toContain(none.gearName(13));
        expect(factoryTodayView(none, MONDAY, { need: true }).list).toContain('<details class="fac-need" open>');
    });

    it('底部只列「資料待確認」的持有裝備；沒有命中就不出現', () => {
        const view = factoryTodayView(makeState([305, 305, uncoveredMst]), TUESDAY);
        expect(view.foot).toContain(t('factory.todayUnconfirmed', { n: 2 }));
        expect(view.foot).toContain(t('factory.todayUnconfirmedTitle'));
        expect(view.foot).not.toContain(makeState([]).gearName(uncoveredMst)); // 本來就不能改修的裝備不標「待確認」
        expect(factoryTodayView(makeState([87, uncoveredMst]), TUESDAY).foot).toBe('');
        expect(factoryTodayView(makeState([305]), TUESDAY, { unconfirmed: true }).foot).toContain('<details class="fac-unconfirmed" open>');
    });

    it('沒有裝備資料或今天沒有可改修裝備：顯示空狀態文字，不留白', () => {
        for (const { code } of LANGS) {
            setLang(code);
            const noData = factoryTodayView(makeState([]), TUESDAY);
            expect(noData.list).toContain(t('factory.todayNoData'));
            expect(noData.head).toContain(t('factory.todayDay2'));
            const nothingToday = factoryTodayView(makeState([8]), WEDNESDAY);
            expect(nothingToday.list).toContain(t('factory.todayNone'));
            expect(nothingToday.head).toContain(t('factory.todayHead', { day: t('factory.todayDay3'), n: 0 }));
            for (const html of [noData.head, noData.list, nothingToday.head, nothingToday.list]) {
                expect(html.trim()).not.toBe('');
                expect(html).not.toMatch(/factory\.today/);
            }
        }
    });

    it('裝備搜尋：三語關鍵字都能篩，主清單、需要未持有摺疊與標頭件數用同一個條件', () => {
        const held = withShips([], [13, 13, 2, 87]);
        // 2 號每天明石單獨（主清單）；13 號週一沒有持有任何改修秘書艦（摺疊）
        expect(factoryTodayView(held, MONDAY).list).toContain(held.gearName(2));
        for (const query of ['連裝砲', '12.7cm連装砲', 'TWIN GUN', '１２．７ＣＭ']) {
            const view = factoryTodayView(held, MONDAY, {}, query);
            expect(view.list, query).toContain(held.gearName(2));
            expect(view.list, query).not.toContain(held.gearName(13));
            expect(view.head, query).toContain(t('factory.todayHeadMatch', { day: t('factory.todayDay1'), n: 1 }));
        }
        // 摺疊清單（13 號）用日文與英文名都搜得到，且摺疊標題的件數跟著變
        for (const query of ['三連装魚雷', 'torpedo mount']) {
            const view = factoryTodayView(held, MONDAY, { need: true }, query);
            expect(view.list, query).toContain(held.gearName(13));
            expect(view.list, query).not.toContain(held.gearName(2));
            expect(view.list, query).toContain(t('factory.todayNeedHelper', { n: 1 }));
            expect(view.head, query).toContain(t('factory.todayHeadMatch', { day: t('factory.todayDay1'), n: 0 }));
        }
    });

    it('裝備搜尋沒有符合時給明確的空狀態；不搜尋時標頭回到可改修件數；不比對艦名', () => {
        const held = withShips([], [13, 2]);
        const none = factoryTodayView(held, MONDAY, {}, '不存在的裝備名');
        expect(none.list).toContain(t('factory.todayNoMatch'));
        expect(none.list).not.toContain('fac-t-row');
        expect(none.list).not.toContain('<details');
        expect(factoryTodayView(held, MONDAY, {}, '  ').head).toContain(t('factory.todayHead', { day: t('factory.todayDay1'), n: 1 }));
        // 艦名不參與比對（改修秘書艦的名字搜不到裝備）
        expect(factoryTodayView(makeState([87]), TUESDAY, {}, state.shipName(2)).list).toContain(t('factory.todayNoMatch'));
    });

    it('裝備搜尋也套用到底部「資料待確認」，且三語都有搜尋文案', () => {
        const held = makeState([305, 466]);
        const all = factoryTodayView(held, TUESDAY).foot;
        expect(all).toContain(held.gearName(305));
        expect(all).toContain(held.gearName(466));
        const filtered = factoryTodayView(held, TUESDAY, {}, held.gearNameJa(305)).foot;
        expect(filtered).toContain(held.gearName(305));
        expect(filtered).not.toContain(held.gearName(466));
        for (const { code: lang } of LANGS) {
            for (const key of ['factory.searchOpen', 'factory.searchClose', 'factory.searchPlaceholder', 'factory.searchLabel', 'factory.todayHeadMatch', 'factory.todayNoMatch']) {
                expect(tFor(lang, key), `${lang} ${key}`).not.toBe(key);
            }
            expect(tFor(lang, 'factory.searchLabel')).toMatch(lang === 'zh-TW' ? /繁體中文.*日文.*英文/ : lang === 'ja' ? /繁体字.*日本語.*英語/ : /Traditional Chinese.*Japanese.*English/);
        }
    });

    it('曜日依日本時間：UTC 15:00 已是隔天', () => {
        expect(factoryTodayView(state, Date.UTC(2026, 10, 16, 14, 59, 0)).head).toContain(t('factory.todayDay1')); // 週一 23:59 JST
        expect(factoryTodayView(state, Date.UTC(2026, 10, 16, 15, 0, 0)).head).toContain(t('factory.todayDay2'));
    });
});
