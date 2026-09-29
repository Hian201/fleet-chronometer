#!/usr/bin/env python3
"""任務開放關係產生器：wikiwiki 任務總表＋ぜかまし任務攻略 → utils/quest-graph-data.ts。

── 為什麼需要外部資料 ────────────────────────────────────────────────
遊戲的 questlist 只列出目前可接受／受注中的任務，不告訴我們「哪個任務開放哪個任務」。
- wikiwiki 任務表的「開放条件/備考」欄以固定句型記錄前置，例如：
      (A52)海上突入部隊を編成せよ！ 及び 【検証中】(Bw9)南方海域珊瑚諸島沖の制空権を握れ！ 達成後
  解析成「子句 AND、子句內 OR」的條件，並逐條保留【検証中】等驗證標記。
- ぜかまし每篇任務攻略以「前提に…あり。後続に…あり。」列出實際遊玩確認的前後任務（見 zekamashi.py），
  作為獨立來源與 wiki 交叉比對。

── 抓取頻率 ────────────────────────────────────────────────────────
只在開發者更新任務資料時手動執行；擴充執行時不連網（正式 build 沒有 host_permissions）。
wikiwiki 每次 1 個請求；ぜかまし第一次約 850 個請求，之後只抓 sitemap lastmod 有變動的文章，
請求間隔至少 2 秒。所有頁面都快取在 tools/quest-graph/.cache/（不進 git）。請勿排程或迴圈呼叫。

── 來源與授權 ──────────────────────────────────────────────────────
https://wikiwiki.jp/kancolle/任務、https://zekamashi.net/ （見 THIRD-PARTY-NOTICES.md）。
只輸出任務 api_no 之間的關係與驗證旗標這類事實，不收錄頁面文字。
wiki 代號 → api_no 的對照沿用 utils/quest-catalog-data.ts 的目錄。
另讀 poi-plugin-quest-planner（MIT）固定 commit 的 data/quests.json，作為 poi 前置的新版（1 個請求，快取），
以及 tsukinohashi 艦これ単発任務マネージャ的 main.js（1 個請求，快取；只作衝突時的額外引用）、
舰娘百科任務總表（1 個請求，快取；該站 Crawl-delay 100，不逐頁抓）、KC3 kc3-translations 日文任務表
（固定 commit，補目錄缺的代號與名稱）。

用法：
    python3 tools/quest-graph/generate.py              # 抓 wikiwiki 總表 1 頁＋ぜかまし有更新的文章（增量）
    python3 tools/quest-graph/generate.py --offline    # 只讀 tools/quest-graph/.cache/，完全不連網（調整解析器時用）
"""
from __future__ import annotations

import datetime
import difflib
import html
import json
import re
import sys
import unicodedata
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

import zekamashi

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / 'utils' / 'quest-catalog-data.ts'
OUT = ROOT / 'utils' / 'quest-graph-data.ts'
URL = 'https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99'
USER_AGENT = 'fleet-chronometer quest-graph generator (manual, one request per run)'

# 邊旗標
EDGE_PENDING = 1          # 該前置標了【検証中】／【要確認】／(反証待ち)
# 條件旗標
COND_EXTRA_UNKNOWN = 1    # 另有未列出的前置（「他」或空白的「()」）
COND_UNCERTAIN = 2        # 整個條件帶問號（「達成後？」「他？」），所有邊視為待驗證
COND_UNRESOLVED = 4       # 引用了無法對到 api_no 的 wiki 代號

REF = re.compile(r'\(\s*([0-9A-Za-z]*)\s*\)')
MARKER = re.compile(r'【(?:検証中|要確認)】|\(反証待ち\)')
CONNECTOR = re.compile(r'及び|または|もしくは')
ID_CELL = re.compile(r'^[0-9A-Za-z]*[A-Za-z][0-9A-Za-z]*\d$')


class TableGrid(HTMLParser):
    """把頁面上每張表展開成二維文字網格（處理 rowspan／colspan）。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self.headings: list[str] = []   # 與 tables 同序：表格之前最近的 h2～h4 標題
        self._stack: list[dict] = []
        self._cell: list[str] | None = None
        self._heading: list[str] | None = None
        self._last_heading = ''

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('h2', 'h3', 'h4') and not self._stack:
            self._heading = []
        elif tag == 'table':
            self._stack.append({'rows': [], 'pending': {}, 'row': None, 'heading': self._last_heading})
        elif not self._stack:
            return
        elif tag == 'tr':
            self._stack[-1]['row'] = []
        elif tag in ('td', 'th'):
            self._cell = []
            self._span = (int(a.get('rowspan') or 1), int(a.get('colspan') or 1))
        elif tag == 'br' and self._cell is not None:
            self._cell.append('\n')

    def handle_endtag(self, tag):
        if tag in ('h2', 'h3', 'h4') and self._heading is not None:
            self._last_heading = ''.join(self._heading).strip()
            self._heading = None
            return
        if not self._stack:
            return
        t = self._stack[-1]
        if tag in ('td', 'th') and self._cell is not None and t['row'] is not None:
            text = ''.join(self._cell).strip()
            rowspan, colspan = self._span
            t['row'].append((text, rowspan, colspan))
            self._cell = None
        elif tag == 'tr' and t['row'] is not None:
            self._place(t)
            t['row'] = None
        elif tag == 'table':
            table = self._stack.pop()
            self.tables.append(table['rows'])
            self.headings.append(table['heading'])

    def handle_data(self, data):
        if self._heading is not None:
            self._heading.append(data)
        if self._cell is not None:
            self._cell.append(data)

    @staticmethod
    def _place(t: dict) -> None:
        # pending[col] = (剩餘列數, 文字)：上方 rowspan 延伸下來的格子
        pending: dict[int, tuple[int, str]] = t['pending']
        out: list[str] = []
        col = 0
        cells = list(t['row'])
        while cells or col in pending:
            if col in pending:
                left, text = pending.pop(col)
                out.append(text)
                if left > 1:
                    pending[col] = (left - 1, text)
                col += 1
                continue
            text, rowspan, colspan = cells.pop(0)
            for _ in range(colspan):
                out.append(text)
                if rowspan > 1:
                    pending[col] = (rowspan - 1, text)
                col += 1
        t['rows'].append(out)


def norm(text: str) -> str:
    text = unicodedata.normalize('NFKC', text)
    return re.sub(r'[\s!！?？、。・「」『』【】()（）\[\]]', '', text)


def other_prerequisites() -> dict[int, set[int]]:
    """目錄裡 poi 前置與 KC3 開放邊（api_no → 前置集合），供ぜかまし同名任務消歧。"""
    src = CATALOG.read_text(encoding='utf-8')
    raw = json.loads(re.search(r'QUEST_CATALOG_RAW = (\[.*?\]) as const', src, re.S).group(1))
    unlocks = json.loads(re.search(r'KC3_UNLOCKS_RAW = (\[.*?\]) as const', src, re.S).group(1))
    result: dict[int, set[int]] = {entry[0]: set(entry[10]) for entry in raw}
    for source, targets in unlocks:
        for target in targets:
            result.setdefault(target, set()).add(source)
    return result


KC3_TRANSLATIONS_COMMIT = '74b37f83b52df52bb4d76f62e4463603fcc7ec3a'
KC3_QUESTS = Path(__file__).with_name('.cache') / f'kc3-quests-jp-{KC3_TRANSLATIONS_COMMIT[:12]}.json'


def kc3_quests(offline: bool = True) -> dict[int, tuple[str, str]]:
    """KC3Kai kc3-translations 的日文任務表：api_no → (wiki 代號, 任務名)。固定 commit，與 THIRD-PARTY-NOTICES 登錄相同。"""
    if not KC3_QUESTS.exists():
        if offline:
            return {}
        url = f'https://raw.githubusercontent.com/KC3Kai/kc3-translations/{KC3_TRANSLATIONS_COMMIT}/data/jp/quests.json'
        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            KC3_QUESTS.parent.mkdir(parents=True, exist_ok=True)
            KC3_QUESTS.write_bytes(response.read())
    data = json.loads(KC3_QUESTS.read_text(encoding='utf-8'))
    return {int(no): (value.get('code') or '', value.get('name') or '') for no, value in data.items() if no.isdigit()}


# 目錄有 api_no 卻缺 wiki 代號／名稱的任務（例：1020＝2409B1「第三戦隊」緊急展開！），
# 由 KC3 任務表補上，供代號解析與 UI 顯示；main() 會輸出成 QUEST_CATALOG_SUPPLEMENT_RAW。
SUPPLEMENT: dict[int, tuple[str, str]] = {}
# api_no → 現行 wiki 代號（目錄 wikiIds 的第一個；其餘是改號前的舊代號）
PRIMARY_CODE: dict[int, str] = {}


def load_catalog() -> tuple[dict[str, list[tuple[int, str]]], dict[int, str]]:
    src = CATALOG.read_text(encoding='utf-8')
    raw = json.loads(re.search(r'QUEST_CATALOG_RAW = (\[.*?\]) as const', src, re.S).group(1))
    # 目錄原始名稱有簡體殘留時，TS 端以 QUEST_CATALOG_TEXT_OVERRIDES 修正；比對名稱也要用修正後的
    overrides = {int(no): name for no, name in re.findall(r"(\d+): \{\s*name: '([^']*)'", src)}
    by_wiki: dict[str, list[tuple[int, str]]] = {}
    names: dict[int, str] = {}
    kc3 = kc3_quests()
    for entry in raw:
        api_no, wiki_ids = entry[0], list(entry[1])
        name = overrides.get(api_no, entry[2])
        code, kc3_name = kc3.get(api_no, ('', ''))
        if (not wiki_ids and code) or (not name and kc3_name):
            SUPPLEMENT[api_no] = (code if not wiki_ids else '', kc3_name if not name else '')
            if not wiki_ids and code:
                wiki_ids = [code]
            name = name or kc3_name
        names[api_no] = name
        if wiki_ids:
            PRIMARY_CODE[api_no] = wiki_ids[0]
        for wiki_id in wiki_ids:
            by_wiki.setdefault(wiki_id, []).append((api_no, name))
    return by_wiki, names


def same_name(a: str, b: str) -> bool:
    # 目錄原始名稱有異體字與少數簡體殘留（例：疾風怒涛／濤、演習／演习），只要求高度相似
    a, b = norm(a), norm(b)
    return a == b or a.startswith(b) or b.startswith(a) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def resolve(wiki_id: str, name: str, by_wiki, names) -> int | None:
    """wiki 代號可能因改號或目錄別名錯誤而對到別的任務；有名稱時必須名稱相符，否則不猜。"""
    candidates = by_wiki.get(wiki_id, [])
    if norm(name):
        named = [no for no, n in candidates if not n or same_name(n, name)]
        return named[0] if len(named) == 1 else None
    return candidates[0][0] if len(candidates) == 1 else None


def parse_condition(text: str, by_wiki, names) -> tuple[list[list[list[int]]], int, list[str]] | None:
    """回傳 (子句, 條件旗標, 無法對應的代號)；沒有任何前置引用時回傳 None。"""
    end = text.find('達成後')
    if end < 0:
        return None
    head = text[:end]
    tail = text[end + 3:end + 5]
    flags = 0
    if tail[:1] in ('?', '？'):
        flags |= COND_UNCERTAIN
    if re.search(r'他\s*[?？]', head):
        flags |= COND_UNCERTAIN

    clauses: list[list[list[int]]] = [[]]
    unresolved: list[str] = []
    pending = False
    last_edge: list[int] | None = None
    pos = 0
    tokens = re.compile(r'【(?:検証中|要確認)】|\(反証待ち\)|\(\s*[0-9A-Za-z]*\s*\)|及び|または|もしくは|他')
    matches = list(tokens.finditer(head))
    for i, m in enumerate(matches):
        tok = m.group(0)
        if MARKER.fullmatch(tok):
            pending = True
        elif tok == '及び':
            # 標記後面緊接連接詞而沒有引用時，標記屬於前一個前置（例：「(B159)… 【検証中】 及び (Cy11)」）
            if pending and last_edge is not None:
                last_edge[1] |= EDGE_PENDING
                pending = False
            if clauses[-1]:
                clauses.append([])
        elif tok in ('または', 'もしくは'):
            if pending and last_edge is not None:
                last_edge[1] |= EDGE_PENDING
                pending = False
        elif tok == '他':
            flags |= COND_EXTRA_UNKNOWN
            pending = False
        else:
            wiki_id = REF.fullmatch(tok).group(1)
            if not wiki_id:
                flags |= COND_EXTRA_UNKNOWN
                pending = False
                continue
            # 引用後到下一個記號之前的文字是任務名稱
            stop = matches[i + 1].start() if i + 1 < len(matches) else len(head)
            name = head[m.end():stop]
            no = resolve(wiki_id, name, by_wiki, names)
            if no is None:
                flags |= COND_UNRESOLVED
                unresolved.append(wiki_id)
                pending = False
                continue
            last_edge = [no, EDGE_PENDING if pending else 0]
            clauses[-1].append(last_edge)
            pending = False
        pos = m.end()
    clauses = [c for c in clauses if c]
    if not clauses and not unresolved and not flags & COND_EXTRA_UNKNOWN:
        return None
    if flags & COND_UNCERTAIN:
        for clause in clauses:
            for edge in clause:
                edge[1] |= EDGE_PENDING
    return clauses, flags, unresolved


WIKI_CACHE = Path(__file__).with_name('.cache') / 'wikiwiki-quests.html'


def wiki_page(offline: bool) -> str:
    if offline:
        return WIKI_CACHE.read_text(encoding='utf-8')
    request = urllib.request.Request(URL, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        page = response.read().decode('utf-8')
    WIKI_CACHE.parent.mkdir(parents=True, exist_ok=True)
    WIKI_CACHE.write_text(page, encoding='utf-8')
    return page


TABLE_PERIODS = [
    ('単発', 'once'), ('デイリー', 'daily'), ('ウィークリー', 'weekly'),
    ('マンスリー', 'monthly'), ('クォータリー', 'quarterly'), ('イヤーリー', 'yearly'),
]


def parse_wiki(page: str, by_wiki, names) -> tuple[dict[int, tuple], dict[int, str]]:
    """回傳 ({api_no: (子句, 條件旗標, 無法對應代號)}, {api_no: wiki 任務名})。"""
    parser = TableGrid()
    parser.feed(page)
    result: dict[int, tuple] = {}
    wiki_names: dict[int, str] = {}
    seen_rows = 0
    unmapped_rows: list[str] = []
    for rows, heading in zip(parser.tables, parser.headings):
        header = next((r for r in rows if '開放条件/備考' in r), None)
        if header is None or 'ID' not in header:
            continue
        id_col, name_col, cond_col = header.index('ID'), header.index('任務名'), header.index('開放条件/備考')
        # 總表依週期分表（「単発 【単】Once」「デイリー 【日】Daily」…）；新着、期間限定等表沒有週期資訊
        period = next((value for key, value in TABLE_PERIODS if heading.startswith(key)), '')
        for row in rows:
            if len(row) <= cond_col or not ID_CELL.match(row[id_col].strip()):
                continue
            # 2023 年定期任務改號後，舊位置留下跨欄合併的「IDを…に変更」佔位列
            if row[cond_col] == row[name_col + 1]:
                continue
            seen_rows += 1
            wiki_id = row[id_col].strip()
            no = resolve(wiki_id, row[name_col], by_wiki, names)
            if no is None:
                unmapped_rows.append(wiki_id)
                continue
            wiki_names[no] = row[name_col].strip()
            parsed = parse_condition(html.unescape(row[cond_col]), by_wiki, names)
            clauses, flags, unresolved = parsed if parsed else ([], 0, [])
            entry = (clauses, flags, unresolved, period)
            if no in result and result[no][:3] == entry[:3]:
                # 同一任務出現在「新着」與週期分表：內容相同時只補上週期
                result[no] = (*entry[:3], period or result[no][3])
                continue
            if no in result and result[no][:3] != entry[:3]:
                # 同一任務出現在「新着」與分類表時內容應一致；不一致時保留有前置的那筆並提示
                print(f'警告：api_no {no}（{wiki_id}）在多張表的開放条件不同', file=sys.stderr)
                if not result[no][0] or (period and not result[no][3]):
                    result[no] = (entry[0] or result[no][0], entry[1] if entry[0] else result[no][1],
                                  entry[2] if entry[0] else result[no][2], period or result[no][3])
                continue
            result[no] = entry

    edges = sum(len(c) for v in result.values() for c in v[0])
    pending = sum(1 for v in result.values() for c in v[0] for e in c if e[1] & EDGE_PENDING)
    print(f'wikiwiki：任務列 {seen_rows}，對到 api_no {len(result)}，前置邊 {edges}（待驗證 {pending}）', file=sys.stderr)
    if unmapped_rows:
        print(f'  目錄沒有的任務列 {len(unmapped_rows)}：{" ".join(unmapped_rows)}', file=sys.stderr)
    unresolved_refs = sorted({r for v in result.values() for r in v[2]})
    if unresolved_refs:
        print(f'  無法對到 api_no 的前置代號 {len(unresolved_refs)}：{" ".join(unresolved_refs)}', file=sys.stderr)
    return result, wiki_names


class NameIndex:
    """任務名 → api_no。名稱以目錄（含文字覆寫）與 wikiwiki 任務名為準；同名多筆時視為歧義不對應。"""

    def __init__(self, names: dict[int, str], wiki_names: dict[int, str]) -> None:
        self.by_norm: dict[str, set[int]] = {}
        for source in (names, wiki_names):
            for no, name in source.items():
                if norm(name):
                    self.by_norm.setdefault(norm(name), set()).add(no)
        self.sorted_names = sorted(self.by_norm, key=len, reverse=True)
        self.names = {**names, **wiki_names}

    def name_of(self, no: int) -> str:
        return self.names.get(no, '')

    def candidates(self, name: str) -> set[int]:
        return set(self.by_norm.get(norm(name), set()))

    def exact(self, name: str) -> int | None:
        hits = self.by_norm.get(norm(name), set())
        if len(hits) == 1:
            return next(iter(hits))
        if hits:
            return None
        wanted = norm(name)
        if len(wanted) < 6:
            return None
        close = {no for key, nos in self.by_norm.items()
                 if difflib.SequenceMatcher(None, key, wanted).ratio() >= 0.9 for no in nos}
        return next(iter(close)) if len(close) == 1 else None

    def contained(self, text: str) -> int | None:
        """標題或小標題裡包含的最長任務名（至少 6 字，避免「機種転換」這類短名誤中）。"""
        wanted = norm(text)
        for key in self.sorted_names:
            if len(key) >= 6 and key in wanted:
                hits = self.by_norm[key]
                return next(iter(hits)) if len(hits) == 1 else None
        return None


def parse_zekamashi(articles: dict[str, dict], index: NameIndex, known: dict[int, set[int]]) -> dict[int, tuple[dict[int, int], int, list[str]]]:
    """回傳 {api_no: ({前置 api_no: 邊旗標}, 條件旗標, 無法對應的前提項目名)}。

    前提清單給「前置 → 本任務」，後續清單給「本任務 → 後續」；兩個方向都算同一個來源。
    同一條邊只要有一篇文章明確列出（沒有要確認等註記），就不算待驗證。
    """
    # 別篇文章連到某網址時用的名稱，是該文章最乾淨的任務名
    inbound: dict[str, list[str]] = {}
    for data in articles.values():
        for group in data['groups']:
            for item in group['pre'] + group['post']:
                if item['url']:
                    inbound.setdefault(item['url'], []).append(item['name'])

    def article_no(url: str) -> int | None:
        hits = {index.exact(name) for name in inbound.get(url, [])} - {None}
        data = articles.get(url)
        titled = index.contained(data['title']) if data else None
        if len(hits) == 1:
            return next(iter(hits))
        # 偶有文章用別的任務名連到這篇；分歧時採用同時出現在標題裡的那一個
        if not hits or titled in hits:
            return titled
        return None

    def item_no(item: dict, related: int | None = None) -> int | None:
        no = index.exact(item['name'])
        if no is None and related is not None:
            # 同名任務（例：「特注家具」の調達 ×3）：其他來源已把其中恰好一個列為相關前置時採用它
            hits = index.candidates(item['name']) & known.get(related, set())
            if len(hits) == 1:
                return next(iter(hits))
        if no is None and item['url']:
            # 名稱對不上時才看連結指向哪篇攻略；只接受名稱夠像的（縮寫、異寫），
            # 避免「工廠系デイリー任務をこなそう」這類總覽文章被當成某個任務。
            linked = article_no(item['url'])
            if linked is not None and difflib.SequenceMatcher(
                    None, norm(item['name']), norm(index.name_of(linked))).ratio() >= 0.6:
                no = linked
        return no

    edges: dict[int, dict[int, int]] = {}
    cond: dict[int, int] = {}
    unresolved: dict[int, set[str]] = {}
    unmapped_articles: list[str] = []
    unmapped_items: set[str] = set()

    def add(target: int, source: int, uncertain: bool) -> None:
        if target == source:
            return
        current = edges.setdefault(target, {})
        flag = EDGE_PENDING if uncertain else 0
        # 任一篇明確列出就視為確定
        current[source] = current.get(source, flag) & flag

    for url, data in articles.items():
        for position, group in enumerate(data['groups']):
            # 第一組在「任務情報」段落，屬於文章本身的任務；後面的組只有小標題寫出任務名時才採用，
            # 「まとめ」「旧編成」或裝備名等小標題下的是重述，略過。
            no = index.contained(group['heading'])
            if no is None and position == 0:
                no = article_no(url)
            if no is None:
                if position == 0:
                    unmapped_articles.append(f'{url.rstrip("/").rsplit("/", 1)[-1]}（{data["title"][:30]}）')
                continue
            edges.setdefault(no, {})
            if group['pre_unknown']:
                cond[no] = cond.get(no, 0) | COND_EXTRA_UNKNOWN
            for item in group['pre']:
                source = item_no(item, related=no)
                if source is None:
                    unmapped_items.add(item['name'])
                    cond[no] = cond.get(no, 0) | COND_UNRESOLVED
                    unresolved.setdefault(no, set()).add(item['name'])
                    continue
                add(no, source, item['uncertain'] or group['pre_uncertain'])
            for item in group['post']:
                target = item_no(item)
                if target is None:
                    # 後續方向：候選任務中，其他來源已把本任務列為前置的那一個
                    hits = {c for c in index.candidates(item['name']) if no in known.get(c, set())}
                    target = next(iter(hits)) if len(hits) == 1 else None
                if target is None:
                    unmapped_items.add(item['name'])
                    continue
                add(target, no, item['uncertain'] or group['post_uncertain'])

    result = {no: (targets, cond.get(no, 0), sorted(unresolved.get(no, set()))) for no, targets in edges.items()}
    total = sum(len(v[0]) for v in result.values())
    pending = sum(1 for v in result.values() for f in v[0].values() if f & EDGE_PENDING)
    print(f'ぜかまし：文章 {len(articles)} 篇，對到 api_no {len(result)}，前置邊 {total}（待驗證 {pending}）', file=sys.stderr)
    print(f'  無法對應任務的文章段落 {len(unmapped_articles)}（多為目錄未收錄的期間限定任務）', file=sys.stderr)
    print(f'  無法對應的前提／後續項目 {len(unmapped_items)}', file=sys.stderr)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({
        'unmapped_articles': sorted(unmapped_articles),
        'unmapped_items': sorted(unmapped_items),
    }, ensure_ascii=False, indent=1), encoding='utf-8')
    return result


REPORT = Path(__file__).with_name('.cache') / 'zekamashi-unmapped.json'

# poi-plugin-quest-planner：kcQuests（kcwikizh）前置的較新整理版，和目錄的 poi 前置同一條資料線，
# 所以取代舊版而不另計來源。固定 commit；更新時改這裡並重跑。
QUEST_PLANNER_REPO = 'RikaKagurasaka/poi-plugin-quest-planner'
QUEST_PLANNER_COMMIT = '8b18557b8c19e4d3caa8ff08b6d129c20da825ba'


def quest_planner(offline: bool) -> dict[int, tuple[list[int], list[str]]]:
    """回傳 {api_no: (前置 api_no, 無法對應的期間限定前置代號)}。"""
    cache = Path(__file__).with_name('.cache') / f'quest-planner-{QUEST_PLANNER_COMMIT[:12]}.json'
    if not cache.exists():
        if offline:
            raise SystemExit(f'--offline 但沒有快取：{cache}')
        url = f'https://raw.githubusercontent.com/{QUEST_PLANNER_REPO}/{QUEST_PLANNER_COMMIT}/data/quests.json'
        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            cache.write_bytes(response.read())
    result: dict[int, tuple[list[int], list[str]]] = {}
    for quest in json.loads(cache.read_text(encoding='utf-8'))['quests']:
        deps = quest['dependencies']
        ids = set(deps['questIds'])
        unresolved: list[str] = []
        # 期間限定前置被該專案排除在推論外，但仍是前置：有 questId 的照常計入，只有代號的列為未解析
        for item in deps['ignored'] + deps['unresolved']:
            if item.get('questId'):
                ids.add(item['questId'])
            else:
                unresolved.append(item.get('code') or item.get('raw') or '?')
        result[quest['id']] = (sorted(ids), unresolved)
    print(f'quest-planner：任務 {len(result)}（commit {QUEST_PLANNER_COMMIT[:12]}）', file=sys.stderr)
    return result


TSUKINOHASHI_URL = 'https://tsukinohashi.com/mission-manager/main.js'


def tsukinohashi(offline: bool, by_wiki, names) -> dict[int, list[int]]:
    """艦これ単発任務マネージャ（tsukinohashi）：單發任務樹的連線＋各任務說明開頭紅字註記的前置。

    樹狀圖通常只畫一條主線，常少列前置，所以只在其他來源衝突時作為額外引用與投票（見 quest-flow.ts）。
    """
    cache = Path(__file__).with_name('.cache') / 'tsukinohashi-main.js'
    if not cache.exists() or not offline:
        if offline:
            raise SystemExit(f'--offline 但沒有快取：{cache}')
        request = urllib.request.Request(TSUKINOHASHI_URL, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            cache.write_bytes(response.read())
    text = cache.read_text(encoding='utf-8')
    titles = dict(re.findall(r"'([^']+)':\"(.*?)\",?\n", text[text.index('const nodeTitles'):text.index('const nodeDescriptions')]))
    descriptions = dict(re.findall(r"'([^']+)':\"(.*?)\",\n", text[text.index('const nodeDescriptions'):text.index('const rewardData')]))
    links = re.findall(r"\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]", text[text.index('let link_list = ['):text.index('const EditMode')])
    code = lambda wiki_id: resolve(wiki_id, titles.get(wiki_id, ''), by_wiki, names)
    result: dict[int, set[int]] = {}
    unmapped: set[str] = set()
    for source, target in links:
        a, b = code(source), code(target)
        if a is None or b is None:
            unmapped.update(x for x, n in ((source, a), (target, b)) if n is None)
            continue
        result.setdefault(b, set()).add(a)
    for target, description in descriptions.items():
        b = code(target)
        for note in re.findall(r"<div style='color: red[^']*'>(.*?)</div>", description):
            for wiki_id, name in re.findall(r'\(\s*(\w+)\s*\)\s*([^()（）<]*)', note):
                a = resolve(wiki_id, name, by_wiki, names)
                if a is None or b is None:
                    unmapped.add(wiki_id)
                    continue
                result.setdefault(b, set()).add(a)
    print(f'tsukinohashi：任務 {len(result)}，前置邊 {sum(map(len, result.values()))}；無法對應 {" ".join(sorted(unmapped))}',
          file=sys.stderr)
    return {no: sorted(values) for no, values in result.items()}


KCWIKI_URL = 'https://zh.kcwiki.cn/wiki/%E4%BB%BB%E5%8A%A1'
KCWIKI_CACHE = Path(__file__).with_name('.cache') / 'kcwiki-quests.html'


def kcwiki(offline: bool, by_wiki, names) -> dict[int, tuple[list[list[int]], int, list[str]]]:
    """舰娘百科（zh.kcwiki.cn）任務總表的「前置」欄：api_no → ([前置 api_no, 邊旗標], 條件旗標, 無法對應代號)。

    該站 robots.txt 設 Crawl-delay: 100，只抓這一頁總表並快取。poi／kcQuests 的前置由此站抽出，
    兩者同源（quest-flow.ts 計票時合併為一票）。
    句型：代號以換行／斜線分隔；「待验证」表示整格待驗證，「B30?」表示該條待驗證，
    「可能还需达成其他条件」「及待验证(的其他)任务」表示另有未列出的前置。
    """
    if not KCWIKI_CACHE.exists() or not offline:
        if offline:
            raise SystemExit(f'--offline 但沒有快取：{KCWIKI_CACHE}')
        request = urllib.request.Request(KCWIKI_URL, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            KCWIKI_CACHE.write_bytes(response.read())
    parser = TableGrid()
    parser.feed(KCWIKI_CACHE.read_text(encoding='utf-8'))
    result: dict[int, tuple[list[list[int]], int, list[str]]] = {}
    primary_rows: dict[int, bool] = {}
    unmapped_rows: set[str] = set()
    for rows in parser.tables:
        header = rows[0] if rows else []
        if '前置' not in header or '编号' not in header or '任务名字' not in header:
            continue
        id_col, pre_col, name_col = header.index('编号'), header.index('前置'), header.index('任务名字')
        for row in rows[1:]:
            if len(row) <= name_col or not ID_CELL.match(row[id_col].strip()):
                continue
            no = resolve(row[id_col].strip(), row[name_col].split('\n')[0], by_wiki, names)
            if no is None:
                unmapped_rows.add(row[id_col].strip())
                continue
            cell = row[pre_col]
            flags = COND_EXTRA_UNKNOWN if re.search(r'其他条件|其他任务|待验证任务', cell) else 0
            if '待验证' in cell and not re.search(r'[0-9A-Za-z]\d', cell):
                flags |= COND_EXTRA_UNKNOWN   # 只寫「待验证」：前置不明
            whole_pending = bool(re.search(r'(?:^|\n|/)\s*待验证\s*(?:$|\n|/)', cell))
            edges: dict[int, int] = {}
            unresolved: list[str] = []
            for token in re.split(r'[\n/、,，\s]+', cell):
                code = token.rstrip('?？')
                if not ID_CELL.match(code):
                    continue
                source = resolve(code, '', by_wiki, names)
                if source is None:
                    unresolved.append(code)
                    flags |= COND_UNRESOLVED
                    continue
                edges[source] = EDGE_PENDING if whole_pending or token != code else 0
            entry = ([[source, flag] for source, flag in sorted(edges.items())], flags, unresolved)
            # 同一任務可能出現多列：單發改為年任的任務，舊代號那列（例：F114）記的是改制前的前置，
            # 現行代號那列（例：Fy10）才是目前的前置，即使只寫「待验证」也以它為準。
            # 同為現行代號（「新任務群」與分類表重複）時，保留有前置的那筆。
            primary = row[id_col].strip() == PRIMARY_CODE.get(no)
            current = primary_rows.get(no)
            if no not in result or (primary and not current) or (primary == current and entry[0] and not result[no][0]):
                result[no] = entry
                primary_rows[no] = primary
    total = sum(len(v[0]) for v in result.values())
    pending = sum(1 for v in result.values() for e in v[0] if e[1] & EDGE_PENDING)
    print(f'kcwiki：任務 {len(result)}，前置邊 {total}（待驗證 {pending}）；目錄沒有的任務列 {len(unmapped_rows)}', file=sys.stderr)
    return result


def main() -> None:
    offline = '--offline' in sys.argv[1:]
    kc3_quests(offline)
    by_wiki, names = load_catalog()
    wiki, wiki_names = parse_wiki(wiki_page(offline), by_wiki, names)
    articles = zekamashi.cached() if offline else zekamashi.crawl()
    known = other_prerequisites()
    for no, (clauses, _, _, _) in wiki.items():
        known.setdefault(no, set()).update(edge[0] for clause in clauses for edge in clause)
    zeka = parse_zekamashi(articles, NameIndex(names, wiki_names), known)
    planner = quest_planner(offline)
    tsuki = tsukinohashi(offline, by_wiki, names)
    kcw = kcwiki(offline, by_wiki, names)

    today = datetime.date.today().isoformat()
    compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    wiki_body = ','.join(
        compact([no, [[list(e) for e in c] for c in clauses], flags, unresolved, period])
        for no, (clauses, flags, unresolved, period) in sorted(wiki.items())
    )
    zeka_body = ','.join(
        compact([no, [[source, flag] for source, flag in sorted(sources.items())], flags, names_])
        for no, (sources, flags, names_) in sorted(zeka.items())
    )
    planner_body = ','.join(compact([no, deps, unresolved]) for no, (deps, unresolved) in sorted(planner.items()))
    tsuki_body = ','.join(compact([no, deps]) for no, deps in sorted(tsuki.items()))
    kcwiki_body = ','.join(compact([no, edges, flags, unresolved]) for no, (edges, flags, unresolved) in sorted(kcw.items()))
    supplement_body = ','.join(compact([no, code, name]) for no, (code, name) in sorted(SUPPLEMENT.items()))
    OUT.write_text(
        '/* 由 tools/quest-graph/generate.py 產生，勿手改。 */\n\n'
        f"export const QUEST_GRAPH_GENERATED = '{today}';\n\n"
        '/**\n'
        ' * wikiwiki 任務總表「開放条件/備考」欄：[api_no, 子句, 條件旗標, 無法對應的 wiki 代號, 所在表格的週期]。\n'
        ' * 子句之間為 AND，子句內 [前置 api_no, 邊旗標] 為 OR。\n'
        ' * 邊旗標 1＝待驗證；條件旗標 1＝另有未列出的前置，2＝整個條件待驗證，4＝有無法對應的代號。\n'
        ' */\n'
        f'export const WIKI_QUEST_GRAPH_RAW = [{wiki_body}] as const;\n\n'
        '/**\n'
        ' * ぜかまし各任務攻略的「前提／後続」：[api_no, [前置 api_no, 邊旗標][], 條件旗標, 無法對應的前提名]。\n'
        ' * 前提與後續兩個方向合併；清單為全部前置（AND）。\n'
        ' * 邊旗標 1＝註記要確認等；條件旗標 1＝註記「他不明」，4＝有無法對應的項目。\n'
        ' */\n'
        f'export const ZEKAMASHI_QUEST_GRAPH_RAW = [{zeka_body}] as const;\n\n'
        f"export const QUEST_PLANNER_REVISION = '{QUEST_PLANNER_COMMIT}';\n\n"
        '/**\n'
        ' * poi-plugin-quest-planner 的前置（kcQuests 新版整理）：[api_no, 前置 api_no[], 無法對應的期間限定代號[]]。\n'
        ' * 與目錄 poi 前置同源，有資料時取代之。\n'
        ' */\n'
        f'export const QUEST_PLANNER_GRAPH_RAW = [{planner_body}] as const;\n\n'
        '/**\n'
        ' * 艦これ単発任務マネージャ（tsukinohashi）的單發任務樹：[api_no, 前置 api_no[]]。\n'
        ' * 樹狀圖常只畫一條主線，只在其他來源衝突時作為額外引用與投票。\n'
        ' */\n'
        f'export const TSUKINOHASHI_QUEST_GRAPH_RAW = [{tsuki_body}] as const;\n\n'
        '/**\n'
        ' * 舰娘百科（zh.kcwiki.cn）任務總表「前置」欄：[api_no, [前置 api_no, 邊旗標][], 條件旗標, 無法對應的代號[]]。\n'
        ' * 邊旗標 1＝待验证；條件旗標 1＝另有未列出的前置，4＝有無法對應的代號。與 poi／kcQuests 同源。\n'
        ' */\n'
        f'export const KCWIKI_QUEST_GRAPH_RAW = [{kcwiki_body}] as const;\n\n'
        '/**\n'
        ' * 目錄有 api_no 卻缺 wiki 代號或名稱的任務，由 KC3 kc3-translations 日文任務表補上：[api_no, 代號, 名稱]（空字串＝目錄已有）。\n'
        ' */\n'
        f'export const QUEST_CATALOG_SUPPLEMENT_RAW = [{supplement_body}] as const;\n',
        encoding='utf-8',
    )
    print(f'已寫入 {OUT.relative_to(ROOT)}', file=sys.stderr)


if __name__ == '__main__':
    main()
