#!/usr/bin/env python3
"""ぜかまし海域攻略的「ルート固定」段落：抓取（附快取）與依小節抽出文字。

每張常規海域的攻略頁有「ルート固定」段落，依路線分小節（例：下ルート(道中2戦)），列出固定編成例、
路線字母【CEIO】與需求（※要高速統一、※要索敵…）。這些是實際遊玩驗證過的編成；本專案只取艦種、
數量、路線字母、道中戰數與需求數值等事實，文案由本專案自行撰寫（見 THIRD-PARTY-NOTICES.md）。

── 抓取負擔 ────────────────────────────────────────────────────────
頁面存進 tools/route-suggest/.cache/（不進 git），已有快取就不重抓；`--refresh` 才重抓。
每個請求之間至少間隔 REQUEST_GAP 秒。

用法：
    python3 tools/route-suggest/zekamashi.py [--refresh]
    → tools/route-suggest/.cache/zekamashi.json
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / '.cache'
BASE = 'https://zekamashi.net/kancolle-kouryaku'
USER_AGENT = 'fleet-chronometer route-suggest generator (manual run, cached, >=2s between requests)'
REQUEST_GAP = 2.0
MAPS = [f'{w}-{n}' for w, count in ((1, 6), (2, 5), (3, 5), (4, 5), (5, 6), (6, 5), (7, 5)) for n in range(1, count + 1)]
# 段落標題：多數頁面是「ルート固定」；4-3 是第二個「マップ情報」、4-4 是「ルート情報」
SECTION_TITLES = ('ルート固定', 'ルート固定（仮更新）', 'ルート情報')

_last = 0.0


def fetch(map_key: str, refresh: bool) -> str:
    global _last
    path = CACHE / f'{map_key}.html'
    if path.exists() and not refresh:
        return path.read_text(encoding='utf-8', errors='replace')
    wait = REQUEST_GAP - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(f'{BASE}/{map_key}/', headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        text = res.read().decode('utf-8', errors='replace')
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    return text


def to_lines(fragment: str) -> list[str]:
    t = re.sub(r'<(br|/p|/li|/tr|/td|/th|/div)[^>]*>', '\n', fragment)
    t = html.unescape(re.sub(r'<[^>]+>', '', t))
    t = re.sub(r'[ \t　]+', ' ', t)
    return [line.strip() for line in t.split('\n') if line.strip()]


def extract(page: str) -> dict:
    heads = [(m.start(), m.end(), int(m.group(1)), html.unescape(re.sub(r'<[^>]+>', '', m.group(2))).strip())
             for m in re.finditer(r'<h([2-5])[^>]*>(.*?)</h\1>', page, re.S)]
    # 目錄（toc）也會列出標題文字，但不是 <hN>，不受影響
    idx = next((i for i, h in enumerate(heads) if h[3] in SECTION_TITLES), None)
    if idx is None:
        same = [i for i, h in enumerate(heads) if h[3] == 'マップ情報']
        idx = same[1] if len(same) > 1 else None
    if idx is None:
        return {'title': None, 'routes': []}
    level = heads[idx][2]
    end = next((h[0] for h in heads[idx + 1:] if h[2] <= level), len(page))
    subs = [h for h in heads[idx + 1:] if h[0] < end and h[2] == level + 1]
    routes = []
    if not subs:
        routes.append({'heading': None, 'lines': to_lines(page[heads[idx][1]:end])})
    else:
        intro = to_lines(page[heads[idx][1]:subs[0][0]])
        if intro:
            routes.append({'heading': None, 'lines': intro})
        for k, h in enumerate(subs):
            stop = subs[k + 1][0] if k + 1 < len(subs) else end
            routes.append({'heading': h[3], 'lines': to_lines(page[h[1]:stop])})
    return {'title': heads[idx][3], 'routes': routes}


# 編成例：艦種（或艦名、(A+B) 合計）＋數量（可為範圍）連寫，例：軽巡1駆逐3、(駆逐+海防)2、航戦1軽巡0-2駆逐1-3
COMP_TOKEN = r'(?:\([^()]+\)|[^\d\s()（）【】※:：、,，。・/]+?)\d(?:[-~～]\d)?'
COMP_LINE = re.compile(rf'^(?:例[:：])?((?:{COMP_TOKEN})+)(?:\s*(?:他|など|等))?(?:\s*([※(（].*))?$')
# 路線行＝【路線】(各點性質)，後面只可接「他／等…」或 ※ 註記；說明文裡提到的「【CEJK】を基本に…」不算
ROUTE_LINE = re.compile(r'^【([A-Z0-9/()]+)】\s*(?:[(（](.*?)[)）])?\s*(他.*|等|※.*)?$')


def comp_alts(line: str) -> list[str] | None:
    """編成行 → 各編成。一行可用「/」並列多組（例：軽巡1駆逐5/軽巡1雷巡1駆逐4），
    「 ex.…」是前面泛稱編成的具體例、不另列；整組括號（(空母2軽空2駆逐2)）視同一般編成。"""
    flag = line.startswith('●')
    body = re.split(r'\s*ex\.', line.lstrip('●'), maxsplit=1)[0].strip()
    out = []
    for alt in body.split('/'):
        alt = alt.strip()
        if re.fullmatch(r'\((?:[^()]*\d)+\)', alt) and '+' not in alt:
            alt = alt[1:-1]
        m = COMP_LINE.match(alt)
        if not m:
            return None
        # 編成後面的(高速統一)等是這一組自己的需求：以 tab 隔開附在後面
        out.append(('●' if flag else '') + m.group(1) + (f'\t{m.group(2)}' if m.group(2) else ''))
    return out or None


def blocks(lines: list[str]) -> list[dict]:
    """小節文字 → 區塊：連續的編成例、接著的【路線】(各點性質)、之後的 ※ 註記。"""
    out: list[dict] = []
    cur: dict | None = None
    for line in lines:
        if line in ('—', '-', '―'):
            cur = None
            continue
        route = ROUTE_LINE.match(line)
        comps = None if route else comp_alts(line)
        if comps:
            if cur is None or cur['routes']:
                cur = {'comps': [], 'routes': [], 'legend': '', 'notes': []}
                out.append(cur)
            cur['comps'].extend(comps)
        elif route and cur is not None and not cur['routes']:
            cur['routes'] = route.group(1).split('/')
            cur['legend'] = route.group(2) or ''
            if route.group(3):
                cur['notes'].append(route.group(3))
        elif route and cur is not None:
            # 同一組編成的第二條路線說明（例：最速統一時的另一條）
            cur = {'comps': list(cur['comps']), 'routes': route.group(1).split('/'), 'legend': route.group(2) or '',
                   'notes': [route.group(3)] if route.group(3) else []}
            out.append(cur)
        elif line.startswith('※') and cur is not None and cur['routes']:
            cur['notes'].append(line)
    return [b for b in out if b['comps'] and b['routes']]


def main() -> None:
    refresh = '--refresh' in sys.argv
    out = {}
    for m in MAPS:
        page = fetch(m, refresh)
        out[m] = extract(page)
        # 頁面更新日：與 wiki 分岐法則更新日比較，決定不一致時以哪邊為準
        mod = re.search(r'"dateModified":"(\d{4})-(\d{2})-(\d{2})', page)
        out[m]['modified'] = '/'.join(mod.groups()) if mod else None
        for r in out[m]['routes']:
            r['blocks'] = blocks(r['lines'])
        print(m, out[m]['title'], len(out[m]['routes']), file=sys.stderr)
    (CACHE / 'zekamashi.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
