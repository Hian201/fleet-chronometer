// 離線重播提取器 viewer.html 的產生器——回傳一份「單檔、離線、零擴充」的 HTML 字串，
// 由 backup 分區寫進備份資料夾。任何人用瀏覽器開它、載入 kanmusu-replays.json 就能
// 逐場提取 KC3Kai battleplayer 物件（複製或開公開重播頁），完全不需要安裝本擴充、
// 不需要登入。因為每筆 replay 存的就是原封不動的 KC3Kai 相容原始戰鬥封包，這裡把
// utils/replay.ts 的 toKc3Replay() 內聯進去即可自足（純資料轉換、無任何 chrome.*）。
//
// 刻意零外部資源（CSP/離線友善）：樣式內聯、無外部字型/腳本；唯一外連是使用者主動
// 點「開啟重播頁」時跳轉到 KC3Kai 公開的 battleplayer.html。

export function viewerHtml(): string {
    // 注意：此字串整段會被寫成獨立 .html，內部的 JS 在使用者瀏覽器執行，與擴充無關。
    return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>艦隊重播提取器 — Kanmusu Replay Extractor</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans TC", sans-serif;
         background: #1b1712; color: #e8ddcd; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #a89880; font-size: 12px; margin: 0 0 20px; }
  .bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
  button, label.file { background: #3a2f22; color: #f0e6d6; border: 1px solid #5a4a35;
         border-radius: 6px; padding: 7px 12px; font-size: 13px; cursor: pointer; }
  button:hover, label.file:hover { background: #4a3c2c; }
  button:disabled { opacity: .5; cursor: default; }
  input[type=file] { display: none; }
  .status { color: #a89880; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #33291d; font-size: 13px; white-space: nowrap; }
  th { color: #a89880; font-weight: 600; position: sticky; top: 0; background: #1b1712; }
  tr:hover td { background: #241d15; }
  .rank { font-weight: 700; }
  .rank.S { color: #ffd257; } .rank.A { color: #9fe07a; } .rank.B { color: #7ac8e0; }
  .rank.C, .rank.D { color: #e08a7a; }
  .diff { color: #e0a3d0; font-weight: 600; }
  .act { display: flex; gap: 6px; }
  .act button { padding: 4px 9px; font-size: 12px; }
  .empty { color: #8a7a62; padding: 24px 0; }
  code { background: #2a2118; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<h1>艦隊重播提取器</h1>
<p class="sub">載入 <code>kanmusu-replays.json</code>，挑任一場出擊複製 KC3Kai battleplayer 物件或直接開啟重播頁。此頁離線運作、與擴充無關。</p>
<div class="bar">
  <label class="file">載入 replays JSON<input type="file" id="f" accept="application/json,.json"></label>
  <span class="status" id="st">尚未載入檔案。</span>
</div>
<div id="out"></div>

<script>
"use strict";
var BATTLEPLAYER = "https://kc3kai.github.io/kancolle-replay/battleplayer.html";
var DIFF = { 1: "甲", 2: "乙", 3: "丙", 4: "丁" };

// utils/replay.ts toKc3Replay() 的內聯版（欄位命名對齊 KC3Kai）。
function toKc3(row) {
  var ship = function (s) {
    return { mst_id: s.mst_id, lv: s.lv, equip: s.equip, stars: s.stars, ace: s.ace,
             exequip: s.exequip, nowhps: s.nowhp, maxhps: s.maxhp };
  };
  return {
    version: 4, combined: row.combined, fleetnum: row.fleetnum,
    fleet1: (row.fleet1 || []).map(ship), fleet2: (row.fleet2 || []).map(ship),
    battles: (row.battles || []).map(function (b) { return { node: b.node, data: b.data, yasen: b.yasen || null }; }),
    world: row.world, mapnum: row.mapnum, diff: row.diff, time: row.ts, hq: row.nickname
  };
}

function lastRank(row) {
  var bs = row.battles || [];
  for (var i = bs.length - 1; i >= 0; i--) if (bs[i].rank) return bs[i].rank;
  return "";
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function fmtTs(ts) { try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); } }

var replays = [];

function render() {
  var out = document.getElementById("out");
  if (!replays.length) { out.innerHTML = '<p class="empty">此檔沒有重播紀錄。</p>'; return; }
  var rows = replays.slice().sort(function (a, b) { return b.ts - a.ts; });
  var html = '<table><thead><tr><th>海域</th><th>難度</th><th>日期</th><th>rank</th><th>節點</th><th>操作</th></tr></thead><tbody>';
  rows.forEach(function (r, i) {
    var rank = lastRank(r);
    html += '<tr>'
      + '<td>' + esc(r.world) + '-' + esc(r.mapnum) + '</td>'
      + '<td class="diff">' + (DIFF[r.diff] || "—") + '</td>'
      + '<td>' + esc(fmtTs(r.ts)) + '</td>'
      + '<td class="rank ' + esc(rank) + '">' + esc(rank || "—") + '</td>'
      + '<td>' + (r.battles ? r.battles.length : 0) + '</td>'
      + '<td class="act">'
        + '<button data-copy="' + i + '">複製物件</button>'
        + '<button data-open="' + i + '">開啟重播頁 ↗</button>'
      + '</td></tr>';
  });
  html += '</tbody></table>';
  out.innerHTML = html;

  out.querySelectorAll("button[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var obj = toKc3(rows[+b.getAttribute("data-copy")]);
      navigator.clipboard.writeText(JSON.stringify(obj)).then(function () {
        var t = b.textContent; b.textContent = "已複製 ✓";
        setTimeout(function () { b.textContent = t; }, 1500);
      });
    });
  });
  out.querySelectorAll("button[data-open]").forEach(function (b) {
    b.addEventListener("click", function () {
      var obj = toKc3(rows[+b.getAttribute("data-open")]);
      // battleplayer 支援以 URL hash 帶入重播資料；長度過大時退回「先複製、再開空白頁貼上」。
      var payload = encodeURIComponent(JSON.stringify(obj));
      var url = BATTLEPLAYER + "#" + payload;
      if (url.length < 30000) { window.open(url, "_blank"); return; }
      navigator.clipboard.writeText(JSON.stringify(obj)).then(function () {
        window.open(BATTLEPLAYER, "_blank");
        alert("此場資料較大，已複製 battleplayer 物件到剪貼簿——在開啟的重播頁貼上即可。");
      });
    });
  });
}

document.getElementById("f").addEventListener("change", function (e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var env = JSON.parse(reader.result);
      replays = (env && env.tables && env.tables.replays) || env.replays || [];
      document.getElementById("st").textContent = "已載入 " + replays.length + " 場重播（" + esc(file.name) + "）。";
      render();
    } catch (err) {
      document.getElementById("st").textContent = "解析失敗：" + err;
    }
  };
  reader.readAsText(file);
});
</script>
</body>
</html>`;
}
