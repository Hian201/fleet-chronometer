// 情報總括「配裝參考」的離線設計預覽。邏輯與正式分區共用 utils/equip-ref.ts；
// 本檔只把樣本母港編成靜態 HTML。樣本 port 沒有 slot_item，庫存標記用適性表點名過的
// 裝備充當「有」（正式版吃 ownedGears()）。
//
//   npx vite-node --config vitest.config.ts tools/preview/equip-ref.ts
//   → .preview/equip-ref.html 與 .preview/equip-ref-light.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameState } from '../../utils/state';
import { nationOf } from '../../utils/ship-nationality';
import { setLang } from '../../utils/ui-i18n';
import { esc } from '../../utils/html-escape';
import { buildStypeLabels, stypeDisplayLabel } from '../../utils/stype-label';
import {
    EQUIP_BONUS_TABLE, bbGroupOf, buildFitRules, markEquipRefShips, nationToBonusCountry,
} from '../../utils/equip-ref';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const extraCss = `
        /* 配裝參考預覽專用。語意色不挪用 --dmg-*／--sally-*／--res-*：
           藍字加成是遊戲內可見的裝備補正，適性是戰鬥命中項、過重是負適性，
           庫存無是鎮守府沒有此裝備。 */
        :root {
            --eq-bonus: #4aa3c9;
            --eq-fit: #8b7cc9;
            --eq-over: #c17a4a;
            --eq-lack: #c9a36a;
        }
        #content:has(.er) {
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding-bottom: 12px;
        }
        #content:has(.er) .ov-section-host {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }
        .er {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
            container-type: inline-size;
            container-name: er;
        }
        .er-layout {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
            gap: 12px;
        }
        .er-ships, .er-pane {
            min-height: 0;
            display: flex;
            flex-direction: column;
            border: 1px solid var(--line);
            border-radius: 8px;
            background: var(--panel);
        }
        .er-ships-head, .er-pane-head {
            flex: none;
            padding: 8px 10px;
            border-bottom: 1px solid var(--line);
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .er-ships-head h2, .er-pane-head h2 {
            margin: 0;
            font-size: 12px;
            letter-spacing: var(--track-label);
            color: var(--sparkle);
        }
        .er-search, .er-pane-head select, .er-chip {
            background: var(--bg);
            color: var(--text);
            border: 1px solid var(--line);
            border-radius: 6px;
            font: inherit;
            font-size: 12px;
        }
        .er-search {
            padding: 5px 8px;
        }
        .er-search:focus, .er-chip:focus-visible, .er-ship:focus-visible, .er-sib:focus-visible {
            outline: 2px solid var(--sparkle);
            outline-offset: 1px;
        }
        .er-stypes, .er-filters {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .er-chip {
            padding: 2px 8px;
            cursor: pointer;
            transition: border-color 100ms ease-out, color 100ms ease-out, background-color 100ms ease-out, transform 100ms ease-out;
        }
        .er-chip:hover { border-color: var(--sparkle); color: var(--sparkle); }
        .er-chip:active { transform: scale(.97); }
        .er-chip.on {
            border-color: var(--sparkle);
            color: var(--sparkle);
            background: color-mix(in srgb, var(--brass) 14%, transparent);
        }
        .er-count {
            color: var(--dim);
            font-size: 11px;
            letter-spacing: var(--track-label);
        }
        .er-list, .er-body {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            scroll-padding-top: 8px;
        }
        .er-list { padding: 4px; }
        .er-ship {
            display: grid;
            grid-template-columns: max-content minmax(0, 1fr) 3.2em auto;
            gap: 6px;
            align-items: baseline;
            width: 100%;
            padding: 5px 8px;
            border: 0;
            border-radius: 6px;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }
        .er-ship:hover { background: var(--bg); }
        .er-ship:active { transform: scale(.99); }
        .er-ship.on {
            background: color-mix(in srgb, var(--brass) 14%, transparent);
            color: var(--sparkle);
        }
        .er-stype {
            color: var(--dim);
            font-size: 10px;
            letter-spacing: var(--track-tag);
            white-space: nowrap;
        }
        .er-lv {
            color: var(--dim);
            font-size: 11px;
            font-variant-numeric: tabular-nums;
            text-align: right;
        }
        .er-marks { display: flex; gap: 4px; }
        .er-dot {
            width: 7px; height: 7px; border-radius: 50%;
            display: inline-block;
        }
        .er-dot.bonus { background: var(--eq-bonus); }
        .er-dot.fit { background: var(--eq-fit); }
        .er-dot.over { background: var(--eq-over); }
        .er-identity {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 12px;
            align-items: baseline;
        }
        .er-identity strong {
            font-size: 16px;
            line-height: 1.2;
            letter-spacing: var(--track-title);
        }
        .er-ja { color: var(--dim); font-size: 12px; }
        .er-sibs { display: flex; flex-wrap: wrap; gap: 4px; }
        .er-sib {
            padding: 2px 8px;
            border: 1px solid var(--line);
            border-radius: 999px;
            background: var(--bg);
            color: var(--text);
            font: inherit;
            font-size: 11px;
            cursor: pointer;
        }
        .er-sib.on { border-color: var(--sparkle); color: var(--sparkle); }
        .er-sib:active { transform: scale(.97); }
        .er-body { padding: 8px 10px 16px; }
        .er-group { margin: 0 0 14px; }
        .er-group h3 {
            margin: 0 0 6px;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            letter-spacing: var(--track-label);
            color: var(--dim);
        }
        .er-group h3 .g-icon { width: 18px; height: 18px; }
        .er-row {
            display: grid;
            grid-template-columns: 22px minmax(8em, 1fr);
            gap: 8px;
            padding: 8px 0;
            border-top: 1px solid var(--line);
        }
        .er-row .g-icon { width: 22px; height: 22px; }
        .er-name { font-weight: 600; }
        .er-leng {
            margin-left: 6px;
            color: var(--dim);
            font-weight: 400;
            font-size: 11px;
            letter-spacing: var(--track-label);
        }
        .er-lack {
            display: inline-block;
            margin-left: 8px;
            padding: 1px 7px;
            border: 1px solid color-mix(in srgb, var(--eq-lack) 50%, var(--line));
            border-radius: 4px;
            background: color-mix(in srgb, var(--eq-lack) 16%, transparent);
            color: var(--eq-lack);
            font-weight: 600;
            font-size: 12px;
            letter-spacing: var(--track-label);
            vertical-align: 1px;
        }
        .er-lines { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
        .er-line {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: 12px;
        }
        .er-line-pair {
            padding: 6px 8px 6px 10px;
            border-left: 2px solid var(--eq-bonus);
            background: color-mix(in srgb, var(--eq-bonus) 8%, transparent);
            border-radius: 0 6px 6px 0;
        }
        .er-line-main, .er-pair {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 8px;
            align-items: baseline;
        }
        .er-pair { margin-left: 2.6em; gap: 4px; }
        .er-k {
            color: var(--dim);
            font-size: 10px;
            letter-spacing: var(--track-tag);
            min-width: 2.5em;
        }
        .er-stat {
            color: var(--eq-bonus);
            font-weight: 600;
            font-variant-numeric: tabular-nums;
        }
        .er-meta { color: var(--dim); font-size: 11px; }
        .er-pair-k {
            color: var(--eq-bonus);
            font-size: 10px;
            font-weight: 600;
            letter-spacing: var(--track-tag);
        }
        .er-pair-item {
            display: inline-block;
            padding: 1px 7px;
            border: 1px solid var(--line);
            border-radius: 4px;
            background: var(--bg);
            color: var(--text);
            font-size: 11px;
            font-weight: 500;
        }
        .er-pair-or { color: var(--dim); font-size: 10px; }
        .er-pair-note { color: var(--dim); font-size: 11px; }
        .er-fitv { color: var(--eq-fit); font-variant-numeric: tabular-nums; }
        .er-overv { color: var(--eq-over); font-variant-numeric: tabular-nums; }
        .er-empty { color: var(--dim); padding: 24px 8px; text-align: center; }
        .er-sum {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 14px;
            color: var(--dim);
            font-size: 12px;
            font-variant-numeric: tabular-nums;
        }
        .er-sum .bonus { color: var(--eq-bonus); font-weight: 600; }
        .er-sum .fit { color: var(--eq-fit); font-weight: 600; }
        .er-sum .over { color: var(--eq-over); font-weight: 600; }
        @container er (max-width: 520px) {
            .er-layout { grid-template-columns: minmax(0, 1fr); }
            .er-ships { max-height: 40vh; }
        }
        @media (prefers-reduced-motion: reduce) {
            .er-chip, .er-ship, .er-sib { transition: none; }
            .er-chip:active, .er-ship:active, .er-sib:active { transform: none; }
        }
        @media (prefers-reduced-transparency: reduce) {
            .er-chip.on, .er-ship.on {
                background: color-mix(in srgb, var(--brass) 20%, var(--panel));
            }
            .er-lack {
                background: var(--panel);
                border-color: var(--eq-lack);
            }
            .er-line-pair {
                background: var(--panel);
            }
        }
        @media (prefers-contrast: more) {
            .er-stat { font-weight: 700; }
            .er-lack { font-weight: 700; border-color: var(--text); color: var(--text); }
            .er-line-pair { border-left-color: var(--text); }
            .er-row { border-top-color: var(--text); }
        }
`;

const clientJs = `
(function () {
  var data = JSON.parse(document.getElementById('er-data').textContent);
  var ships = data.ships;
  var gears = data.gears;
  var gearById = {};
  var gearsByCat = {};
  gears.forEach(function (g) {
    gearById[g.id] = g;
    if (!gearsByCat[g.cat]) gearsByCat[g.cat] = [];
    gearsByCat[g.cat].push(g.id);
  });
  var byBase = {};
  ships.forEach(function (s) {
    if (!byBase[s.baseId]) byBase[s.baseId] = [];
    byBase[s.baseId].push(s.instId);
  });
  var q = '';
  var stype = 0;
  var onlyKnown = false;
  var kind = 'all';
  var onlyOwned = false;
  var selected = data.defaultId;
  var listEl = document.getElementById('er-list');
  var bodyEl = document.getElementById('er-body');
  var countEl = document.getElementById('er-count');
  var identEl = document.getElementById('er-ident');
  var sibEl = document.getElementById('er-sibs');
  var sumEl = document.getElementById('er-sum');

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function iconHtml(icon, name) {
    return icon > 0
      ? '<img class="g-icon" src="/public/icons/equipment/' + icon + '.svg" alt="' + esc(name) + '" loading="lazy">'
      : '';
  }
  function has(arr, v) { return arr && arr.indexOf(v) !== -1; }
  function matchesShip(line, ship) {
    var checks = [];
    if (line.shipId) checks.push(has(line.shipId, ship.id));
    if (line.shipBase) checks.push(has(line.shipBase, ship.baseId));
    if (line.shipClass) checks.push(has(line.shipClass, ship.ctype));
    if (line.shipType) checks.push(has(line.shipType, ship.stype));
    if (line.shipCountry) checks.push(has(line.shipCountry, ship.country));
    if (!checks.length) return false;
    return checks.every(Boolean);
  }
  function gearIdsOf(entry) {
    if (entry.ids && entry.ids.length) return entry.ids.filter(function (id) { return gearById[id]; });
    var out = [];
    (entry.types || []).forEach(function (cat) {
      (gearsByCat[cat] || []).forEach(function (id) { out.push(id); });
    });
    return out;
  }
  function lengText(n) {
    return ['', '短', '中', '長', '超長'][n] || '';
  }
  function isMainGun(g) {
    return g.cat === 1 || g.cat === 2 || g.cat === 3 || g.cat === 38;
  }
  function fitDay(r) {
    return r.fit ? r.fit.day : -999;
  }
  function fmtStats(bonus) {
    var order = ['houg','raig','tyku','tais','saku','houm','kaih','souk','baku','leng'];
    var labels = {houg:'火力',raig:'雷裝',tyku:'對空',tais:'對潛',saku:'索敵',houm:'命中',kaih:'迴避',souk:'裝甲',baku:'爆裝',leng:'射程'};
    return order.filter(function (k) { return bonus[k]; }).map(function (k) {
      var n = bonus[k];
      var sign = n > 0 ? '+' + n : String(n);
      return '<span class="er-stat">' + labels[k] + sign + '</span>';
    }).join('');
  }
  function metaBits(line) {
    var bits = [];
    if (line.level) bits.push('★' + line.level + ' 起');
    if (line.num === 1) bits.push('不累加');
    else bits.push('每顆累加');
    if (line.requiresAR) bits.push('需對空電探');
    if (line.requiresSR) bits.push('需對水上電探');
    if (line.requiresAccR) bits.push('需命中電探');
    return bits;
  }
  function pairGears(line) {
    if (!line.requiresId || !line.requiresId.length) return [];
    return line.requiresId.map(function (id) {
      return gearById[id] ? gearById[id].name : '#' + id;
    });
  }
  function pairNotes(line) {
    var bits = [];
    if (line.requiresType && line.requiresType.length) bits.push('需特定裝備類');
    if (line.requiresEquipList) bits.push('有相互加成條件');
    return bits;
  }
  function fitFor(ship) {
    var map = {};
    data.fitRules.forEach(function (rule) {
      var m = rule.match;
      if (m.bbGroup && ship.bbGroup !== m.bbGroup) return;
      if (m.stypes && !has(m.stypes, ship.stype)) return;
      if (m.ctypes && !has(m.ctypes, ship.ctype)) return;
      if (m.ids && !has(m.ids, ship.id)) return;
      if (m.excludeIds && has(m.excludeIds, ship.id)) return;
      if (m.excludeCtypes && has(m.excludeCtypes, ship.ctype)) return;
      rule.gearIds.forEach(function (id) {
        var g = gearById[id];
        if (!g || ship.equipCats.indexOf(g.cat) === -1) return;
        var prev = map[id];
        if (!prev) map[id] = { day: rule.day, note: rule.note, unverified: !!rule.unverified };
        else {
          prev.day += rule.day;
          if (rule.note && prev.note.indexOf(rule.note) === -1) prev.note += '；' + rule.note;
          if (rule.unverified) prev.unverified = true;
        }
      });
    });
    return map;
  }
  function collect(ship) {
    var byGear = {};
    data.bonus.forEach(function (entry) {
      var ids = gearIdsOf(entry);
      entry.bonuses.forEach(function (line) {
        if (!matchesShip(line, ship)) return;
        ids.forEach(function (id) {
          var g = gearById[id];
          if (!g || ship.equipCats.indexOf(g.cat) === -1) return;
          if (!byGear[id]) byGear[id] = { id: id, lines: [], fit: null };
          byGear[id].lines.push(line);
        });
      });
    });
    var fits = fitFor(ship);
    Object.keys(fits).forEach(function (id) {
      if (!byGear[id]) byGear[id] = { id: Number(id), lines: [], fit: fits[id] };
      else byGear[id].fit = fits[id];
    });
    return Object.keys(byGear).map(function (id) { return byGear[id]; });
  }
  function shipMarks(ship) {
    return {
      bonus: !!ship.hasBonus,
      fit: !!ship.hasFit,
      over: !!ship.hasOver,
      n: ship.n || 0,
    };
  }
  function visibleShips() {
    var needle = q.trim().toLowerCase();
    return ships.filter(function (s) {
      if (stype && s.stype !== stype) return false;
      if (needle && s.name.toLowerCase().indexOf(needle) === -1 && s.nameJa.toLowerCase().indexOf(needle) === -1) return false;
      if (onlyKnown && shipMarks(s).n === 0) return false;
      return true;
    });
  }
  function renderList() {
    var rows = visibleShips();
    countEl.textContent = '顯示 ' + rows.length + '／' + ships.length + ' 艘（預覽用母港樣本）';
    listEl.innerHTML = rows.map(function (s) {
      var m = shipMarks(s);
      var dots = (m.bonus ? '<i class="er-dot bonus" title="有藍字加成"></i>' : '')
        + (m.fit ? '<i class="er-dot fit" title="有正適性"></i>' : '')
        + (m.over ? '<i class="er-dot over" title="有過重適性"></i>' : '');
      return '<button type="button" class="er-ship' + (s.instId === selected ? ' on' : '') + '" data-id="' + s.instId + '"'
        + ' aria-pressed="' + (s.instId === selected ? 'true' : 'false') + '">'
        + '<span class="er-stype">' + esc(s.stypeLabel) + '</span>'
        + '<span>' + esc(s.name) + '</span>'
        + '<span class="er-lv">Lv.' + s.lv + '</span>'
        + '<span class="er-marks">' + dots + '</span></button>';
    }).join('') || '<p class="er-empty">沒有符合目前條件的艦娘。</p>';
  }
  function renderPane() {
    var ship = ships.filter(function (s) { return s.instId === selected; })[0] || ships[0];
    if (!ship) return;
    selected = ship.instId;
    identEl.innerHTML = '<div class="er-identity"><strong>' + esc(ship.name) + '</strong>'
      + '<span class="er-lv">Lv.' + ship.lv + '</span>'
      + '<span class="er-ja" title="封包原名">' + esc(ship.nameJa) + '</span>'
      + '<span class="er-stype">' + esc(ship.stypeLabel) + '</span></div>';
    var sibs = byBase[ship.baseId] || [];
    sibEl.hidden = sibs.length < 2;
    sibEl.innerHTML = sibs.length < 2 ? '' : sibs.map(function (instId) {
      var s = ships.filter(function (x) { return x.instId === instId; })[0];
      return '<button type="button" class="er-sib' + (instId === ship.instId ? ' on' : '') + '" data-id="' + instId + '">'
        + esc(s.name) + (s.lv ? ' Lv.' + s.lv : '') + '</button>';
    }).join('');
    var collected = collect(ship);
    var rows = collected.filter(function (r) {
      if (kind === 'bonus' && !r.lines.length) return false;
      if (kind === 'fit' && !r.fit) return false;
      if (onlyOwned && !gearById[r.id].owned) return false;
      return true;
    });
    var nBonus = rows.filter(function (r) { return r.lines.length; }).length;
    var nFit = rows.filter(function (r) { return r.fit && r.fit.day > 0; }).length;
    var nOver = rows.filter(function (r) { return r.fit && r.fit.day < 0; }).length;
    var nLack = rows.filter(function (r) { return !gearById[r.id].owned; }).length;
    sumEl.innerHTML = rows.length
      ? ('<span class="bonus">藍字 ' + nBonus + '</span>'
        + '<span class="fit">正適性 ' + nFit + '</span>'
        + '<span class="over">過重 ' + nOver + '</span>'
        + (onlyOwned ? '' : '<span>庫存無 ' + nLack + '</span>'))
      : '沒有符合目前篩選的裝備。';
    if (!rows.length) {
      bodyEl.innerHTML = collected.length
        ? '<p class="er-empty">沒有符合目前篩選的裝備。</p>'
        : '<p class="er-empty">這艘艦目前沒有社群紀錄的藍字加成或主砲適性。</p>';
      return;
    }
    var guns = rows.filter(function (r) { return isMainGun(gearById[r.id]); }).sort(function (a, b) {
      var ga = gearById[a.id], gb = gearById[b.id];
      return (fitDay(b) - fitDay(a)) || (gb.leng - ga.leng) || (ga.sortNo - gb.sortNo) || (a.id - b.id);
    });
    var rest = rows.filter(function (r) { return !isMainGun(gearById[r.id]); }).sort(function (a, b) {
      var ga = gearById[a.id], gb = gearById[b.id];
      return (ga.cat - gb.cat) || (ga.sortNo - gb.sortNo) || (a.id - b.id);
    });
    function rowHtml(r) {
      var g = gearById[r.id];
      var lines = r.lines.map(function (line) {
        var gears = pairGears(line);
        var notes = pairNotes(line);
        var main = '<div class="er-line-main"><span class="er-k">藍字</span>' + fmtStats(line.bonus)
          + metaBits(line).map(function (c) { return '<span class="er-meta">' + esc(c) + '</span>'; }).join('')
          + '</div>';
        var pair = '';
        if (gears.length || notes.length) {
          var chips = gears.map(function (name) {
            return '<span class="er-pair-item">' + esc(name) + '</span>';
          }).join('<span class="er-pair-or">或</span>');
          pair = '<div class="er-pair"><span class="er-pair-k">搭配</span>' + chips
            + notes.map(function (n) { return '<span class="er-pair-note">' + esc(n) + '</span>'; }).join('')
            + '</div>';
        }
        return '<div class="er-line' + (pair ? ' er-line-pair' : '') + '">' + main + pair + '</div>';
      }).join('');
      var fit = '';
      if (r.fit) {
        var cls = r.fit.day < 0 ? 'er-overv' : 'er-fitv';
        var lab = r.fit.day < 0 ? '過重' : '適性';
        var sign = r.fit.day > 0 ? '+' + r.fit.day : String(r.fit.day);
        fit = '<div class="er-line"><div class="er-line-main"><span class="er-k">' + lab + '</span>'
          + '<span class="' + cls + '">晝戰命中項 ' + sign + ' ×√(同口徑本數)</span>'
          + '<span class="er-meta">' + esc(r.fit.note) + (r.fit.unverified ? '（要驗證）' : '') + '</span></div></div>';
      }
      var leng = isMainGun(g) && g.leng ? '<span class="er-leng">' + esc(lengText(g.leng)) + '</span>' : '';
      var lack = g.owned ? '' : '<span class="er-lack">庫存無</span>';
      return '<article class="er-row' + (g.owned ? '' : ' lack') + '">' + iconHtml(g.icon, g.name)
        + '<div><div class="er-name">' + esc(g.name) + leng + lack + '</div><div class="er-lines">' + lines + fit + '</div></div></article>';
    }
    var groups = [];
    if (guns.length) {
      groups.push({ cat: 0, name: '主砲', icon: guns[0] ? gearById[guns[0].id].icon : 0, rows: guns });
    }
    var last = null;
    rest.forEach(function (r) {
      var g = gearById[r.id];
      if (!last || last.cat !== g.cat) {
        last = { cat: g.cat, name: g.catName, icon: g.icon, rows: [] };
        groups.push(last);
      }
      last.rows.push(r);
    });
    bodyEl.innerHTML = groups.map(function (group) {
      return '<section class="er-group"><h3>' + iconHtml(group.icon, group.name) + esc(group.name) + '</h3>'
        + group.rows.map(rowHtml).join('') + '</section>';
    }).join('');
  }
  function selectShip(id) {
    selected = Number(id);
    renderList();
    renderPane();
    var on = listEl.querySelector('.er-ship.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  document.getElementById('er-search').addEventListener('input', function (ev) {
    q = ev.target.value;
    renderList();
  });
  document.getElementById('er-stypes').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-stype]');
    if (!btn) return;
    stype = Number(btn.getAttribute('data-stype'));
    Array.prototype.forEach.call(document.querySelectorAll('#er-stypes .er-chip'), function (el) {
      el.classList.toggle('on', Number(el.getAttribute('data-stype')) === stype);
    });
    renderList();
  });
  document.getElementById('er-known').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-known]');
    if (!btn) return;
    onlyKnown = btn.getAttribute('data-known') === '1';
    Array.prototype.forEach.call(document.querySelectorAll('#er-known .er-chip'), function (el) {
      el.classList.toggle('on', (el.getAttribute('data-known') === '1') === onlyKnown);
    });
    renderList();
  });
  document.getElementById('er-kind').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-kind]');
    if (!btn) return;
    kind = btn.getAttribute('data-kind');
    Array.prototype.forEach.call(document.querySelectorAll('#er-kind .er-chip'), function (el) {
      el.classList.toggle('on', el.getAttribute('data-kind') === kind);
    });
    renderPane();
  });
  document.getElementById('er-stock').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-stock]');
    if (!btn) return;
    onlyOwned = btn.getAttribute('data-stock') === '1';
    Array.prototype.forEach.call(document.querySelectorAll('#er-stock .er-chip'), function (el) {
      el.classList.toggle('on', (el.getAttribute('data-stock') === '1') === onlyOwned);
    });
    renderPane();
  });
  listEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-id]');
    if (btn) selectShip(btn.getAttribute('data-id'));
  });
  sibEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-id]');
    if (btn) selectShip(btn.getAttribute('data-id'));
  });
  renderList();
  renderPane();
})();
`;

function main() {
    setLang('zh-TW');
    const master = readJson('samples/start2-master.json');
    const port = readJson('samples/slot_to_port.json');
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    state.applyEvent('api_port/port', port.api_data);
    const bonus = EQUIP_BONUS_TABLE;

    const catalog = [...state.master.entries()]
        .filter(([, m]) => (m.sortno ?? 0) > 0)
        .map(([id, m]) => {
            const raw = (master.api_mst_ship as any[]).find((s: { api_id: number }) => s.api_id === id);
            return {
                id,
                nameJa: m.name,
                stype: m.stype,
                ctype: m.ctype,
                taik0: raw?.api_taik?.[0] ?? 0,
            };
        });

    const ships = state.ownedShips()
        .map(s => {
            const nation = nationOf(s.ctype);
            return {
                instId: s.id,
                id: s.masterId,
                name: s.name,
                nameJa: state.shipNameJa(s.masterId),
                stype: s.stypeId,
                stypeName: s.stype,
                soku: s.soku,
                ctype: s.ctype,
                baseId: s.baseMst ?? s.masterId,
                lv: s.lv,
                fleetNo: s.fleetNo,
                country: nationToBonusCountry(nation),
                equipCats: s.equipTypes,
                bbGroup: bbGroupOf({
                    masterId: s.masterId, stype: s.stypeId,
                    taik0: state.master.get(s.masterId)?.taik0 ?? 0,
                }),
                hasBonus: false,
                hasFit: false,
                hasOver: false,
                n: 0,
                stypeLabel: '',
            };
        })
        .sort((a, b) => b.lv - a.lv || a.name.localeCompare(b.name, 'zh-Hant'));

    const typeName = new Map<number, string>();
    for (const e of master.api_mst_slotitem_equiptype ?? []) {
        if (e?.api_id) typeName.set(e.api_id, e.api_name ?? '');
    }

    const gears = [...state.masterGears.entries()]
        .filter(([, g]) => (g.sortNo ?? 0) > 0)
        .map(([id, g]) => ({
            id,
            name: state.gearName(id),
            nameJa: g.name,
            icon: g.icon,
            cat: g.cat,
            catName: typeName.get(g.cat) || g.name,
            sortNo: g.sortNo ?? id,
            leng: g.stats.leng ?? 0,
        }))
        .sort((a, b) => a.cat - b.cat || a.sortNo - b.sortNo);

    const fitRules = buildFitRules(
        gears.map(g => ({ id: g.id, nameJa: g.nameJa })),
        catalog.map(c => ({ id: c.id, nameJa: c.nameJa, ctype: c.ctype })),
    );

    const allMarks = markEquipRefShips(ships.map(ship => ({
        masterId: ship.id,
        baseId: ship.baseId,
        stype: ship.stype,
        ctype: ship.ctype,
        country: ship.country,
        equipCats: ship.equipCats,
        bbGroup: ship.bbGroup,
    })), gears, bonus, fitRules);
    ships.forEach((ship, i) => {
        ship.hasBonus = allMarks[i].hasBonus;
        ship.hasFit = allMarks[i].hasFit;
        ship.hasOver = allMarks[i].hasOver;
        ship.n = allMarks[i].n;
    });

    const stypeLabel = new Map<number, string>();
    buildStypeLabels(ships.map(s => ({ stypeId: s.stype, stype: s.stypeName, soku: s.soku })), stypeLabel);
    const stypes = [...stypeLabel.entries()].sort((a, b) => a[0] - b[0]);
    for (const s of ships) {
        s.stypeLabel = stypeDisplayLabel({
            stypeId: s.stype, stype: s.stypeName, soku: s.soku,
        });
    }
    const defaultId = ships.find(s => s.id === 591)?.instId
        ?? ships.find(s => s.id === 911)?.instId
        ?? ships[0]?.instId;

    const listHtml = ships.map(s => {
        const on = s.instId === defaultId;
        const dots = (s.hasBonus ? '<i class="er-dot bonus" title="有藍字加成"></i>' : '')
            + (s.hasFit ? '<i class="er-dot fit" title="有正適性"></i>' : '')
            + (s.hasOver ? '<i class="er-dot over" title="有過重適性"></i>' : '');
        return `<button type="button" class="er-ship${on ? ' on' : ''}" data-id="${s.instId}" aria-pressed="${on ? 'true' : 'false'}">`
            + `<span class="er-stype">${esc(s.stypeLabel)}</span>`
            + `<span>${esc(s.name)}</span>`
            + `<span class="er-lv">Lv.${s.lv}</span>`
            + `<span class="er-marks">${dots}</span></button>`;
    }).join('');

    const ownedFromPort = new Set(state.ownedGears().map(g => g.mst));
    // 樣本 port 沒有 slot_item；預覽用適性表點名過的裝備充當庫存，其餘才看得到「庫存無」。
    const ownedMst = ownedFromPort.size > 0
        ? ownedFromPort
        : new Set(fitRules.flatMap(r => r.gearIds));

    const payload = {
        defaultId,
        ships,
        gears: gears.map(({ nameJa: _n, ...row }) => ({ ...row, owned: ownedMst.has(row.id) })),
        bonus,
        fitRules,
    };

    const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
    const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
    const nav = [
        ['艦隊全覽', false], ['活動配船板', false], ['艦娘全覽', false], ['裝備全覽', false],
        ['配裝參考', true],
        ['出擊紀錄', false], ['打撈紀錄', false], ['遠征紀錄', false], ['建造紀錄', false],
        ['開發紀錄', false], ['資源紀錄', false], ['任務導覽', false], ['LLM 分析', false],
        ['資料備份與還原', false],
    ].map(([label, on]) => `<a href="#" class="${on ? 'active' : ''}">${esc(String(label))}</a>`).join('');

    const stypeChips = `<button type="button" class="er-chip on" data-stype="0">全部</button>`
        + stypes.map(([id, name]) => `<button type="button" class="er-chip" data-stype="${id}">${esc(name)}</button>`).join('');

    const shell = `
    <div class="er">
        <div class="er-layout">
            <aside class="er-ships">
                <div class="er-ships-head">
                    <h2>全艦娘</h2>
                    <input class="er-search" id="er-search" type="search" placeholder="搜尋艦名" autocomplete="off">
                    <div class="er-stypes" id="er-stypes">${stypeChips}</div>
                    <div class="er-filters" id="er-known">
                        <button type="button" class="er-chip on" data-known="0">全部列出</button>
                        <button type="button" class="er-chip" data-known="1">只看有資料</button>
                    </div>
                    <div class="er-count" id="er-count">顯示 ${ships.length}／${ships.length} 艘（預覽用母港樣本）</div>
                </div>
                <div class="er-list" id="er-list" role="listbox" aria-label="艦娘清單">${listHtml}</div>
            </aside>
            <section class="er-pane">
                <div class="er-pane-head">
                    <div id="er-ident"></div>
                    <div class="er-sibs" id="er-sibs"></div>
                    <div class="er-filters" id="er-kind">
                        <button type="button" class="er-chip on" data-kind="all">全部</button>
                        <button type="button" class="er-chip" data-kind="bonus">藍字加成</button>
                        <button type="button" class="er-chip" data-kind="fit">適性／過重</button>
                    </div>
                    <div class="er-filters" id="er-stock">
                        <button type="button" class="er-chip on" data-stock="0">全部裝備</button>
                        <button type="button" class="er-chip" data-stock="1">只看庫存有</button>
                    </div>
                    <div class="er-sum" id="er-sum" aria-live="polite"></div>
                </div>
                <div class="er-body" id="er-body"></div>
            </section>
        </div>
    </div>`;

    const page = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>配裝參考（預覽）— 鎮守府情報總括</title>
<style>${css}${extraCss}</style></head>
<body>
    <div id="header">
        <h1 id="page-title">鎮守府情報總括</h1>
        <span class="grow"></span>
        <span class="dim">配裝參考預覽</span>
        <button type="button" id="theme-toggle">亮色主題</button>
    </div>
    <nav id="nav">${nav}</nav>
    <main id="content"><div class="ov-section-host">${shell}</div></main>
    <script type="application/json" id="er-data">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
    <script>
    document.getElementById('theme-toggle').addEventListener('click', function () {
      var root = document.documentElement;
      var light = root.getAttribute('data-theme') === 'light';
      root.setAttribute('data-theme', light ? 'dark' : 'light');
      this.textContent = light ? '亮色主題' : '深色主題';
    });
    </script>
    <script>${clientJs}</script>
</body></html>`;

    mkdirSync(resolve(root, '.preview'), { recursive: true });
    const out = resolve(root, '.preview/equip-ref.html');
    writeFileSync(out, page);
    const light = resolve(root, '.preview/equip-ref-light.html');
    writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
    console.log(out);
    console.log(light);
    console.log(`ownedShips=${ships.length} gears=${gears.length} ownedGearTypes=${ownedMst.size} bonusEntries=${bonus.length} fitRules=${fitRules.length}`);
}

main();
