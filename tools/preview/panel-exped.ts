// 面板「遠征」分頁的離線預覽（開發用，不進擴充 bundle）。
// 套 panel/index.html 的同一份 CSS，下半部搭載真實單隊七船編成。
// 左窗＝正式 markup＋正式 CSS；右窗＝對照 markup＋對照 CSS。
//
//   npx vite-node --config vitest.config.ts tools/preview/panel-exped.ts
//   → .preview/panel-exped{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, gearIconHtml, matIconHtml } from '../../utils/html-escape';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
setLang('zh-TW');

const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

// ── 7 船編成假資料（對齊正式 panel 編成資料）────────────────────────────────
const alvMark = (alv: number) =>
    ['', '|', '||', '|||', '/', '//', '///', '&gt;&gt;'][Math.min(7, Math.max(0, alv))];
const impMark = (level: number) => (level >= 10 ? '★' : level > 0 ? String(level) : '');

type Gear = {
    name: string; short: string; cat: string; icon: number;
    level?: number; alv?: number;
    count?: number; countMax?: number; countEst?: boolean;
};
type Ship = {
    stype: string; name: string; nameJa: string; lv: number;
    hp: number; maxhp: number; cond: number;
    fuel: number; maxFuel: number; bull: number; maxBull: number;
    escaped?: boolean; inDock?: boolean;
    gears: (Gear | null)[];
    ex?: Gear | 'empty' | 'none';
    cap?: (number | undefined)[];
};

const blankChip = (cls: string, ex = false, capacity?: number) =>
    ex
        ? `<span class="chip ${cls}"><span class="g-icon-slot"></span><b></b></span>`
        : `<span class="chip ${cls}"><span class="g-icon-slot"></span><span class="r-col"><span class="r-top"><u></u><b></b></span><em class="oc">${capacity || ''}</em></span></span>`;

const slotCountTitle = (g: Gear) => {
    if (g.count == null) return '';
    const est = g.countEst ? `（${t('fleet.slotCountEst')}）` : '';
    return ` [${g.count}${g.countMax != null ? `/${g.countMax}` : ''}]${est}`;
};

const gearChip = (g: Gear, ex = false) => {
    const title = `${esc(g.name)}${g.level ? ` ★${g.level}` : ''}${g.alv ? ` »${g.alv}` : ''}${esc(slotCountTitle(g))}`;
    if (ex) {
        return `<span class="chip ${g.cat} ex" title="${title}">${gearIconHtml(g.icon, g.short)}<b>${impMark(g.level ?? 0)}</b></span>`;
    }
    const ocCls = g.count == null || g.countMax == null ? '' : g.count <= 0 ? 'zero' : g.count < g.countMax ? 'hit' : '';
    return `<span class="chip ${g.cat}" title="${title}">` +
        `${gearIconHtml(g.icon, g.short)}<span class="r-col"><span class="r-top"><u>${alvMark(g.alv ?? 0)}</u><b>${impMark(g.level ?? 0)}</b></span>` +
        `<em class="oc ${ocCls}">${g.count ?? ''}</em></span></span>`;
};

const vitSupply = (s: Ship) => {
    const pct = (v: number, max: number) => (max ? Math.round(100 * v / max) : 100);
    const fp = pct(s.fuel, s.maxFuel), bp = pct(s.bull, s.maxBull);
    return `<span class="vit-sup">` +
        `<span class="sup-f" title="${esc(t('mat.fuel.full'))} ${fp}%">${matIconHtml('fuel')}${fp}</span>` +
        `<span class="sup-a" title="${esc(t('mat.ammo.full'))} ${bp}%">${matIconHtml('ammo')}${bp}</span>` +
        `</span>`;
};

const shipRow = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    const st = r <= 0.25 ? 'st-major' : r <= 0.5 ? 'st-mid' : r <= 0.75 ? 'st-minor' : '';
    const cond = s.cond >= 50 ? 'sparkle' : s.cond <= 19 ? 'heavy' : s.cond <= 29 ? 'tired' : '';
    const realChips = s.gears.map((g, i) => g ? gearChip(g) : blankChip('chip-empty', false, s.cap?.[i])).join('');
    const exChip = s.ex && s.ex !== 'none' && s.ex !== 'empty' ? gearChip(s.ex, true)
        : s.ex === 'empty' ? blankChip('chip-empty ex', true)
            : blankChip('chip-pad', true);
    const padCount = 5 - s.gears.length;
    const chips = realChips + blankChip('chip-pad').repeat(Math.max(0, padCount));
    const taiha = !s.escaped && !s.inDock && st === 'st-major'
        ? `<span class="taiha-mark">${esc(t('fleet.heavyDamage'))}</span>` : '';
    const dock = s.inDock ? `<span class="dock-mark">${esc(t('fleet.inDock'))}</span>` : '';

    return `<div class="ship ${st} ${s.escaped ? 'escaped' : ''} ${s.inDock ? 'in-dock' : ''}">
      <div class="ship-body">
        <div class="ship-id">
          <span class="stype">${esc(s.stype)}</span>
          <span class="grow" title="${esc(s.nameJa)}">${esc(s.name)}</span>
          ${dock}${taiha}
          <span class="num">Lv${s.lv}</span>
        </div>
        <div class="ship-vitals">
          <div class="vit-hp">
            <span class="hp-num">${s.hp}</span><span class="hp-max">/${s.maxhp}</span>
            <span class="hpbar"><i style="width:${Math.round(r * 100)}%"></i></span>
          </div>
          <div class="vit-aux">
            <span class="cond ${cond}">${s.cond}</span>
            ${vitSupply(s)}
          </div>
        </div>
        <div class="sub-row">
          <span class="chips">${chips}</span>${exChip}
        </div>
      </div>
    </div>`;
};

const SEVEN_SHIPS: Ship[] = [
    {
        stype: 'CL', name: '能代改二', nameJa: '能代改二', lv: 94, hp: 53, maxhp: 53, cond: 85,
        fuel: 30, maxFuel: 30, bull: 70, maxBull: 70, ex: 'empty',
        gears: [{ name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 10 }, { name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 10 }, { name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 8 }, { name: '特大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 4 }],
    },
    {
        stype: 'DD', name: '江風改二', nameJa: '江風改二', lv: 89, hp: 32, maxhp: 32, cond: 85,
        fuel: 15, maxFuel: 15, bull: 20, maxBull: 20, ex: 'empty',
        gears: [{ name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 10 }, { name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 6 }, { name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 4 }],
    },
    {
        stype: 'DD', name: '大潮改二', nameJa: '大潮改二', lv: 86, hp: 31, maxhp: 31, cond: 85,
        fuel: 15, maxFuel: 15, bull: 20, maxBull: 20, ex: 'empty',
        gears: [{ name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 10 }, { name: '大発動艇', short: '艇', cat: 'c-etc', icon: 24, level: 6 }, { name: 'ドラム缶(輸送用)', short: '缶', cat: 'c-etc', icon: 25 }],
    },
    {
        stype: 'DD', name: '荒潮改二', nameJa: '荒潮改二', lv: 85, hp: 31, maxhp: 31, cond: 85,
        fuel: 15, maxFuel: 15, bull: 20, maxBull: 20, ex: 'empty',
        gears: [{ name: 'ドラム缶(輸送用)', short: '缶', cat: 'c-etc', icon: 25 }, { name: 'ドラム缶(輸送用)', short: '缶', cat: 'c-etc', icon: 25 }, { name: 'ドラム缶(輸送用)', short: '缶', cat: 'c-etc', icon: 25 }],
    },
    {
        stype: 'DE', name: '占守改', nameJa: '占守改', lv: 68, hp: 17, maxhp: 17, cond: 85,
        fuel: 10, maxFuel: 10, bull: 15, maxBull: 15, ex: 'empty',
        gears: [{ name: '九五式爆雷', short: '爆', cat: 'c-etc', icon: 17 }, { name: '九五式爆雷', short: '爆', cat: 'c-etc', icon: 17 }],
    },
    {
        stype: 'DE', name: '国後改', nameJa: '国後改', lv: 65, hp: 16, maxhp: 16, cond: 85,
        fuel: 10, maxFuel: 10, bull: 15, maxBull: 15, ex: 'empty',
        gears: [{ name: '九五式爆雷', short: '爆', cat: 'c-etc', icon: 17 }, { name: '九五式爆雷', short: '爆', cat: 'c-etc', icon: 17 }],
    },
    {
        stype: 'DE', name: '八丈改', nameJa: '八丈改', lv: 60, hp: 16, maxhp: 16, cond: 85,
        fuel: 10, maxFuel: 10, bull: 15, maxBull: 15, ex: 'none',
        gears: [{ name: '九五式爆雷', short: '爆', cat: 'c-etc', icon: 17 }, { name: '九五式爆雷', short: '爆', cat: 'c-etc', icon: 17 }],
    },
];

const SEVEN_FLEET_HTML = `<section class="fleet">
  <div class="fsummary">
    <div class="fs-metrics">
      <span class="fs-pri">${t('fleet.airPower')} <b>0</b></span>
      <span class="fs-pri">${t('fleet.scouting33')} <b>12.4</b> <select class="cn"><option selected>×1</option><option>×2</option><option>×3</option><option>×4</option></select></span>
      <span class="fs-sec"><b>低速</b></span>
      <span class="fs-sec">${t('fleet.lvTotal')} <b>547</b></span>
      <span class="fs-sec" title="輸送作戰 TP 貢獻值">${t('fleet.transportTP')} <b>38</b></span>
    </div>
  </div>
  ${SEVEN_SHIPS.map(s => shipRow(s)).join('')}
</section>`;

const NAV_HTML = `<button type="button">1</button><button type="button" class="on">2</button><button type="button">3</button><button type="button">4</button><button type="button">連合</button><span class="grow"></span><button type="button">基地</button>`;

const extraCss = `
html, body { height: auto; overflow: auto; }
body { display: block; min-height: 0; padding: 16px; }
.pv-intro { max-width: 900px; font-size: 12px; color: var(--dim); line-height: 1.7; margin: 0 0 12px; }
.pv-intro b { color: var(--text); }
.pv-notes { max-width: 900px; font-size: 11.5px; color: var(--dim); line-height: 1.6; margin: 0 0 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; }
.pv-notes ul { margin: 4px 0 0 18px; padding: 0; }
.pv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.pv-bar button {
  background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 10px; font: 12px/1.4 inherit; cursor: pointer;
}
.pv-bar button.on { border-color: var(--brass); color: var(--sparkle); }
.pv-wins { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.pv-win { width: 420px; }
.pv-win-label { font-size: 11px; letter-spacing: var(--track-label); color: var(--brass); margin-bottom: 6px; }
.pv-measure { font-size: 11px; color: var(--dim); margin-top: 8px; font-variant-numeric: tabular-nums; }
.pv-measure b { color: var(--text); }
.pv-measure.over b { color: var(--dmg-major); }
.pv-app {
  width: 420px; height: 850px; background: var(--bg); border: 1px solid var(--line);
  display: flex; flex-direction: column; overflow: hidden;
}
.pv-app #tabs button, .pv-app #fleetnav button { pointer-events: none; }
.pv-app #tabpanel { flex: none; height: 270px; }

/* ── 提案樣式覆寫（.pv-prop）────────────────────────────────────────────── */
.pv-prop .exped-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.pv-prop .exped-controls .fleet-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--brass);
  border: 1px solid color-mix(in srgb, var(--brass) 50%, transparent);
  border-radius: 3px;
  padding: 1px 6px;
  letter-spacing: var(--track-label);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pv-prop .exped-controls select {
  flex: 1;
  max-width: none;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
  padding: 3px 6px;
}
.pv-prop .exped-summary-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pv-prop .exped-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}
.pv-prop .exped-time {
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.pv-prop .exped-res-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
}
.pv-prop .exped-res-lbl {
  color: var(--dim);
  font-size: 10px;
  letter-spacing: var(--track-label);
  flex: none;
  width: 44px;
}
.pv-prop .exped-res-vals {
  display: flex;
  gap: 8px;
  flex: 1;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.pv-prop .exped-res-vals.bonus {
  color: var(--sparkle);
}
.pv-prop .exped-res-vals img {
  width: 12px;
  height: 12px;
  vertical-align: -1px;
}
.pv-prop .exped-status-tag {
  font-size: 10px;
  font-weight: 700;
  flex: none;
  white-space: nowrap;
}
.pv-prop .exped-status-tag.ok {
  color: #58a55c;
}
.pv-prop .exped-status-tag.ng {
  color: var(--dmg-major);
}
.pv-prop .exped-status-tag.gs {
  color: var(--sparkle);
}
.pv-prop #exped-check {
  max-height: 175px;
  overflow-y: auto;
  border-radius: 4px;
}
.pv-prop .check-row {
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 11.5px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 40%, transparent);
}
.pv-prop .check-row:nth-child(odd) {
  background: color-mix(in srgb, var(--panel) 40%, transparent);
}
.pv-prop .check-row .mark {
  width: 1.2em;
  font-weight: 700;
}
.pv-prop .check-row .num {
  color: var(--dim);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
`;

const SCENES = [
    {
        id: 'bonus-met',
        label: '遠征達成：東京急行（大發加成＋大成功）',
        note: '第 2 艦隊出擊東京急行：條件全達成，大發舟艇加成（金色數字），大成功率 100%（不標誤導性的 ×1.5 徽章）。',
        current: `<div class="exped-controls">
          <span id="exped-fleet-label" class="badge">檢查對象：第2艦隊</span>
          <select id="exped-select"><option>[37] 東京急行</option></select>
        </div>
        <div id="exped-check">
          <div class="dim">所需時間 2:45</div>
          <div class="dim">成功　<span style="color:var(--sparkle)" title="含大発動艇／特大発動艇加成">彈藥442 鋼材325</span>　<span style="color:#58a55c">條件達成</span></div>
          <div class="dim">大成功　<span style="color:var(--sparkle)" title="含大発動艇／特大発動艇加成">彈藥663 鋼材487</span>　<span style="color:var(--sparkle)" title="旗艦全滿+隊員戰意高昂">大成功率 100%</span></div>
          <div class="dim">道具　家具箱(小)×1<span style="color:var(--dim)">（成功時隨機獲得）</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6 艘</span><span class="num">目前 7</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦 Lv50 以上</span><span class="num">目前 94</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦隊 Lv 合計 200 以上</span><span class="num">目前 547</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">軽巡 1 艘以上</span><span class="num">目前 1</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">駆逐 5 艘以上</span><span class="num">目前 3</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">帶有ドラム缶(輸送用)的艦 3 艘以上</span><span class="num">目前 3</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">ドラム缶(輸送用)總數 4 個以上</span><span class="num">目前 5</span></div>
        </div>`,
        proposed: `<div class="exped-controls">
          <span class="fleet-badge">第 2 艦隊</span>
          <select id="exped-select"><option>[37] 東京急行</option></select>
        </div>
        <div class="exped-summary-card">
          <div class="exped-meta-row">
            <span class="exped-time">⏱ 所需時間 2:45:00</span>
            <span class="dim">道具：家具箱(小)×1</span>
          </div>
          <div class="exped-res-row">
            <span class="exped-res-lbl">成功</span>
            <div class="exped-res-vals bonus" title="含大発動艇系裝備加成">
              <span>${matIconHtml('ammo')} 442</span>
              <span>${matIconHtml('steel')} 325</span>
            </div>
            <span class="exped-status-tag ok">✓ 條件達成</span>
          </div>
          <div class="exped-res-row">
            <span class="exped-res-lbl">大成功</span>
            <div class="exped-res-vals bonus" title="含大発動艇系裝備加成">
              <span>${matIconHtml('ammo')} 663</span>
              <span>${matIconHtml('steel')} 487</span>
            </div>
            <span class="exped-status-tag gs" title="旗艦全滿+隊員戰意高昂">大成功率 100%</span>
          </div>
        </div>
        <div id="exped-check">
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6 艘以上</span><span class="num">目前 7</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦 Lv50 以上</span><span class="num">目前 94</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦隊 Lv 合計 200 以上</span><span class="num">目前 547</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">軽巡 1 艘以上</span><span class="num">目前 1</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">駆逐 5 艘以上</span><span class="num">目前 3</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">帶有ドラム缶的艦 3 艘以上</span><span class="num">目前 3</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">ドラム缶總數 4 個以上</span><span class="num">目前 5</span></div>
        </div>`,
    },
    {
        id: 'unmet',
        label: '遠征未達成：北方航路海上護衛（缺條件）',
        note: '第 2 艦隊檢查北方航路：旗艦等級不足、輕空母缺席，紅字 ✕ 警示，大成功排除。',
        current: `<div class="exped-controls">
          <span id="exped-fleet-label" class="badge">檢查對象：第2艦隊</span>
          <select id="exped-select"><option>[A2] 北方航路海上護衛</option></select>
        </div>
        <div id="exped-check">
          <div class="dim">所需時間 8:20</div>
          <div class="dim">成功　<span>燃料500 彈藥0 鋼材0 鋁土400</span>　<span style="color:var(--dmg-major)">條件未達成</span></div>
          <div class="dim">大成功　<span>燃料750 彈藥0 鋼材0 鋁土600</span>　<span style="color:var(--dmg-major)">未達成功條件（大成功除外）</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6 艘</span><span class="num">目前 7</span></div>
          <div class="check-row ng"><span class="mark">✕</span><span class="grow">旗艦 Lv50 以上</span><span class="num">目前 42</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦隊 Lv 合計 200 以上</span><span class="num">目前 547</span></div>
          <div class="check-row ng"><span class="mark">✕</span><span class="grow">軽空母 1 艘以上</span><span class="num">目前 0</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">軽巡 1 艘以上</span><span class="num">目前 1</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">駆逐 4 艘以上</span><span class="num">目前 3</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">対空値合計 200 以上</span><span class="num">目前 312</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">対潜値合計 200 以上</span><span class="num">目前 280</span></div>
        </div>`,
        proposed: `<div class="exped-controls">
          <span class="fleet-badge">第 2 艦隊</span>
          <select id="exped-select"><option>[A2] 北方航路海上護衛</option></select>
        </div>
        <div class="exped-summary-card">
          <div class="exped-meta-row">
            <span class="exped-time">⏱ 所需時間 8:20:00</span>
            <span class="dim">道具：改修資材×1</span>
          </div>
          <div class="exped-res-row">
            <span class="exped-res-lbl">成功</span>
            <div class="exped-res-vals">
              <span>${matIconHtml('fuel')} 500</span>
              <span>${matIconHtml('bauxite')} 400</span>
            </div>
            <span class="exped-status-tag ng">✕ 條件未達成</span>
          </div>
          <div class="exped-res-row">
            <span class="exped-res-lbl">大成功</span>
            <div class="exped-res-vals">
              <span>${matIconHtml('fuel')} 750</span>
              <span>${matIconHtml('bauxite')} 600</span>
            </div>
            <span class="exped-status-tag ng">條件未達（排除）</span>
          </div>
        </div>
        <div id="exped-check">
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6 艘以上</span><span class="num">目前 7</span></div>
          <div class="check-row ng"><span class="mark">✕</span><span class="grow">旗艦 Lv50 以上</span><span class="num">目前 42</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦隊 Lv 合計 200 以上</span><span class="num">目前 547</span></div>
          <div class="check-row ng"><span class="mark">✕</span><span class="grow">軽空母 1 艘以上</span><span class="num">目前 0</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">軽巡 1 艘以上</span><span class="num">目前 1</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">駆逐 4 艘以上</span><span class="num">目前 3</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">対空値合計 200 以上</span><span class="num">目前 312</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">対潜値合計 200 以上</span><span class="num">目前 280</span></div>
        </div>`,
    },
];

const page = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>遠征分頁預覽（420×850）</title>
<style>${css}${extraCss}</style>
</head>
<body>
  <p class="pv-intro">
    <b>這是預覽，不是擴充本身。</b>
    左窗＝正式 markup＋正式 CSS；右窗＝提案 markup＋提案 CSS。
    視窗外框 420×850，資訊區固定 270px。下方搭載真實單隊七船編成，量測安全線 ≤ 760px。
  </p>
  <div class="pv-notes">
    <b>遠征分頁審查重點與階層對齊（§7.3）：</b>
    <ul>
      <li>頂部控制列：艦隊標籤對齊 brass 線框小徽章（.fleet-badge），下拉選單乾淨化。</li>
      <li>收益卡片：結構化呈現所需時間、資源收益與成功／大成功狀態，不再是一堆純文字 div 堆疊。</li>
      <li>大發系裝備加成：數字以 --sparkle 亮金標示，不挪用 --res-gain/--res-drain。</li>
      <li>大成功列：只呈現已套用倍率的最終預估數字與大成功率，避免 (×1.5) 被誤讀為尚未計算。</li>
      <li>條件列表：清楚的 ✓/✕ 標記、描述與現況數值，內部限制滾動高度避免撐開 270px。</li>
    </ul>
  </div>
  <div class="pv-bar">
    ${SCENES.map((s, i) => `<button type="button" data-sc="${s.id}"${i === 0 ? ' class="on"' : ''}>${esc(s.label)}</button>`).join('')}
    <button type="button" data-theme>亮／暗主題切換</button>
  </div>
  <p class="pv-scene-note" id="scene-note" style="font-size:12px;color:var(--dim);margin:0 0 10px;"></p>
  <div class="pv-wins" id="wins"></div>

<script>
const SCENES = ${JSON.stringify(SCENES)};
const FLEET = ${JSON.stringify(SEVEN_FLEET_HTML)};
const NAV = ${JSON.stringify(NAV_HTML)};
let scene = 'bonus-met';

function chrome(kind, expedHtml) {
  const prop = kind === 'proposed' ? ' pv-prop' : '';
  const label = kind === 'proposed' ? '提案 · 遠征分頁' : '現況 · 遠征分頁';
  return '<div class="pv-win">' +
    '<div class="pv-win-label">' + label + '</div>' +
    '<div class="pv-app' + prop + '">' +
      '<div id="header">' +
        '<span class="idbox"><span class="nick">第一艦隊</span><span class="num">Lv120</span></span>' +
        '<span class="grow"></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/ship.svg" alt=""> <b>198/250</b></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/equip.svg" alt=""> <b>812/900</b></span>' +
      '</div>' +
      '<div id="tabs">' +
        '<button type="button">一般</button>' +
        '<button type="button">出擊</button>' +
        '<button type="button" class="on">遠征</button>' +
        '<button type="button">工廠</button>' +
        '<button type="button">調度</button>' +
      '</div>' +
      '<div id="tabpanel"><div id="tab-exped" style="display:block">' + expedHtml + '</div></div>' +
      '<div id="fleetnav">' + NAV + '</div>' +
      '<div id="fleets">' + FLEET + '</div>' +
    '</div>' +
    '<div class="pv-measure"></div>' +
  '</div>';
}

function measure() {
  document.querySelectorAll('.pv-win').forEach(win => {
    const el = win.querySelector('.pv-measure');
    const app = win.querySelector('.pv-app');
    const fleets = win.querySelector('#fleets');
    const nav = win.querySelector('#fleetnav');
    const tabpanel = win.querySelector('#tabpanel');
    const header = win.querySelector('#header');
    const tabs = win.querySelector('#tabs');
    if (!el || !app || !fleets) return;
    const appH = Math.round(app.getBoundingClientRect().height);
    const used = Math.round(fleets.getBoundingClientRect().bottom - app.getBoundingClientRect().top);
    const fleetH = Math.round(fleets.getBoundingClientRect().height);
    const navH = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
    const panelH = tabpanel ? Math.round(tabpanel.getBoundingClientRect().height) : 0;
    const chromeH = (header && tabs)
      ? Math.round(tabs.getBoundingClientRect().bottom - header.getBoundingClientRect().top)
      : 0;
    const n = fleets.querySelectorAll('.ship').length;
    const row = fleets.querySelector('.ship');
    const rowH = row ? Math.round(row.getBoundingClientRect().height * 10) / 10 : 0;
    const over = used > 760;
    el.classList.toggle('over', over);
    el.innerHTML = '假窗 <b>' + appH + 'px</b>；七船用掉 <b>' + used + 'px</b> / 760px 安全線' +
      '（頂欄 ' + chromeH + '／遠征區 ' + panelH + '／nav ' + navH + '／fleets ' + fleetH +
      '，' + n + ' 艘、列高 ' + rowH + 'px）' +
      (over ? '　⚠️ 超過 760px 安全線，實機可能裁切' : '　✅ 安全線內（未超出）');
  });
}

function render() {
  const sc = SCENES.find(s => s.id === scene) || SCENES[0];
  document.getElementById('scene-note').textContent = sc.note;
  document.getElementById('wins').innerHTML =
    chrome('current', sc.current) + chrome('proposed', sc.proposed);
  measure();
}

document.querySelectorAll('[data-sc]').forEach(b => {
  b.addEventListener('click', () => {
    scene = b.getAttribute('data-sc');
    document.querySelectorAll('[data-sc]').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
});
document.querySelector('[data-theme]').addEventListener('click', () => {
  const on = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
});
render();
</script>
</body></html>`
    .replace(/src="\/icons\//g, `src="../public/icons/`)
    .replace(/src=\\"\/icons\//g, `src=\\"../public/icons/`);

mkdirSync(resolve(root, '.preview'), { recursive: true });
const dark = resolve(root, '.preview/panel-exped.html');
const light = resolve(root, '.preview/panel-exped-light.html');
writeFileSync(dark, page);
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log(dark);
console.log(light);
