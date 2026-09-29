"""ぜかまし攻略の任務記事：抓取（附快取）與「前提に…あり。後続に…あり。」解析。

每篇任務攻略的「任務情報」段落以固定句型列出前提與後續任務，連結文字是任務名、連結網址是該任務
自己的攻略頁。這是實際遊玩後的驗證結果，用來和 wikiwiki 的開放条件交叉比對。

── 抓取負擔 ────────────────────────────────────────────────────────
所有頁面都存進 tools/quest-graph/.cache/（不進 git）。文章以 sitemap 的 lastmod 判斷是否需要重抓；
分類列表只在第一次、或 sitemap 出現快取裡沒有的新文章時才重抓。每個請求之間至少間隔 REQUEST_GAP 秒。
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(__file__).with_name('.cache') / 'zekamashi'
BASE = 'https://zekamashi.net'
SITEMAPS = [f'{BASE}/post-sitemap.xml', f'{BASE}/post-sitemap2.xml', f'{BASE}/post-sitemap3.xml']
# 任務攻略所在的分類（単発、工廠・遠征・編成、各週期、期間限定、クエストツリー）
CATEGORIES = [
    'mission', 'ninmu-etc', 'daily', 'weekly', 'monthly', 'quarterly',
    urllib.parse.quote('イヤーリークエスト').lower(), 'gentei', 'ninmu-matome',
]
USER_AGENT = 'fleet-chronometer quest-graph generator (manual run, cached, >=2s between requests)'
REQUEST_GAP = 2.0

_last_request = 0.0
requests_made = 0


def _fetch(url: str) -> str | None:
    global _last_request, requests_made
    wait = REQUEST_GAP - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()
    requests_made += 1
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def _cache_path(url: str) -> Path:
    slug = re.sub(r'[^0-9A-Za-z_-]+', '_', url.removeprefix(BASE).strip('/'))[:80]
    return CACHE / 'pages' / f'{slug}-{hashlib.sha1(url.encode()).hexdigest()[:8]}.html'


def _load_index() -> dict:
    path = CACHE / 'index.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'pages': {}, 'seeds': [], 'sitemap_seen': []}


def _save_index(index: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')


def sitemap() -> dict[str, str]:
    """文章網址 → lastmod。sitemap 本身每次執行都抓（3 個請求），是判斷增量的依據。"""
    result: dict[str, str] = {}
    for url in SITEMAPS:
        text = _fetch(url) or ''
        for loc, lastmod in re.findall(r'<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', text):
            result[loc.strip()] = lastmod.strip()
    return result


def _category_articles() -> set[str]:
    found: set[str] = set()
    for category in CATEGORIES:
        page = 1
        while True:
            url = f'{BASE}/category/kancolle-kouryaku/{category}/' + (f'page/{page}/' if page > 1 else '')
            text = _fetch(url)
            if not text:
                break
            found |= set(re.findall(r'class="common-list__link" href="(https://zekamashi\.net/[^"#?]+/)"', text))
            if f'/page/{page + 1}/' not in text:
                break
            page += 1
    return found


def article(url: str, lastmod: str | None, index: dict) -> str | None:
    """lastmod 沒變就讀快取；否則抓新版並更新快取。"""
    entry = index['pages'].get(url)
    path = _cache_path(url)
    if entry and path.exists() and (lastmod is None or entry.get('lastmod') == lastmod):
        return path.read_text(encoding='utf-8')
    text = _fetch(url)
    if text is None:
        index['pages'][url] = {'lastmod': lastmod, 'missing': True}
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    index['pages'][url] = {'lastmod': lastmod}
    return text


# ── 解析 ────────────────────────────────────────────────────────────

_LINK = re.compile(r'<a [^>]*href="(https://zekamashi\.net/[^"#?]+)"[^>]*>(.*?)</a>', re.S)


def _text(fragment: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', fragment))).strip()


def title(page: str) -> str:
    m = re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S) or re.search(r'<title>(.*?)</title>', page, re.S)
    return _text(m.group(1)).split(' | ')[0] if m else ''


_UNCERTAIN = re.compile(r'要確認|未確認|検証|かも|[?？]')
_BLOCK = r'{kw}(?:任務)?(?:に|は)?[、,]?\s*</p>\s*(<ul[^>]*>.*?</ul>)\s*<p[^>]*>(.*?)</p>'
_INLINE = r'{kw}(?:任務)?(?:に|は)?[、,]?(.{{0,300}}?)(?:。|</p>)'


# 「（<a>関連</a>）」這類指向相關文章的泛稱連結，不是任務名
_GENERIC_LINK = re.compile(r'^(?:関連|参考)(?:記事|リンク|ツリー|出撃任務|出撃)?$|攻略記事$|関連リンク$|関連記事$')


def _items(ul: str) -> list[dict]:
    """清單每一項：有連結用連結文字與網址，沒有連結用項目文字（去掉句尾的（単発）等註記）。"""
    items = []
    for li in re.findall(r'<li[^>]*>(.*?)</li>', ul, re.S):
        for anchor in re.findall(r'[（(]?\s*<a [^>]*>.*?</a>\s*[)）]?', li, re.S):
            if _GENERIC_LINK.search(_text(anchor).strip('（()）')):
                li = li.replace(anchor, '')
        text = _text(li)
        link = next(((u, _text(t)) for u, t in _LINK.findall(li)
                     if '/wp-content/' not in u and _text(t)), None)
        if link:
            url, name = link[0] if link[0].endswith('/') else link[0] + '/', link[1]
        else:
            url, name = None, re.split(r'※', text)[0].strip()
            while True:
                # 句尾的（単発）（デイリー/要確認）等註記；移除泛稱連結後可能只剩半邊括號
                stripped = re.sub(r'\s*[（(][^()（）]*[)）]?\s*$', '', name)
                stripped = re.sub(r'\s*[/／](?:要確認|単発|デイリー|ウィークリー|マンスリー)[^/／]*$', '', stripped)
                if stripped == name:
                    break
                name = stripped
        if name:
            items.append({'url': url, 'name': name, 'uncertain': bool(_UNCERTAIN.search(text))})
    return items


def _find(body: str, kw: str, start: int, limit: int | None = None) -> tuple[list[dict], str, int, int] | None:
    """在 start 之後（limit 字以內）找「{kw}…」敘述，回傳 (項目, 句尾限定語, 開始, 結束)。"""
    window = body[start:start + limit] if limit else body[start:]
    block = re.search(_BLOCK.format(kw=kw), window, re.S)
    inline = re.search(_INLINE.format(kw=kw), window, re.S)
    # 清單後的句尾必須是「あり／なし／不明」或接著後續敘述，否則只是內文剛好提到「前提」
    if block and not re.search(r'あり|なし|無し|不明|後続', _text(block.group(2))):
        block = None
    if block and (not inline or block.start() <= inline.start()):
        return _items(block.group(1)), _text(block.group(2)), start + block.start(), start + block.end()
    if inline:
        frag = inline.group(1)
        items = [{'url': u if u.endswith('/') else u + '/', 'name': _text(t),
                  'uncertain': bool(_UNCERTAIN.search(_text(frag)))}
                 for u, t in _LINK.findall(frag) if '/wp-content/' not in u and _text(t)]
        return items, _text(frag), start + inline.start(), start + inline.end()
    return None


def relations(page: str) -> list[dict]:
    """回傳文章裡每組「前提／後続」敘述。

    主要句型：「前提に <ul>項目…</ul> あり(他不明)。後続に <ul>項目…</ul> あり。」
    變體有「前提任務に」「前提、」、沒有連結的純文字項目、行內「前提任務不明。」等。
    一篇文章可能介紹多個任務，所以依出現順序回傳多組，每組附上最近的上一個 h2／h3 標題供對應。
    """
    body = page.split('<h2', 1)[1] if '<h2' in page else page
    body = re.split(r'<div[^>]*(?:id="comments"|class="[^"]*comment)', body, 1)[0]
    groups: list[dict] = []
    pos = 0
    while True:
        found = _find(body, '前提', pos)
        if not found:
            break
        pre, pre_tail, begin, end = found
        post, post_tail = [], ''
        # 後續敘述緊接在前提之後（通常在同一段「あり。後続に」）
        nxt = _find(body, '後続', end - 40 if end > 40 else end, 400)
        if nxt and nxt[2] >= end - 40:
            post, post_tail, _, end = nxt
        pos = end
        pre_text = ' '.join(i['name'] for i in pre) + ' ' + pre_tail
        explicit = re.search(r'不明|なし|無し', pre_tail + ' ' + post_tail)
        if not pre and not post and not explicit:
            continue
        heading = re.findall(r'<h[23][^>]*>(.*?)</h[23]>', body[:begin], re.S)
        groups.append({
            'heading': _text(heading[-1]) if heading else '',
            'pre': pre,
            'post': post,
            # 「(他不明)」「前提任務不明」：可能還有沒列出的前提
            'pre_unknown': bool(re.search(r'不明|他にも', pre_tail)),
            'pre_uncertain': bool(_UNCERTAIN.search(pre_tail)),
            'post_uncertain': bool(_UNCERTAIN.search(post_tail)),
            'pre_text': pre_text.strip()[:160],
            'post_tail': post_tail[:80],
        })
    return groups


def cached() -> dict[str, dict]:
    """只讀快取，不送出任何請求（調整解析器時用）。"""
    index = _load_index()
    result: dict[str, dict] = {}
    for url, entry in index['pages'].items():
        path = _cache_path(url)
        if entry.get('missing') or not path.exists():
            continue
        page = path.read_text(encoding='utf-8')
        groups = relations(page)
        if groups:
            result[url] = {'title': title(page), 'groups': groups}
    return result


def crawl(log=lambda msg: print(msg, file=sys.stderr)) -> dict[str, dict]:
    """回傳 {文章網址: {'title', 'groups'}}，涵蓋分類裡的任務文章與前提／後續連結到的文章。"""
    index = _load_index()
    lastmods = sitemap()
    if not index['seeds']:
        log('第一次執行：讀取任務分類列表')
        index['seeds'] = sorted(_category_articles())
    if not index.get('sitemap_seen'):
        index['sitemap_seen'] = sorted(lastmods)
    new_posts = sorted(set(lastmods) - set(index['sitemap_seen']))
    if new_posts:
        # 上次執行後才發表的文章不多，直接逐篇確認是不是任務攻略，不必重抓整個分類列表
        log(f'sitemap 有 {len(new_posts)} 篇新文章，逐篇確認')
        index['seeds'] = sorted(set(index['seeds']) | set(new_posts))
        index['sitemap_seen'] = sorted(lastmods)
    _save_index(index)
    known = set(index['seeds'])

    result: dict[str, dict] = {}
    queue = sorted(known)
    seen: set[str] = set()
    try:
        while queue:
            url = queue.pop()
            if url in seen or not url.startswith(f'{BASE}/'):
                continue
            seen.add(url)
            page = article(url, lastmods.get(url), index)
            if page is None:
                continue
            groups = relations(page)
            if not groups:
                continue
            result[url] = {'title': title(page), 'groups': groups}
            for group in groups:
                for item in group['pre'] + group['post']:
                    if item['url'] and item['url'] not in seen:
                        queue.append(item['url'])
            if requests_made and requests_made % 25 == 0:
                log(f'…已送出 {requests_made} 個請求，已解析 {len(result)} 篇')
                _save_index(index)
    finally:
        _save_index(index)
    log(f'ぜかまし：本次送出 {requests_made} 個請求，任務文章 {len(result)} 篇')
    return result
