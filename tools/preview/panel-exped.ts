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
.pv-app #tab-exped { display: block; }

/* ── 提案樣式覆寫（.pv-prop）────────────────────────────────────────────── */
.pv-prop #tabpanel {
  display: flex;
  flex-direction: column;
  height: 270px;
  overflow: hidden;
  padding: 6px 8px;
  box-sizing: border-box;
}
.pv-prop #tab-exped {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.pv-prop #exped-check {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 控制區：艦隊識別 + 遠征下拉選單 */
.pv-prop .exped-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex: none;
}
.pv-prop .exped-fleet-lbl {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--brass);
  letter-spacing: var(--track-label);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex: none;
}
.pv-prop .exped-select {
  flex: 1;
  min-width: 0;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 1px 6px;
  height: 22px;
  outline: none;
  font-variant-numeric: tabular-nums;
}
.pv-prop .exped-select:focus-visible {
  border-color: var(--sparkle);
}

/* 視覺第一與第二層級：收益預算與判定狀態 HUD */
.pv-prop .exped-yield-grid {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  align-items: center;
  column-gap: 8px;
  row-gap: 2px;
  margin-bottom: 4px;
  padding: 0;
  flex: none;
  line-height: 1.3;
}
/* 第三層級：元資訊標籤（次要引導） */
.pv-prop .exped-lbl {
  color: var(--dim);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--track-label);
  white-space: nowrap;
}
/* 第一層級：判定結論（排在標籤後方第二欄，左對齊） */
.pv-prop .exped-status {
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: left;
  white-space: nowrap;
}
.pv-prop .exped-status.ok {
  color: #58a55c;
}
.pv-prop .exped-status.ng {
  color: var(--dmg-major);
}
.pv-prop .exped-status.gs {
  color: var(--sparkle);
}

/* 第二層級：核心數值（排在第三欄，靠右對齊） */
.pv-prop .exped-res-line {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.pv-prop .res-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  white-space: nowrap;
}
.pv-prop .exped-res-line.bonus .res-item {
  color: var(--sparkle);
  font-weight: 700;
}
.pv-prop .exped-res-line .m-icon {
  width: 12px;
  height: 12px;
  vertical-align: -1.5px;
  flex: none;
}

.pv-prop .exped-items-line {
  grid-column: 2 / -1;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10.5px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pv-prop .exped-items-line .item-name {
  color: var(--text);
  font-weight: 600;
}
.pv-prop .exped-items-line .item-note {
  font-size: 10px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.pv-prop .exped-items-line .item-note.gs {
  color: var(--sparkle);
  font-weight: 600;
}
.pv-prop .exped-items-line .item-note.dim {
  color: var(--dim);
}

/* 檢核清單：三層階層（符號導引 → 條件名稱 → 當前值對照） */
.pv-prop .exped-check-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--line) var(--panel);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 2px;
}

/* 當條件項目超過 8 項時（最高可達 15–16 項）：自動無縫切換為雙欄瀑布網格！ */
.pv-prop .exped-check-list.is-multi-col,
.pv-prop .exped-check-list:has(.check-row:nth-child(9)) {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-flow: column;
  grid-template-rows: repeat(8, auto);
  column-gap: 8px;
  row-gap: 1.5px;
}
.pv-prop .exped-check-list.is-multi-col .check-row,
.pv-prop .exped-check-list:has(.check-row:nth-child(9)) .check-row {
  grid-template-columns: 12px 1fr auto;
  font-size: 10.5px;
  line-height: 1.25;
  padding: 1.5px 2px;
  column-gap: 3px;
}
.pv-prop .exped-check-list.is-multi-col .check-row .mark,
.pv-prop .exped-check-list:has(.check-row:nth-child(9)) .check-row .mark {
  width: 12px;
  font-size: 10px;
}
.pv-prop .exped-check-list.is-multi-col .check-row .num,
.pv-prop .exped-check-list:has(.check-row:nth-child(9)) .check-row .num {
  font-size: 10px;
}
.pv-prop .exped-check-list.is-multi-col .check-row.ng .num,
.pv-prop .exped-check-list.is-multi-col .check-row .num.ng,
.pv-prop .exped-check-list:has(.check-row:nth-child(9)) .check-row.ng .num,
.pv-prop .exped-check-list:has(.check-row:nth-child(9)) .check-row .num.ng {
  font-size: 10px;
}

.pv-prop .check-row {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: baseline;
  column-gap: 6px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11.5px;
  line-height: 1.3;
  background: transparent;
  border: none;
  transition: background 80ms ease;
}
.pv-prop .check-row:hover {
  background: color-mix(in srgb, var(--panel) 50%, transparent);
}
/* 符號階層（高飽和度、字重 800） */
.pv-prop .check-row .mark {
  width: 14px;
  text-align: center;
  font-weight: 800;
  font-size: 11px;
}
.pv-prop .check-row.ok .mark {
  color: #58a55c;
}
.pv-prop .check-row.ng .mark {
  color: var(--dmg-major);
}
/* 條件文字階層（通過時常態 400 --text；未達時加粗 600 警示橘 --dmg-mid） */
.pv-prop .check-row .grow {
  color: var(--text);
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pv-prop .check-row.ng .grow {
  color: var(--dmg-mid);
  font-weight: 600;
}
/* 數值階層（通過時安靜 10.5px 400 --dim；未達時醒目 11.5px 700 警示紅 --dmg-major） */
.pv-prop .check-row .num {
  font-size: 10.5px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: var(--dim);
  text-align: right;
  white-space: nowrap;
}
.pv-prop .check-row.ng .num,
.pv-prop .check-row .num.ng {
  color: var(--dmg-major);
  font-weight: 700;
  font-size: 11px;
}

@media (prefers-reduced-motion: reduce) {
  .pv-prop .check-row { transition: none; }
}
@media (prefers-contrast: more) {
  .pv-prop .exped-select { border-width: 2px; }
  .pv-prop .check-row.ng .grow { color: var(--dmg-major); font-weight: 700; }
  .pv-prop .exped-lbl { color: var(--text); }
}
`;

const SCENES = [
    {
        id: 'bonus-met',
        label: '遠征達成：東京急行(弐)（大發加成＋大成功・雙欄檢核）',
        note: '第 4 艦隊出擊東京急行(弐)：選單內嵌耗時 (2:55)；單勾成功狀態、無多餘括號、大成功條件精簡（大成功 輸送桶10個/4艘），雙欄對齊不截斷。',
        current: `<div class="exped-controls">
          <span id="exped-fleet-label" class="badge">檢查對象：第4艦隊</span>
          <select id="exped-select"><option>[38] 東京急行(弐)</option></select>
        </div>
        <div id="exped-check">
          <div class="dim">所需時間 2:55</div>
          <div class="dim">成功　<span>燃料504 鋼材240</span>　<span style="color:#58a55c">✓ 條件達成</span></div>
          <div class="dim">大成功　<span>燃料756 鋼材360</span>　<span style="color:var(--sparkle)">大成功率 100%</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦未大破</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">全艦補給完畢</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6艘以上</span><span class="num">6艘</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦Lv 65以上</span><span class="num">Lv96</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">合計Lv 240以上</span><span class="num">571</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">驅逐 5艘以上</span><span class="num">5艘</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">輸送桶 8個以上</span><span class="num">10個</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">輸送桶搭載艦 4艘以上</span><span class="num">4艘</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">大成功 輸送桶10個/4艘</span><span class="num">10個/4艘</span></div>
        </div>`,
        proposed: `<div class="exped-header">
          <span class="exped-fleet-lbl">第 4 艦隊</span>
          <select id="exped-select" class="exped-select">
            <option>[35] MO作戰 (7:00)</option>
            <option>[36] 水上打撃部隊 (9:00)</option>
            <option>[37] 東京急行 (2:45)</option>
            <option selected>[38] 東京急行(弐) (2:55)</option>
            <option>[40] 水上航空基地建設 (6:40)</option>
          </select>
        </div>
        <div id="exped-check">
          <div class="exped-yield-grid">
            <span class="exped-lbl">成功</span>
            <span class="exped-status ok">成功條件達成</span>
            <div class="exped-res-line bonus" title="含大発動艇系裝備加成">
              <span class="res-item">${matIconHtml('fuel')} 504</span>
              <span class="res-item">${matIconHtml('steel')} 240</span>
            </div>

            <span class="exped-lbl">大成功</span>
            <span class="exped-status gs" title="桶型滿載+戰意高昂">大成功 目安 100%</span>
            <div class="exped-res-line bonus" title="含大発動艇系裝備加成">
              <span class="res-item">${matIconHtml('fuel')} 756</span>
              <span class="res-item">${matIconHtml('steel')} 360</span>
            </div>

            <span class="exped-lbl">道具</span>
            <div class="exped-items-line" title="家具箱(小)×1 （隨機）">
              <span class="item-name">家具箱(小)×1</span>
              <span class="item-note dim">（隨機）</span>
            </div>
          </div>
          <div class="exped-check-list is-multi-col">
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="旗艦未大破">旗艦未大破</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="全艦補給完畢">全艦補給完畢</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="艦數 6艘以上">艦數 6艘以上</span><span class="num">6艘</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="旗艦Lv 65以上">旗艦Lv 65以上</span><span class="num">Lv96</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="合計Lv 240以上">合計Lv 240以上</span><span class="num">571</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="驅逐 5艘以上">驅逐 5艘以上</span><span class="num">5艘</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="輸送桶 8個以上">輸送桶 8個以上</span><span class="num">10個</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="輸送桶搭載艦 4艘以上">輸送桶搭載艦 4艘以上</span><span class="num">4艘</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow" title="大成功 輸送桶10個/4艘">大成功 輸送桶10個/4艘</span><span class="num">10個/4艘</span></div>
          </div>
        </div>`,
    },
    {
        id: 'unmet',
        label: '遠征未達成：北方航路海上護衛（缺條件）',
        note: '第 2 艦隊檢查北方航路：選單標註 (8:20)；旗艦等級不足、輕空母缺席，紅字 ✕ 警示，大成功排除。',
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
        proposed: `<div class="exped-header">
          <span class="exped-fleet-lbl">第 2 艦隊</span>
          <select id="exped-select" class="exped-select">
            <option>[5] 海上護衛任務 (1:30)</option>
            <option>[9] 兵站輸送作戰 (4:00)</option>
            <option selected>[A2] 北方航路海上護衛 (8:20)</option>
            <option>[A3] 潜水艦前線配備 (12:00)</option>
          </select>
        </div>
        <div id="exped-check">
          <div class="exped-yield-grid">
            <span class="exped-lbl">成功</span>
            <span class="exped-status ng">✕ 條件未達成</span>
            <div class="exped-res-line">
              <span class="res-item">${matIconHtml('fuel')} 500</span>
              <span class="res-item">${matIconHtml('bauxite')} 400</span>
            </div>

            <span class="exped-lbl">大成功</span>
            <span class="exped-status ng">條件未達（排除）</span>
            <div class="exped-res-line">
              <span class="res-item">${matIconHtml('fuel')} 750</span>
              <span class="res-item">${matIconHtml('bauxite')} 600</span>
            </div>

            <span class="exped-lbl">副產物</span>
            <div class="exped-items-line" title="改修資材×1 （大成功限定）">
              <span class="item-name">改修資材×1</span>
              <span class="item-note gs">（大成功限定）</span>
            </div>
          </div>
          <div class="exped-check-list">
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6 艘以上</span><span class="num">目前 7</span></div>
            <div class="check-row ng"><span class="mark">✕</span><span class="grow">旗艦 Lv50 以上</span><span class="num ng">目前 42</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦隊 Lv 合計 200 以上</span><span class="num">目前 547</span></div>
            <div class="check-row ng"><span class="mark">✕</span><span class="grow">軽空母 1 艘以上</span><span class="num ng">目前 0</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">軽巡 1 艘以上</span><span class="num">目前 1</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">駆逐 4 艘以上</span><span class="num">目前 3</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">対空値合計 200 以上</span><span class="num">目前 312</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">対潜値合計 200 以上</span><span class="num">目前 280</span></div>
          </div>
        </div>`,
    },
    {
        id: 'extreme-15',
        label: '極限 15 條件：南西海域戦闘哨戒（B4 雙欄零捲軸）',
        note: '第 2 艦隊出擊南西海域戦闘哨戒：全遊戲最繁複之 15 項檢核條件。左窗單欄大量溢出；右窗 :has() 自動切換雙欄瀑布網格（8 列 × 2 欄），全部可見、零捲軸！',
        current: `<div class="exped-controls">
          <span id="exped-fleet-label" class="badge">檢查對象：第2艦隊</span>
          <select id="exped-select"><option>[B4] 南西海域戦闘哨戒</option></select>
        </div>
        <div id="exped-check">
          <div class="dim">所需時間 3:30</div>
          <div class="dim">成功　<span>燃料0 彈藥330 鋼材0 鋁土260</span>　<span style="color:var(--dmg-major)">條件未達成</span></div>
          <div class="dim">大成功　<span>燃料0 彈藥495 鋼材0 鋁土390</span>　<span style="color:var(--dmg-major)">未達成功條件（大成功除外）</span></div>
          <div class="dim">道具　高速修復材×1<span style="color:var(--dim)">（成功時隨機獲得）</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6 艘</span><span class="num">目前 6</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦 Lv50 以上</span><span class="num">目前 94</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦隊 Lv 合計 264 以上</span><span class="num">目前 547</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦未中破・大破</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">燃彈全補給</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">重巡 1 艘以上</span><span class="num">目前 1</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">軽巡 1 艘以上</span><span class="num">目前 1</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">駆逐 2 艘以上</span><span class="num">目前 3</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">其他艦種 2 艘</span><span class="num">目前 2</span></div>
          <div class="check-row ng"><span class="mark">✕</span><span class="grow">水上電探搭載艦 2 艘以上</span><span class="num">目前 1</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">小型電探 1 個以上</span><span class="num">目前 2</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">対空値合計 200 以上</span><span class="num">目前 312</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">対潜値合計 240 以上</span><span class="num">目前 280</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">索敵値合計 180 以上</span><span class="num">目前 210</span></div>
          <div class="check-row ok"><span class="mark">✓</span><span class="grow">火力合計 360 以上</span><span class="num">目前 410</span></div>
        </div>`,
        proposed: `<div class="exped-header">
          <span class="exped-fleet-lbl">第 2 艦隊</span>
          <select id="exped-select" class="exped-select">
            <option>[37] 東京急行 (2:45)</option>
            <option>[40] 水上航空基地建設 (6:40)</option>
            <option selected>[B4] 南西海域戦闘哨戒 (3:30)</option>
            <option>[46] 南西諸島離島防空作戰 (3:30)</option>
          </select>
        </div>
        <div id="exped-check">
          <div class="exped-yield-grid">
            <span class="exped-lbl">成功</span>
            <span class="exped-status ng">✕ 條件未達成</span>
            <div class="exped-res-line">
              <span class="res-item">${matIconHtml('ammo')} 330</span>
              <span class="res-item">${matIconHtml('bauxite')} 260</span>
            </div>

            <span class="exped-lbl">大成功</span>
            <span class="exped-status ng">條件未達（排除）</span>
            <div class="exped-res-line">
              <span class="res-item">${matIconHtml('ammo')} 495</span>
              <span class="res-item">${matIconHtml('bauxite')} 390</span>
            </div>

            <span class="exped-lbl">副產物</span>
            <div class="exped-items-line" title="開發資材×3 （隨機） 改修資材×1 （大成功限定）">
              <span class="item-name">開發資材×3</span><span class="item-note dim">（隨機）</span>
              <span class="item-name">改修資材×1</span><span class="item-note gs">（大成功限定）</span>
            </div>
          </div>
          <div class="exped-check-list is-multi-col">
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦數 6 艘以上</span><span class="num">6</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦 Lv50 以上</span><span class="num">94</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">艦隊 Lv 合計 264 以上</span><span class="num">547</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">旗艦未中破・大破</span><span class="num">正常</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">燃彈全補給</span><span class="num">100%</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">重巡 1 艘以上</span><span class="num">1</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">軽巡 1 艘以上</span><span class="num">1</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">駆逐 2 艘以上</span><span class="num">3</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">其他艦種 2 艘</span><span class="num">2</span></div>
            <div class="check-row ng"><span class="mark">✕</span><span class="grow">水上電探搭載艦 2 艘以上</span><span class="num ng">1</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">小型電探 1 個以上</span><span class="num">2</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">対空値合計 200 以上</span><span class="num">312</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">対潜値合計 240 以上</span><span class="num">280</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">索敵値合計 180 以上</span><span class="num">210</span></div>
            <div class="check-row ok"><span class="mark">✓</span><span class="grow">火力合計 360 以上</span><span class="num">410</span></div>
          </div>
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
    左窗＝現況基準（或舊版）；右窗＝極簡高密度排版提案（No Border-Soup / No Bento / Zero Expansion）。
    視窗外框 420×850，資訊區固定 270px。下方搭載真實單隊七船編成，量測安全線 ≤ 760px。
  </p>
  <div class="pv-notes">
    <b>遠征分頁極簡高密度重構原則（ui-ux-pro-max 瑞士風格）：</b>
    <ul>
      <li><b>嚴禁框線濫用（No Border-Soup）</b>：徹底移除卡片外框、斑馬紋（nth-child 交替底色）與無謂分隔線；資訊分群全依靠字級階層（10px/11px/12px）、字重（700/600/400）、色彩明暗（--text/--dim）與微邊距（2px/4px/8px）自然形成。</li>
      <li><b>拒絕 Bento 與過度裝飾</b>：移除 rounded 卡片容器、徽章膠囊框與裝飾陰影，資料直接在面板底層以等寬網格流暢排開，純粹呈現核心數值。</li>
      <li><b>遠征時間內嵌於選單（提高挑選決策效率）</b>：所需時間直接內嵌在下拉選單選項內（如 <code>[37] 東京急行 (2:45)</code>），不在外部重複顯示，讓提督在切換遠征時一眼依時間篩選；下拉選單寬度更充裕且不浪費垂直行距。</li>
      <li><b>嚴格高度預算（Zero Expansion）</b>：收益預算壓縮至 3 行等寬 HUD 網格（標籤、狀態判定、資源獲得量三欄對齊）；清單免受卡片內外距浪費，170px 空間可直接容納 8–9 條檢核條件免捲動全覽！</li>
      <li><b>大發加成與狀態色</b>：有裝備加成時數值以 --sparkle 高亮標示；條件達成綠（#58a55c）與警示紅（--dmg-major）精準表達判斷。</li>
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
      '<div id="tabpanel"><div id="tab-exped">' + expedHtml + '</div></div>' +
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
    const expedContent = win.querySelector('#tab-exped');
    const checkList = win.querySelector('.exped-check-list');
    const header = win.querySelector('#header');
    const tabs = win.querySelector('#tabs');
    if (!el || !app || !fleets) return;
    const appH = Math.round(app.getBoundingClientRect().height);
    const used = Math.round(fleets.getBoundingClientRect().bottom - app.getBoundingClientRect().top);
    const fleetH = Math.round(fleets.getBoundingClientRect().height);
    const navH = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
    const panelH = tabpanel ? Math.round(tabpanel.getBoundingClientRect().height) : 0;
    const panelScrollH = tabpanel ? tabpanel.scrollHeight : 0;
    const panelClientH = tabpanel ? tabpanel.clientHeight : 0;
    const hasPanelScroll = panelScrollH > panelClientH;
    const checkScrollH = checkList ? checkList.scrollHeight : 0;
    const checkClientH = checkList ? checkList.clientHeight : 0;
    const hasCheckScroll = checkScrollH > checkClientH;
    const chromeH = (header && tabs)
      ? Math.round(tabs.getBoundingClientRect().bottom - header.getBoundingClientRect().top)
      : 0;
    const n = fleets.querySelectorAll('.ship').length;
    const row = fleets.querySelector('.ship');
    const rowH = row ? Math.round(row.getBoundingClientRect().height * 10) / 10 : 0;
    const over = used > 760 || hasPanelScroll || hasCheckScroll;
    el.classList.toggle('over', over);
    el.innerHTML = '假窗 <b>' + appH + 'px</b>；七船用掉 <b>' + used + 'px</b> / 760px 安全線' +
      '（頂欄 ' + chromeH + '／遠征區 ' + panelH + '／nav ' + navH + '／fleets ' + fleetH +
      '，' + n + ' 艘、列高 ' + rowH + 'px）<br>' +
      '面板捲軸量測：#tabpanel 高 ' + panelClientH + 'px（內容 ' + panelScrollH + 'px · ' +
      (hasPanelScroll ? '⚠️ 出現捲軸！' : '✅ 無捲軸') + '）' +
      (checkList ? '；檢核清單高 ' + checkClientH + 'px（內容 ' + checkScrollH + 'px · ' +
      (hasCheckScroll ? '⚠️ 清單內部捲軸！' : '✅ 清單零捲軸全覽') + '）' : '') +
      (over ? '　⚠️ 超標，存在捲軸或超過 760px' : '　✅ 全部安全線內');
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
