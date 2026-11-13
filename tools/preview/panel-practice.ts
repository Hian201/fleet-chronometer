// 面板「出擊」分頁演習畫面的離線預覽（開發用，不進擴充 bundle）。
// 套正式面板 CSS 與 entrypoints/panel/practice.ts 的同一組字串函式，量測 270px 資訊區是否捲動、各列是否溢出。
// 對手資料取自 samples/practice-list-after-battles.json 的形狀（api_state 0／3／0／0／6、
// 勳章 0／0／18／0／1、旗艦 369／538／187／723／911）；提督名與留言為假資料。
//
//   npx vite-node --config vitest.config.ts tools/preview/panel-practice.ts
//   → .preview/panel-practice{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { practiceBattleHeadHtml, practiceListHtml, practiceNightHtml, type PracticeRow } from '../../entrypoints/panel/practice';
import { nightRankTargets } from '../../utils/battle';
import type { BattleShipView } from '../../utils/battle-types';
import { formatTime } from '../../utils/date-format';
import { esc, idleLabelHtml } from '../../utils/html-escape';
import { nextPracticeReset } from '../../utils/idle-check';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error('無法取得正式面板樣式');

type Lang = 'zh-TW' | 'en' | 'ja';
const LANGS: Lang[] = ['zh-TW', 'en', 'ja'];

// 旗艦艦名與艦種（start2-master：369 山風改 DD、538 冬月改 DD、187 明石改 AR、723 Ranger改 CV、911 大和改二 BB）。
const ships: Record<number, { stype: Record<Lang, string>; name: Record<Lang, string> }> = {
    369: { stype: { 'zh-TW': '驅逐', en: 'DD', ja: '駆逐' }, name: { 'zh-TW': '山風改', en: 'Yamakaze Kai', ja: '山風改' } },
    538: { stype: { 'zh-TW': '驅逐', en: 'DD', ja: '駆逐' }, name: { 'zh-TW': '冬月改', en: 'Fuyutsuki Kai', ja: '冬月改' } },
    187: { stype: { 'zh-TW': '工作', en: 'AR', ja: '工作' }, name: { 'zh-TW': '明石改', en: 'Akashi Kai', ja: '明石改' } },
    723: { stype: { 'zh-TW': '正航', en: 'CV', ja: '正空' }, name: { 'zh-TW': 'Ranger改', en: 'Ranger Kai', ja: 'Ranger改' } },
    911: { stype: { 'zh-TW': '戰艦', en: 'BB', ja: '戦艦' }, name: { 'zh-TW': '大和改二', en: 'Yamato Kai Ni', ja: '大和改二' } },
};
type Opp = { name: string; lv: number; rank: string; flag: number; comment: string; result: string | null; medals: number };
const opponents: Opp[] = [
    { name: '鎮守府第一艦隊司令長官', lv: 116, rank: '元帥', flag: 369, comment: '每天都在等新艦實裝', result: null, medals: 0 },
    { name: 'Commander_Example', lv: 120, rank: '大将', flag: 538, comment: 'Anyone seen Unryuu around here?', result: 'C', medals: 0 },
    { name: 'NaoV', lv: 120, rank: '元帥', flag: 187, comment: '三隻挖完了，剩下榧', result: null, medals: 18 },
    { name: '黒乃須', lv: 120, rank: '元帥', flag: 723, comment: '任務打不完', result: null, medals: 0 },
    { name: '蒼威', lv: 120, rank: '元帥', flag: 911, comment: '', result: 'S', medals: 1 },
];
const rowsFor = (lang: Lang, list: Opp[], current: number | null = null): PracticeRow[] => list.map((o, i) => ({
    name: o.name, level: o.lv, rank: o.rank,
    flagshipName: ships[o.flag].name[lang], stype: ships[o.flag].stype[lang],
    comment: o.comment, medals: o.medals, result: o.result, current: i === current,
}));
const leftOf = (list: Opp[]) => list.filter(o => o.result === null).length;

// 預覽固定在 2026/11/13 10:30（台灣），下一次換新是 15:00 JST＝本機 14:00。
const NOW = Date.UTC(2026, 10, 13, 2, 30);
const resetTime = formatTime(nextPracticeReset(NOW), false);

function tabsHtml(left: number | null) {
    const tip = left ? t('idle.practice', { n: left }) : null;
    return `<div class="pv-head"></div><div id="tabs">
        <button data-t="general">${t('tab.general')}</button>
        <button data-t="sortie" class="on">${idleLabelHtml(t('tab.sortie'), tip)}</button>
        <button data-t="exped">${t('tab.exped')}</button>
        <button data-t="factory">${t('tab.factory')}</button>
        <button data-t="order">${t('tab.order')}</button></div>`;
}

function frame(lang: Lang, caption: string, left: number | null, inner: () => string) {
    setLang(lang);
    return `<section class="cell"><h3>${esc(caption)}</h3><div class="pv-app" lang="${lang}">${tabsHtml(left)}
        <div id="tabpanel" class="pv-tabpanel"><div id="battle-content">${inner()}</div></div>
        <div class="pv-fleetnav">fleetnav</div></div><p class="probe"></p></section>`;
}

// 日戰結束狀態。①取自 samples/practice-midnight-battle.json（敵 6 沉 5＝目前 A）；②③為假設。
const ship = (beginHp: number, hp: number): BattleShipView => ({ hp, maxHp: beginHp, beginHp, damecon: 0, sunk: hp <= 0, dealtDamage: 0 });
const sampleEnemy = [30, 73, 81, 31, 19, 30].map((b, i) => ship(b, [0, 0, 49, 0, 0, 0][i]));
const samplePlayer = [35, 93, 27, 91, 17, 39].map((b, i) => ship(b, [35, 15, 27, 77, 3, 39][i]));
const cPlayer = [60, 50, 45, 40, 35, 35].map(b => ship(b, Math.round(b * 0.75)));
const cEnemy = [90, 60, 60, 40, 30, 30].map((b, i) => ship(b, i < 2 ? 0 : i < 4 ? b : Math.round(b * 0.9)));
const sunkEnemy = sampleEnemy.map(s => ({ ...s, hp: 0, sunk: true }));

function battleHtml(lang: Lang, player: BattleShipView[], enemy: BattleShipView[]) {
    const allSunk = enemy.every(s => s.sunk);
    return `<div class="sortie-container">${practiceBattleHeadHtml(rowsFor(lang, opponents, 0), 0)}
        <div class="pv-battle-stub">${esc(t('sortie.ratingPredicted'))}（沿用出擊戰鬥列）</div>
        <div class="s-action-rail with-system"><div class="pv-rail-stub">系統訊號列（沿用）</div>${practiceNightHtml(nightRankTargets(player, enemy), allSunk)}</div></div>`;
}

const pageCss = `
html,body{overflow:auto!important;height:auto!important}
body{display:block;margin:0;padding:16px;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
.cells{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.cell h3{margin:0 0 4px;color:var(--dim);font-size:11px;font-weight:500;width:370px}
.pv-app{width:370px;border:1px solid var(--line);background:var(--bg);overflow:hidden}
.pv-head{height:39px;border-bottom:1px solid var(--line);background:var(--panel)}
.pv-fleetnav{height:32px;line-height:32px;padding:0 10px;color:var(--dim);font-size:10px;border-top:1px solid var(--line)}
.pv-battle-stub{margin-top:1px;height:181px;border:1px dashed var(--line);color:var(--dim);font-size:10.5px;padding:8px;box-sizing:border-box}
.pv-rail-stub{border:1px dashed var(--line);color:var(--dim);font-size:10px;display:flex;align-items:center;justify-content:center}
.probe{margin:4px 0 0;color:var(--dim);font-size:10.5px;width:370px}.probe.bad{color:#e05555}
.group{margin:0 0 6px;font-size:13px;color:var(--text)}
section.wrap{margin-bottom:28px}`;

// 量測：資訊區不得出現捲軸、各列內容不得溢出列寬。
const probe = `<script>document.querySelectorAll('.cell').forEach(cell=>{const bad=[];
const tp=cell.querySelector('.pv-tabpanel');if(tp.scrollHeight>tp.clientHeight+0.5)bad.push('資訊區需捲動 '+tp.scrollHeight+'px');
cell.querySelectorAll('.pr-row,.pr-head,.s-header,.pr-night,.pr-need,#tabs').forEach(r=>{if(r.scrollWidth>r.clientWidth+0.5)bad.push((r.className||r.id)+' 溢出')});
const p=cell.querySelector('.probe');p.textContent=bad.length?bad.join('、'):'270px 內無捲動、無溢出';p.classList.toggle('bad',bad.length>0)});</script>`;

function page(theme: 'dark' | 'light') {
    const doneAll = opponents.map(o => ({ ...o, result: o.result ?? 'A' }));
    const groups: [string, () => string][] = [
        ['對手清單（不在出擊時的出擊分頁）', () => LANGS.map(l => frame(l, `${l}｜第一群`, leftOf(opponents), () => practiceListHtml(rowsFor(l, opponents), leftOf(opponents), resetTime, 0))).join('')],
        ['群別最長字樣（舊式全體）', () => LANGS.map(l => frame(l, `${l}｜舊式全體`, leftOf(opponents), () => practiceListHtml(rowsFor(l, opponents), leftOf(opponents), resetTime, 2))).join('')],
        ['本輪打完／清單不可考', () => [
            frame('zh-TW', 'zh-TW｜本輪五場都打完', 0, () => practiceListHtml(rowsFor('zh-TW', doneAll), 0, resetTime, 1)),
            ...LANGS.map(l => frame(l, `${l}｜換新後清單尚未取得`, null, () => practiceListHtml(null, null, resetTime))),
        ].join('')],
        ['演習戰況：日戰結束時的夜戰目標', () => [
            ...LANGS.map(l => frame(l, `${l}｜樣本：敵 6 沉 5，目前 A`, leftOf(opponents), () => battleHtml(l, samplePlayer, sampleEnemy))),
            ...LANGS.map(l => frame(l, `${l}｜目前 C`, leftOf(opponents), () => battleHtml(l, cPlayer, cEnemy))),
            frame('zh-TW', 'zh-TW｜日戰已全滅', leftOf(opponents), () => battleHtml('zh-TW', samplePlayer, sunkEnemy)),
        ].join('')],
    ];
    return `<!doctype html><html lang="zh-TW" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>演習畫面預覽</title>
<style>${css}\n${pageCss}</style></head><body>
${groups.map(([title, cells]) => `<section class="wrap"><p class="group">${esc(title)}</p><div class="cells">${cells()}</div></section>`).join('')}
${probe}</body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const theme of ['dark', 'light'] as const) {
    const path = resolve(root, `.preview/panel-practice${theme === 'light' ? '-light' : ''}.html`);
    writeFileSync(path, page(theme));
    console.log(path);
}
