#!/usr/bin/env python3
"""改修日程產生器：wikiwiki「改修表」＋ KC3Kai akashi.json → utils/akashi-schedule-data.ts。

── 為什麼需要外部資料 ────────────────────────────────────────────────
改修工廠的可改修清單由「第一艦隊二番艦」與「曜日」決定，遊戲封包只在玩家開啟改修畫面後
才給當天清單，沒有整張週表。兩個來源：
  1. wikiwiki.jp/kancolle 改修表（主要來源，2026-11 仍在更新，約 414 件）。
  2. KC3Kai src/data/akashi.json（MIT，固定 commit；上游 2025-06 起未更新，約 332 件）。
     用來交叉比對，並補 wiki 沒有的裝備（記在 AKASHI_KC3_ONLY）。

── 解析規則（wiki 的「表の読み方」）────────────────────────────────
- 一列裡找連續 7 格 ◯／×（日〜土）；緊接的下一格是二番艦欄。不用固定欄位索引，因為 ★ 段階
  區塊與曜日／二番艦區塊各自有 rowspan。
- 二番艦欄 `-`＝明石單獨；多艘以 <br> 分隔；列出的艦名含其後所有改造形態（aftershipid 與
  api_mst_shipupgrade 的轉換邊），除非同一件裝備另外單獨列出了更進階的形態（較具體者優先）。
- 二番艦格內的 tooltip 註記只認下列語法，其餘一律 raise（不猜）：
  <艦名>は不可／以降は不可／は曜日が異なる／以降は曜日が異なる／まで同じ／は更新先が異なる（忽略），
  艦名可用 ・ 或 / 並列，缺艦名的相對寫法（改二は不可、乙…）以本列基準艦的名稱補全。

只在開發者更新資料時手動執行；擴充執行時不連網。每個來源 1 個請求，快取在
tools/akashi-schedule/.cache/（不進 git）。

用法：
    python3 tools/akashi-schedule/generate.py            # 有快取就不連網
    python3 tools/akashi-schedule/generate.py --offline  # 只讀快取
更新 wiki 資料時刪掉 .cache/wiki-kaishuhyo.html 重跑；更新 KC3 時改 KC3_COMMIT 並更新
THIRD-PARTY-NOTICES.md。
"""
from __future__ import annotations

import datetime
import html
import json
import pathlib
import re
import sys
import unicodedata
import urllib.request

KC3_COMMIT = 'a8a828a907169c833dfe828f38bb2c262aa499a1'
KC3_URL = f'https://raw.githubusercontent.com/KC3Kai/KC3Kai/{KC3_COMMIT}/src/data/akashi.json'
WIKI_URL = 'https://wikiwiki.jp/kancolle/%E6%94%B9%E4%BF%AE%E8%A1%A8'
ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE_DIR = pathlib.Path(__file__).resolve().parent / '.cache'
KC3_CACHE = CACHE_DIR / f'akashi-{KC3_COMMIT[:12]}.json'
WIKI_CACHE = CACHE_DIR / 'wiki-kaishuhyo.html'
OUT = ROOT / 'utils' / 'akashi-schedule-data.ts'
START2 = ROOT / 'samples' / 'start2-master.json'
USER_AGENT = 'Mozilla/5.0 (compatible; akashi-schedule-generator)'

DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
FLAG_ON = {'◯', '○', '〇'}
FLAG_OFF = {'×'}
SOLO = 0
# 玩家艦／裝備的 master id 上限（深海棲艦與深海裝備的 id 從 1501 起，不參與名稱對照）
PLAYER_ID_MAX = 1500

# 明確別名表：wiki 用字與 start2 名稱 NFKC＋大小寫正規化後仍對不上時才加，每筆註明依據。
SHIP_ALIASES: dict[str, str] = {
    # wiki 省略句點；start2 id 629「Fletcher Mk.II」
    'FletcherMkII': 'Fletcher Mk.II',
}
GEAR_ALIASES: dict[str, str] = {
    # wiki 用 e，start2 用 è（id 579、580）
    '13.8cm単装砲 Modele 1927': '13.8cm単装砲 Modèle 1927',
    '55cm三連装魚雷 Modele 1924': '55cm三連装魚雷 Modèle 1924',
}
# 宗谷有三個形態（699→645→650→699 循環），start2 名稱都是「宗谷」，wiki 用括號或註記區分，名稱無法直接對照。
# 依據：wiki 註記「灯台補給船・南極観測船は不可」一次排除兩個名稱，剩下的就是「(特務艦)」；KC3Kai
# akashi.json 對同批裝備（25mm単装機銃、一式陸攻(野中隊)、三式戦 飛燕一型丁、二式複戦 屠龍）只列 699，
# 佐證 699＝(特務艦)、645／650＝另兩個形態（兩個名稱合起來＝{645, 650}；哪個名稱對哪個 id 不影響結果）。
FORM_IDS: dict[str, list[int]] = {
    '宗谷(特務艦)': [699],
    '灯台補給船': [645, 650],
    '南極観測船': [645, 650],
}


# ── 抓取 ───────────────────────────────────────────────────────────────
def fetch(url: str, cache: pathlib.Path, offline: bool, headers: dict | None = None) -> str:
    if cache.exists():
        return cache.read_text(encoding='utf-8')
    if offline:
        sys.exit(f'找不到快取：{cache}')
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode('utf-8')
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(text, encoding='utf-8')
    return text


# ── master 對照 ────────────────────────────────────────────────────────
def normalize(name: str) -> str:
    return unicodedata.normalize('NFKC', name).replace(' ', '').replace('　', '').casefold()


class Master:
    """艦／裝備名稱對照，以及艦的改造形態圖（aftershipid ＋ shipupgrade 轉換邊）。"""

    def __init__(self) -> None:
        text = START2.read_text(encoding='utf-8')
        data = json.loads(text[text.index('{'):])
        data = data.get('api_data', data)
        ships = [s for s in data['api_mst_ship'] if s['api_id'] <= PLAYER_ID_MAX]
        self.ship_name = {s['api_id']: s['api_name'] for s in ships}
        self.ship_ids: dict[str, list[int]] = {}
        for ship in ships:
            self.ship_ids.setdefault(normalize(ship['api_name']), []).append(ship['api_id'])
        self.gear_name = {g['api_id']: g['api_name'] for g in data['api_mst_slotitem'] if g['api_id'] <= PLAYER_ID_MAX}
        self.gear_ids: dict[str, list[int]] = {}
        for gid, name in self.gear_name.items():
            self.gear_ids.setdefault(normalize(name), []).append(gid)
        self.next: dict[int, set[int]] = {sid: set() for sid in self.ship_name}
        for ship in ships:
            after = str(ship.get('api_aftershipid') or '0')
            if after.isdigit() and int(after) in self.next and int(after) != 0:
                self.next[ship['api_id']].add(int(after))
        # api_mst_shipupgrade：api_id 是轉換後的艦，api_current_ship_id 是轉換前（0＝無）。
        # 其中與 aftershipid 重疊的是一般改造，其餘是改装換型（例：翔鶴改二甲⇔改二）。
        self.original: dict[int, int] = {}
        self.convert_edges = 0
        for up in data['api_mst_shipupgrade']:
            if up['api_id'] in self.ship_name and up['api_original_ship_id'] in self.ship_name:
                self.original[up['api_id']] = up['api_original_ship_id']
            cur, dst = up['api_current_ship_id'], up['api_id']
            if cur in self.next and dst in self.ship_name:
                if dst not in self.next[cur]:
                    self.convert_edges += 1
                self.next[cur].add(dst)
        self._desc: dict[int, frozenset[int]] = {}

    def desc(self, sid: int) -> frozenset[int]:
        """sid 與其後所有形態（含改装換型；圖可能有環，故用已訪問集合）。"""
        if sid not in self._desc:
            seen: set[int] = set()
            stack = [sid]
            while stack:
                cur = stack.pop()
                if cur in seen:
                    continue
                seen.add(cur)
                stack.extend(self.next[cur])
            self._desc[sid] = frozenset(seen)
        return self._desc[sid]

    def base(self, sid: int) -> int:
        """改造鏈起點：以 api_mst_shipupgrade 的 api_original_ship_id 為準；沒有該筆時沿 aftershipid 往回推
        （環狀鏈在回到已走過的艦時停止，取當時的艦）。"""
        if sid in self.original:
            return self.original[sid]
        prev: dict[int, list[int]] = {}
        for src, dsts in self.next.items():
            for dst in dsts:
                prev.setdefault(dst, []).append(src)
        seen = {sid}
        while True:
            back = [p for p in prev.get(sid, []) if p not in seen]
            if not back:
                return sid
            sid = min(back)
            seen.add(sid)
            if sid in self.original:
                return self.original[sid]

    def find_ships(self, name: str) -> list[int]:
        if name in FORM_IDS:
            return FORM_IDS[name]
        key = normalize(SHIP_ALIASES.get(name, name))
        return self.ship_ids.get(key, [])

    def find_gear(self, name: str) -> list[int]:
        key = normalize(GEAR_ALIASES.get(name, name))
        return self.gear_ids.get(key, [])


# ── wiki 解析 ──────────────────────────────────────────────────────────
TAG = re.compile(r'<[^>]+>')
TOOLTIP = re.compile(r'<span class="tooltip"[^>]*data-tooltip-content="([^"]*)"[^>]*>.*?</span>', re.S)
BR = re.compile(r'<br[^>]*>')
CELL = re.compile(r'<(td|th)(?:\s[^>]*)?>(.*?)</\1>', re.S)
NOTE = re.compile(r'^(?P<items>.+?)(?P<kind>以降は不可|は不可|以降は曜日が異なる|は曜日が異なる|まで同じ|は更新先が異なる)$')


def text_of(cell_html: str) -> str:
    return html.unescape(TAG.sub('', cell_html)).strip()


class Entry:
    """wiki 一列的一條二番艦記載：基準艦（None＝明石單獨）、七天旗標與註記。"""

    def __init__(self, gear: str, base: str | None, bits: int, notes: list[str]) -> None:
        self.gear, self.base, self.bits, self.notes = gear, base, bits, notes


QUALIFIER = re.compile(r'^<span class="wikicolor"[^>]*>[^<]*</span>$')


def parse_helper_cell(cell_html: str, master: Master) -> list[tuple[str, list[str]]]:
    """二番艦欄 → [(艦名, [註記])]；用 <br> 切行，tooltip 的 `*` 不屬於艦名。

    整行只有一個 wikicolor span 時有兩種可能：上一行艦名的形態後綴（加賀<br>改二護、宗谷<br>(特務艦)），
    或新上場的艦名（<br>丹陽）。只有「單獨不是艦名、與上一行相連才是艦名」時才併成後綴。
    """
    result: list[tuple[str, list[str]]] = []
    for line in BR.split(cell_html):
        notes = [text_of(n) for n in TOOLTIP.findall(line)]
        bare = TOOLTIP.sub('', line).strip()
        name = text_of(bare)
        if QUALIFIER.match(bare) and result and not master.find_ships(name) and master.find_ships(result[-1][0] + name):
            result[-1] = (result[-1][0] + name, result[-1][1] + notes)
        elif name:
            result.append((name, notes))
        elif notes:
            raise ValueError(f'tooltip 沒有對應艦名：{notes}')
    return result


def parse_wiki(page: str, master: Master) -> tuple[list[Entry], list[str], list[str]]:
    """回傳（所有記載, 裝備出現順序, 旗標未填而略過的列）。

    wiki 尚未確認的列用 `-` 佔位（例：× - - ◯ × × ×），整列旗標不完整，不能當成 ×，故略過並列出。
    """
    entries: list[Entry] = []
    order: list[str] = []
    skipped: list[str] = []
    gear = ''
    for table in re.findall(r'<table.*?</table>', page, re.S):
        for row in re.findall(r'<tr[ >].*?</tr>', table, re.S):
            cells = [(m.group(1), m.group(2)) for m in CELL.finditer(row)]
            if len(cells) >= 2 and text_of(cells[1][1]) == '初期':
                gear = text_of(cells[0][1])
                order.append(gear)
            flags = [text_of(c[1]) for c in cells]
            for i in range(len(cells) - 7):
                run = flags[i:i + 7]
                if all(f in FLAG_ON or f in FLAG_OFF for f in run):
                    if not gear:
                        raise ValueError('旗標列之前沒有裝備名')
                    bits = sum(1 << d for d, f in enumerate(run) if f in FLAG_ON)
                    for name, notes in parse_helper_cell(cells[i + 7][1], master):
                        entries.append(Entry(gear, None if name == '-' else name, bits, notes))
                    break
            else:
                for i in range(len(cells) - 7):
                    run = flags[i:i + 7]
                    if '-' in run and all(f in FLAG_ON or f in FLAG_OFF or f == '-' for f in run):
                        skipped.append(f'{gear} / {text_of(cells[i + 7][1])}')
                        break
    return entries, order, skipped


# ── 展開 ───────────────────────────────────────────────────────────────
def resolve_item(master: Master, item: str, prefix_sources: list[str], note: str) -> list[int]:
    """註記中的一個形態名稱：先當完整艦名；不行就把它當後綴，接在基準艦名／前一項的各個前綴後。"""
    ids = master.find_ships(item)
    if ids:
        return ids
    found: dict[frozenset[int], str] = {}
    for source in prefix_sources:
        for k in range(len(source), 0, -1):
            hit = master.find_ships(source[:k] + item)
            if hit:
                found[frozenset(hit)] = source[:k] + item
                break
    if len(found) != 1:
        raise ValueError(f'無法解析 tooltip「{note}」的項目「{item}」（候選 {list(found.values())}）')
    return list(next(iter(found)))


def expand(master: Master, entry: Entry, ids: list[int]) -> set[int]:
    covered: set[int] = set()
    for sid in ids:
        covered |= master.desc(sid)
    for note in entry.notes:
        match = NOTE.match(note)
        if not match:
            raise ValueError(f'未知的 tooltip 寫法：「{note}」（{entry.gear} / {entry.base}）')
        kind = match['kind']
        if kind == 'は更新先が異なる':
            continue
        targets: list[int] = []
        sources = [entry.base or '']
        for item in re.split(r'[/・]', match['items']):
            hit = resolve_item(master, item, sources, note)
            targets += hit
            sources = [entry.base or '', master.ship_name[hit[0]]]
        subtree: set[int] = set().union(*(master.desc(t) for t in targets))
        if kind == 'まで同じ':
            covered -= subtree - set(targets)
        elif kind.startswith('以降'):
            covered -= subtree
        else:
            covered -= set(targets)
    return covered


def build_wiki(master: Master, entries: list[Entry], unmatched_ships: set[str]) -> dict[str, dict[int, int]]:
    """裝備名 → {二番艦 id（0＝單獨）: 週位元}。

    同一艦可被多條記載涵蓋時，只取「較具體」的記載（其基準艦是另一條基準艦的後續形態）；
    互為轉換的形態（環）視為同層。對應 wiki 例 5：陸奥 ◯、陸奥改二 × → 陸奥改二當天不可。
    """
    by_gear: dict[str, list[tuple[Entry, list[int], set[int]]]] = {}
    for entry in entries:
        if entry.base is None:
            by_gear.setdefault(entry.gear, []).append((entry, [], set()))
            continue
        ids = master.find_ships(entry.base)
        if not ids:
            unmatched_ships.add(entry.base)
            continue
        by_gear.setdefault(entry.gear, []).append((entry, ids, expand(master, entry, ids)))
    result: dict[str, dict[int, int]] = {}
    for gear, items in by_gear.items():
        table: dict[int, int] = {}
        for entry, ids, covered in items:
            if entry.base is None:
                table[SOLO] = table.get(SOLO, 0) | entry.bits
        helpers = [it for it in items if it[0].base is not None]
        for sid in {s for it in helpers for s in it[2]}:
            cand = [it for it in helpers if sid in it[2]]

            def strictly_deeper(a, b) -> bool:  # a 比 b 更具體
                return any(x in master.desc(y) and y not in master.desc(x) for x in a[1] for y in b[1])

            keep = [c for c in cand if not any(strictly_deeper(o, c) for o in cand if o is not c)]
            bits = 0
            for entry, _, _ in keep:
                bits |= entry.bits
            if bits:
                table[sid] = bits
        result[gear] = table
    return result


# ── 主程式 ─────────────────────────────────────────────────────────────
def kc3_table(kc3: dict, master: Master) -> dict[int, dict[int, int]]:
    """KC3Kai 的 akashi.json → {裝備: {二番艦: 週位元}}。

    KC3Kai 用「明石」「明石改」出現在清單內表示當天明石單獨即可；與 wiki 的「二番艦欄 -」逐日核對，
    兩邊所有（裝備, 曜日）都一致，故換成 SOLO(0)。
    """
    akashi = set(master.find_ships('明石')) | set(master.find_ships('明石改'))
    table: dict[int, dict[int, int]] = {}
    for d, day in enumerate(DAYS):
        for gear, ships in kc3[day].items():
            row = table.setdefault(int(gear), {})
            for sid in ships:
                sid = SOLO if sid in akashi else sid
                row[sid] = row.get(sid, 0) | (1 << d)
    return table


def main() -> None:
    offline = '--offline' in sys.argv
    master = Master()
    page = fetch(WIKI_URL, WIKI_CACHE, offline, {'User-Agent': USER_AGENT})
    kc3 = json.loads(fetch(KC3_URL, KC3_CACHE, offline))
    modified = re.search(r'Last-modified:\s*(\d{4}-\d{2}-\d{2})\s*\([^)]*\)\s*(\d{2}:\d{2}:\d{2})', page)
    if not modified:
        sys.exit('找不到 wiki 的 Last-modified')
    wiki_modified = f'{modified.group(1)} {modified.group(2)}'

    entries, order, skipped = parse_wiki(page, master)
    unmatched_ships: set[str] = set()
    wiki = build_wiki(master, entries, unmatched_ships)

    # 裝備名 → id（名稱對不到或同名多筆者不收，列出）
    unmatched_gear: list[str] = []
    ambiguous_gear: list[str] = []
    wiki_by_id: dict[int, dict[int, int]] = {}
    for name in dict.fromkeys(order):
        ids = master.find_gear(name)
        if not ids:
            unmatched_gear.append(name)
        elif len(ids) > 1:
            ambiguous_gear.append(f'{name} {ids}')
        else:
            wiki_by_id[ids[0]] = wiki.get(name, {})
    kc3_by_id = kc3_table(kc3, master)

    # 交叉比對：兩邊都有的裝備，逐（曜日, 二番艦）比對集合；wiki 的單獨（0）不在 KC3 內，不比
    both = sorted(set(wiki_by_id) & set(kc3_by_id))
    same = diff = 0
    gear_same = 0
    samples: list[str] = []
    kc3_samples: list[str] = []
    wiki_extra = kc3_extra = 0
    for gid in both:
        w, k = wiki_by_id[gid], kc3_by_id[gid]
        all_same = True
        for d in range(7):
            ws = {s for s, b in w.items() if b >> d & 1}
            ks = {s for s, b in k.items() if b >> d & 1}
            if ws == ks:
                same += 1
                continue
            diff += 1
            all_same = False
            wiki_extra += len(ws - ks)
            kc3_extra += len(ks - ws)
            names = lambda ids: sorted(master.ship_name.get(i, '單獨') for i in ids)
            line = f'  {master.gear_name[gid]}({gid}) {DAYS[d]}: wiki 獨有 {names(ws - ks)}、KC3 獨有 {names(ks - ws)}'
            if len(samples) < 20:
                samples.append(line)
            if ks - ws and len(kc3_samples) < 20:
                kc3_samples.append(line)
        gear_same += all_same
    print(f'wiki：{len(wiki_by_id)} 件（Last-modified {wiki_modified}）；KC3Kai：{len(kc3_by_id)} 件；兩邊都有：{len(both)} 件')
    print(f'交叉比對（曜日×裝備）：一致 {same}、差異 {diff}；整件裝備七天全一致 {gear_same}／{len(both)}')
    print(f'差異內（曜日×二番艦）：wiki 獨有 {wiki_extra} 筆、KC3 獨有 {kc3_extra} 筆')
    print('前 20 筆差異：\n' + '\n'.join(samples))
    print('前 20 筆 KC3 獨有（wiki 缺）的差異：\n' + '\n'.join(kc3_samples))
    wiki_only = len(set(wiki_by_id) - set(kc3_by_id))
    kc3_only = sorted(set(kc3_by_id) - set(wiki_by_id))
    print(f'只有 wiki：{wiki_only} 件；只有 KC3Kai（補進產生物）：{len(kc3_only)} 件')
    print(f'改装換型邊（不在 aftershipid 內）：{master.convert_edges} 條')
    print(f'wiki 旗標未填（含 -）而略過的列（{len(skipped)}）：{skipped}')
    print(f'wiki 對不到 start2 的艦名（{len(unmatched_ships)}）：{sorted(unmatched_ships)}')
    print(f'wiki 對不到 start2 的裝備名（{len(unmatched_gear)}）：{unmatched_gear}')
    print(f'wiki 同名多筆的裝備（{len(ambiguous_gear)}）：{ambiguous_gear}')

    merged = {gid: table for gid, table in wiki_by_id.items() if table}
    for gid in kc3_only:
        merged[gid] = kc3_by_id[gid]
    unconfirmed = sorted(gid for gid, table in wiki_by_id.items() if not table and gid not in merged)
    helpers = sorted({sid for table in merged.values() for sid in table if sid != SOLO})
    helper_base = ','.join(f'[{sid},{master.base(sid)}]' for sid in helpers)
    print(f'旗標未確認的裝備：{[(g, master.gear_name[g]) for g in unconfirmed]}；二番艦形態歸併 {len(helpers)} 筆、起點 {len({master.base(h) for h in helpers})} 個')
    rows = []
    for gid in sorted(merged):
        pairs = ','.join(f'[{sid},{bits}]' for sid, bits in sorted(merged[gid].items()))
        rows.append(f'[{gid},[{pairs}]]')
    OUT.write_text(
        '// 改修日程資料（純資料，無 chrome.*）。\n'
        '//\n'
        '// **本檔由 tools/akashi-schedule/generate.py 產生，請勿手改**——來源為 wikiwiki.jp/kancolle 改修表\n'
        f'// （Last-modified {wiki_modified}）與 KC3Kai src/data/akashi.json（固定 commit {KC3_COMMIT}）。\n'
        '// 艦名、裝備名已依 samples/start2-master.json 換成 master id；二番艦已展開改造形態。\n'
        '// 判定與查詢見 utils/akashi-schedule.ts。\n'
        '\n'
        '/** 產生物，勿手改。來源與產生方式見 tools/akashi-schedule/。 */\n'
        'export const AKASHI_SOURCE = {\n'
        f"    kc3Commit: '{KC3_COMMIT}', wikiLastModified: '{wiki_modified}', generatedAt: '{datetime.date.today().isoformat()}',\n"
        '} as const;\n'
        '\n'
        '/** 週位元：bit0=週日 … bit6=週六（JST）。 */\n'
        'export const AKASHI_SOLO = 0;\n'
        '\n'
        '/**\n'
        ' * 每件可改修裝備一筆：[裝備 master id, [[二番艦 master id, 週位元], ...]]。\n'
        ' * 二番艦 master id 為 AKASHI_SOLO(0) 代表該些曜日明石單獨即可改修。\n'
        ' * 艦 id 已展開改造形態；來源僅 KC3Kai 的條目另記於 AKASHI_KC3_ONLY。\n'
        ' */\n'
        'export const AKASHI_SCHEDULE: readonly (readonly [number, readonly (readonly [number, number])[]])[] = [\n'
        + ''.join(f'    {r},\n' for r in rows)
        + '];\n'
        '\n'
        '/** 只有 KC3Kai 有、wiki 對不到的裝備 master id（資料可能較舊）。 */\n'
        f'export const AKASHI_KC3_ONLY: readonly number[] = {json.dumps(kc3_only)};\n'
        '\n'
        '/** 表內有這件裝備，但 wiki 的曜日旗標尚未確認（不是「不能改修」）。 */\n'
        f'export const AKASHI_UNCONFIRMED: readonly number[] = {json.dumps(unconfirmed)};\n'
        '\n'
        '/**\n'
        ' * 二番艦 master id → 該艦改造鏈的起點 master id，涵蓋表內出現過的所有二番艦。\n'
        ' * 起點取 api_mst_shipupgrade 的 api_original_ship_id；沒有該筆時沿 api_aftershipid 往回推。\n'
        ' */\n'
        f'export const AKASHI_HELPER_BASE: readonly (readonly [number, number])[] = [{helper_base}];\n',
        encoding='utf-8',
    )
    print(f'{OUT.relative_to(ROOT)}：{len(merged)} 件裝備')


if __name__ == '__main__':
    main()
