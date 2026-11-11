// 情報總括「目標規劃」分區的離線版面預覽。HTML 直接用正式分區匯出的 goalsHtml()，
// 預覽與正式畫面同一份 markup；樣式取 overview/index.html 的 <style>。
//
// 資料：samples/start2-master.json＋samples/slot_to_port.json（真實封包）。樣本沒有
// useitem 封包，道具一律不可考；為了讓畫面同時出現缺口、足夠與不可考，下面覆寫道具持有量
// （預覽專用的假資料，見 FAKE_USEITEM）。
//
//   npx vite-node --config vitest.config.ts tools/preview/goals.ts
//   → .preview/goals.html、goals-light.html、goals-en.html、goals-ja.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameState } from '../../utils/state';
import { setLang, t } from '../../utils/ui-i18n';
import type { Lang } from '../../utils/gamedata-i18n';
import { goalsHtml } from '../../entrypoints/overview/sections/goals';
import { remodelTargets, type RemodelGoal } from '../../utils/remodel-goals';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const state = new GameState();
state.applyEvent('api_start2/getData', readJson('samples/start2-master.json'));
state.applyEvent('api_port/port', readJson('samples/slot_to_port.json').api_data);

// 預覽專用的假道具持有量：設計圖、戰鬥詳報、新型兵裝資材給一點，其餘維持 null（不可考）。
// 只覆寫這個 GameState 實例的讀取方法，不寫任何檔案或 DB。
const FAKE_USEITEM: Record<number, number> = { 58: 3, 78: 1, 94: 4 };
state.useItemCount = (id: number) => FAKE_USEITEM[id] ?? null;

// 目標（實例 id 取自 slot_to_port.json）：
//   稲木改 Lv81 → 稲木改二：等級已達、道具夠 → 可改造
//   武蔵改 Lv98 → 武蔵改二：設計圖被前面分走而缺 1；新型砲熕兵裝資材為推算且不可考
//   北上改二 Lv75 → 北上改三：等級未達；高速建造材、工廠資源為推算
//   飛龍改二 Lv80 → 飛龍改三：等級與多項道具都缺
//   霧島 Lv1 → 霧島改二丙：三段改造，顯示完整路徑
//   999999：已不在名冊
const GOALS: RemodelGoal[] = [
    { shipId: 83513, targetMst: 0 },
    { shipId: 88066, targetMst: 0 },
    { shipId: 11018, targetMst: 0 },
    { shipId: 60891, targetMst: 0 },
    { shipId: 88342, targetMst: 0 },
    { shipId: 999999, targetMst: 0 },
];
// 目標形態取該艦可達的最後一個形態，免得手寫 master id 寫錯
const ships = new Map(state.ownedShips().map(ship => [ship.id, ship]));
for (const goal of GOALS) {
    const ship = ships.get(goal.shipId);
    goal.targetMst = ship ? remodelTargets(state, ship.masterId).at(-1)! : 911;
}

const SCENES = [
    { title: '1366 寬（側欄釘選）', width: 1366 - 200, pad: '16px 20px' },
    { title: '760 寬（側欄浮層）', width: 760, pad: '12px 12px 20px' },
];

const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));

function page(lang: Lang, theme: 'dark' | 'light'): string {
    setLang(lang);
    // 預覽把「新增目標」展開，候選表格才看得到（正式分區有目標時預設收合）
    const blocks = SCENES.map(scene => `<h2 class="pv-title">${scene.title}<small>內容區 ${scene.width}px</small></h2>
        <div class="pv-frame" style="width:${scene.width}px;padding:${scene.pad}"><div class="ov-section-host">${goalsHtml(state, GOALS, '').replace('<details class="gl-add"', '<details class="gl-add" open')}</div></div>`);
    // 空狀態與「遊戲資料尚未載入」各一格（只看 1366 寬）
    const empty = `<h2 class="pv-title">沒有目標</h2><div class="pv-frame" style="width:${SCENES[0].width}px;padding:${SCENES[0].pad}"><div class="ov-section-host">${goalsHtml(state, [], '')}</div></div>`;
    const noMaster = `<h2 class="pv-title">遊戲資料尚未載入</h2><div class="pv-frame" style="width:${SCENES[0].width}px;padding:${SCENES[0].pad}"><div class="ov-section-host">${goalsHtml(new GameState(), [], '')}</div></div>`;
    return `<!doctype html><html lang="${lang}" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('ov.goals')}</title>
<style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; background: var(--bg); color: var(--text); }
.pv-title { display: flex; gap: 12px; align-items: baseline; font-size: 13px; margin: 28px 0 6px; }
.pv-title small { color: var(--dim); font-weight: 400; }
.pv-frame { border: 1px dashed var(--line); }
</style></head><body>${blocks.join('')}${empty}${noMaster}</body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
const outputs: [string, Lang, 'dark' | 'light'][] = [
    ['goals.html', 'zh-TW', 'dark'],
    ['goals-light.html', 'zh-TW', 'light'],
    ['goals-en.html', 'en', 'dark'],
    ['goals-ja.html', 'ja', 'dark'],
];
for (const [name, lang, theme] of outputs) {
    const out = resolve(root, '.preview', name);
    writeFileSync(out, page(lang, theme));
    console.log(out);
}
