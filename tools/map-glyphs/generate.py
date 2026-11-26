#!/usr/bin/env python3
"""活動地圖節點字母的字形庫產生器：kcs2-mapdata → utils/map-glyph-data.ts ＋ samples/map-glyph/*.json。

── 為什麼需要 ────────────────────────────────────────────────────────
新活動開放的節點字母只畫在遊戲地圖的 point 圖層（圖片）上，不在任何 JSON 或封包裡
（見 docs/completion-plan.md 4.11）。`utils/map-glyph.ts` 在遊戲頁讀到該圖層的字形後，
要和已知名稱的字形比對才讀得出字母。字形庫由本腳本從過去活動的地圖圖檔產生，**只保存二值字形遮罩**
（位元打包後的 base64），不保存任何原圖或 RGBA。

── 字形來源 ──────────────────────────────────────────────────────────
1. 追加檔標籤 sprite：`<關>_image<N>.json` 的影格名去掉 `map<海域3位><關2位>_` 前綴後，不是
   route／icon／map 開頭者；再去掉 `<海域>-<關>_text_` 前綴，剩下的字串就是節點名。
   名稱必須是 `A`、`B1`、`ZZ` 這類形式，且切字後恰好是單一個字才收。
2. point 圖層（影格名以 `_point` 結尾）上的字：依 KC3Kai `tools/map-edges/edges.json` 的終點字母監督。
   該關不在 edges.json 就略過；節點附近 45px 內有追加檔標籤者，字母畫在 sprite 而不在圖層，不拿來監督。

── 遮罩與切字（參數出處：docs/completion-plan.md 4.11 離線實驗，與 utils/map-glyph*.ts 必須一致）──
- 字身遮罩：alpha ≥ 128 且 (299R+587G+114B)/1000 < 110。
- 8 連通元件；水平間距 ≤ 8px 且垂直重疊（容許 2px）的元件併成一個字。
- 字與節點中心距離 ≤ 45px 的組合由近到遠一對一指派。
- 位元打包：列優先，第 i 個像素在第 i>>3 位元組的 (7 - (i & 7)) 位元；整串再做 base64。

── 來源與授權 ────────────────────────────────────────────────────────
KagamiChan/kcs2-mapdata（MIT License, Copyright (c) 2018 かがみ）收錄的遊戲地圖資源。
KC3Kai edges.json（MIT）。登錄於 THIRD-PARTY-NOTICES.md。
來源以 `git clone --depth 1` 一次取得，放在 tools/map-glyphs/.cache/（不進版本庫）；不逐檔呼叫
GitHub API。要更新來源時刪掉快取資料夾重跑。

用法：
    python3 tools/map-glyphs/generate.py
    python3 tools/map-glyphs/generate.py --exclude-area 62 --out /tmp/x.ts   # 留一驗證用
"""
import argparse
import base64
import json
import math
import os
import re
import struct
import subprocess
import sys
import zlib
from itertools import accumulate
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).with_name('.cache') / 'kcs2-mapdata'
REPO_URL = 'https://github.com/KagamiChan/kcs2-mapdata.git'
EDGES = ROOT / 'tools' / 'map-edges' / 'edges.json'
OUT = ROOT / 'utils' / 'map-glyph-data.ts'
FIXTURE_DIR = ROOT / 'samples' / 'map-glyph'

MIN_AREA = 10  # 常規海域（< 10）的字母已在 KC3Kai 靜態表，不需要字形
FIXTURE_AREA = 62
WORD_GAP = 8
WORD_OVERLAP = 2
ASSIGN_DIST = 45
CROP_HALF = 55
# 字身遮罩的合理尺寸：實測字母高 14～16px；更小的是亮色字身被門檻切碎的殘片，更大的是節點標記或路線，
# 兩者拿來比對只會增加誤讀。
GLYPH_H = (13, 17)
GLYPH_W = (2, 30)
NAME_RE = re.compile(r'^[A-Z]{1,3}\d{0,2}$')
PNG_SIG = b'\x89PNG\r\n\x1a\n'


# ── PNG（只支援 8-bit RGBA 非交錯；只還原需要的左上角範圍）──────────────────────

def read_png(path, max_x, max_y):
    data = Path(path).read_bytes()
    if data[:8] != PNG_SIG:
        raise ValueError(f'不是 PNG：{path}')
    pos, idat, w, h = 8, [], 0, 0
    while pos < len(data):
        n, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + n]
        if typ == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
            if (depth, ctype, interlace) != (8, 6, 0):
                raise ValueError(f'不支援的 PNG 格式 {(depth, ctype, interlace)}：{path}')
        elif typ == b'IDAT':
            idat.append(chunk)
        pos += 12 + n
    raw = zlib.decompress(b''.join(idat))
    stride = w * 4
    keep = min(w, max_x) * 4  # 濾波只依賴左、上、左上，右側用不到的欄可以不還原
    rows, prev = [], bytearray(keep)
    for y in range(min(h, max_y)):
        off = y * (stride + 1)
        f = raw[off]
        line = bytearray(raw[off + 1:off + 1 + keep])
        if f == 1:
            for c in range(4):
                line[c::4] = bytes(v & 255 for v in accumulate(line[c::4]))
        elif f == 2:
            line = bytearray((a + b) & 255 for a, b in zip(line, prev))
        elif f == 3:
            for i in range(keep):
                a = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(keep):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            raise ValueError(f'未知的 PNG 濾波 {f}：{path}')
        rows.append(line)
        prev = line
    return w, h, rows


def dark_region(rows, fx, fy, fw, fh):
    """影格範圍的字身遮罩，回傳 fh 列、每列 fw 個 0/1。"""
    out = []
    for y in range(fy, fy + fh):
        row, px = rows[y], bytearray(fw)
        for x in range(fw):
            i = (fx + x) * 4
            if row[i + 3] >= 128 and row[i] * 299 + row[i + 1] * 587 + row[i + 2] * 114 < 110000:
                px[x] = 1
        out.append(px)
    return out


# ── 切字 ────────────────────────────────────────────────────────────────────

def components(mask, w, h):
    """8 連通元件，回傳 {x0,y0,x1,y1（不含）,pts}。"""
    dark = {y * w + x for y in range(h) for x in range(w) if mask[y][x]}
    comps = []
    while dark:
        start = dark.pop()
        stack, pts = [start], [start]
        while stack:
            cur = stack.pop()
            cy, cx = divmod(cur, w)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nxt = (cy + dy) * w + cx + dx
                    if 0 <= cx + dx < w and nxt in dark:
                        dark.discard(nxt)
                        stack.append(nxt)
                        pts.append(nxt)
        xs = [p % w for p in pts]
        ys = [p // w for p in pts]
        comps.append({'x0': min(xs), 'y0': min(ys), 'x1': max(xs) + 1, 'y1': max(ys) + 1,
                      'pts': [(p % w, p // w) for p in pts]})
    return comps


def near(a, b):
    return (max(a['x0'] - b['x1'], b['x0'] - a['x1']) <= WORD_GAP
            and not (a['y1'] < b['y0'] - WORD_OVERLAP or a['y0'] > b['y1'] + WORD_OVERLAP))


def merge_words(comps):
    words = [dict(c) for c in comps]
    merged = True
    while merged:
        merged = False
        for i in range(len(words)):
            for j in range(i + 1, len(words)):
                if near(words[i], words[j]):
                    a, b = words[i], words[j]
                    words[i] = {'x0': min(a['x0'], b['x0']), 'y0': min(a['y0'], b['y0']),
                                'x1': max(a['x1'], b['x1']), 'y1': max(a['y1'], b['y1']),
                                'pts': a['pts'] + b['pts']}
                    del words[j]
                    merged = True
                    break
            if merged:
                break
    return sorted(words, key=lambda wd: (wd['y0'], wd['x0']))


def word_mask(word):
    w, h = word['x1'] - word['x0'], word['y1'] - word['y0']
    mask = bytearray(w * h)
    for x, y in word['pts']:
        mask[(y - word['y0']) * w + x - word['x0']] = 1
    return w, h, mask


def plausible(w, h):
    return GLYPH_W[0] <= w <= GLYPH_W[1] and GLYPH_H[0] <= h <= GLYPH_H[1]


def pack_bits(mask):
    out = bytearray((len(mask) + 7) // 8)
    for i, v in enumerate(mask):
        if v:
            out[i >> 3] |= 0x80 >> (i & 7)
    return base64.b64encode(bytes(out)).decode('ascii')


def assign(words, nodes):
    """字中心與節點中心 ≤ ASSIGN_DIST 的組合由近到遠一對一。回傳 節點 index → 字 index。"""
    pairs = []
    for wi, wd in enumerate(words):
        cx, cy = (wd['x0'] + wd['x1']) / 2, (wd['y0'] + wd['y1']) / 2
        for si, (x, y) in enumerate(nodes):
            d = math.hypot(cx - x, cy - y)
            if d <= ASSIGN_DIST:
                pairs.append((d, wi, si))
    pairs.sort()
    used_w, out = set(), {}
    for _, wi, si in pairs:
        if wi in used_w or si in out:
            continue
        used_w.add(wi)
        out[si] = wi
    return out


# ── 讀地圖資料夾 ─────────────────────────────────────────────────────────────

def load_info(map_dir, no):
    """合併該關所有 _info*.json：spots 依 no 後蓋前，labels 全收。"""
    spots, labels = {}, []
    files = sorted(Path(map_dir).glob(f'{no}_info*.json'),
                   key=lambda p: int(re.sub(r'\D', '', p.stem.split('_info')[1]) or 0))
    for p in files:
        j = json.loads(p.read_text(encoding='utf-8'))
        for s in j.get('spots', []):
            spots[s['no']] = s
        for lb in j.get('labels', []):
            labels.append((lb['x'], lb['y']))
    return spots, labels


def node_list(spots, edges_key, edges):
    """非出擊點終點（依座標去重）。回傳 [(x, y, KC3Kai 名稱或 None)]。"""
    kc = edges.get(edges_key, {})
    by_xy = {}
    for no in sorted(spots):
        s = spots[no]
        if 'line' not in s:
            continue
        name = kc.get(str(no), [None, None])[1]
        cur = by_xy.setdefault((s['x'], s['y']), name)
        if cur is not None and name is not None and cur != name:
            by_xy[(s['x'], s['y'])] = False  # 同座標不同名稱：不拿來監督
    return [(x, y, None if n is False else n) for (x, y), n in by_xy.items()]


def process_map(task):
    area, no, edges = task
    map_dir = CACHE / 'maps' / area
    area_n, no_n = int(area), int(no)
    key = f'{area_n}-{no_n}'
    prefix = f'map{area}{no}_'
    spots, labels = load_info(map_dir, no)
    nodes = node_list(spots, f'World {key}', edges)
    named = [n for n in nodes if n[2] is not None]
    want_fixture = area_n == FIXTURE_AREA

    sprites, layer = [], None
    for sheet in sorted(map_dir.glob(f'{no}_image*.json')):
        meta = json.loads(sheet.read_text(encoding='utf-8'))
        todo = []
        for fname, fr in meta['frames'].items():
            if not fname.startswith(prefix):
                continue
            short = fname[len(prefix):]
            f = fr['frame']
            if short.endswith('_point') and (named or want_fixture):
                todo.append(('point', None, f))
            elif not short.startswith(('route', 'icon', 'map')):
                name = re.sub(r'^.*_text_', '', short)
                if NAME_RE.match(name):
                    todo.append(('sprite', name, f))
        if not todo:
            continue
        max_x = max(f['x'] + f['w'] for _, _, f in todo)
        max_y = max(f['y'] + f['h'] for _, _, f in todo)
        _, _, rows = read_png(map_dir / meta['meta']['image'], max_x, max_y)
        for kind, name, f in todo:
            mask = dark_region(rows, f['x'], f['y'], f['w'], f['h'])
            if kind == 'sprite':
                words = merge_words(components(mask, f['w'], f['h']))
                if len(words) == 1:
                    w, h, m = word_mask(words[0])
                    if plausible(w, h):
                        sprites.append((name, w, h, m))
            else:
                layer = (f['w'], f['h'], mask)

    glyphs = [(n, w, h, m, 'sprite') for n, w, h, m in sprites]
    stats = {'key': key, 'sprites': len(sprites), 'point_words': 0, 'nodes': len(named), 'no_layer': layer is None}
    fixture = None
    if layer is not None:
        lw, lh, mask = layer
        words = merge_words(components(mask, lw, lh))
        # 附近有追加檔標籤的節點，字母畫在 sprite 而不在圖層
        train = [(x, y, n) for x, y, n in named
                 if NAME_RE.match(n) and not any(math.hypot(x - lx, y - ly) <= ASSIGN_DIST for lx, ly in labels)]
        got = assign(words, [(x, y) for x, y, _ in train])
        for si, wi in got.items():
            w, h, m = word_mask(words[wi])
            if plausible(w, h):
                glyphs.append((train[si][2], w, h, m, 'point'))
        stats['point_words'] = len(glyphs) - len(sprites)
        stats['words'] = len(words)
        if want_fixture:
            fixture = {
                'map': key,
                'layer': {'w': lw, 'h': lh},
                'nodes': [],
                'sprites': [{'name': n, 'w': w, 'h': h, 'bits': pack_bits(m)} for n, w, h, m in sprites],
            }
            for x, y, n in named:
                if any(math.hypot(x - lx, y - ly) <= ASSIGN_DIST for lx, ly in labels):
                    fixture['nodes'].append({'x': x, 'y': y, 'name': n})
                    continue
                x0, y0 = max(0, x - CROP_HALF), max(0, y - CROP_HALF)
                x1, y1 = min(lw, x + CROP_HALF), min(lh, y + CROP_HALF)
                cw, ch = x1 - x0, y1 - y0
                if cw <= 0 or ch <= 0:
                    continue
                crop = bytearray()
                for yy in range(y0, y1):
                    crop += mask[yy][x0:x1]
                fixture['nodes'].append({'x': x, 'y': y, 'name': n,
                                         'crop': {'x0': x0, 'y0': y0, 'w': cw, 'h': ch, 'bits': pack_bits(crop)}})
    return key, [(n, w, h, pack_bits(m), kind) for n, w, h, m, kind in glyphs], fixture, stats


# ── 主程式 ───────────────────────────────────────────────────────────────────

def ensure_clone():
    if (CACHE / 'maps').is_dir():
        return
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', 'clone', '--depth', '1', REPO_URL, str(CACHE)], check=True)


def list_tasks(exclude, edges):
    tasks = []
    for d in sorted((CACHE / 'maps').iterdir()):
        if not (d.is_dir() and d.name.isdigit()):
            continue
        area = int(d.name)
        if area < MIN_AREA or area in exclude:
            continue
        nos = sorted({p.name[:2] for p in d.glob('[0-9][0-9]_image.json')})
        tasks.extend((d.name, no, edges) for no in nos)
    return tasks


def ts_string(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--exclude-area', type=int, action='append', default=[], help='排除指定海域（可重複）')
    ap.add_argument('--out', type=Path, default=OUT, help='字形庫輸出路徑')
    args = ap.parse_args()

    ensure_clone()
    edges = json.loads(EDGES.read_text(encoding='utf-8'))
    tasks = list_tasks(set(args.exclude_area), edges)
    with Pool(os.cpu_count() or 1) as pool:
        results = pool.map(process_map, tasks, chunksize=1)

    # 同名同遮罩去重；固定排序，重跑結果穩定
    uniq = {}
    for key, glyphs, _, _ in results:
        for n, w, h, bits, kind in glyphs:
            uniq.setdefault((n, w, h, bits), {}).setdefault(key, set()).add(kind)
    by_mask = {}
    for n, w, h, bits in uniq:
        by_mask.setdefault((w, h, bits), []).append(n)
    # 同一遮罩對到多個名稱：追加檔 sprite 的名稱出自遊戲本身，優先；只由 point 圖層監督得到的名稱，
    # 要有其他名稱 3 倍以上的地圖支持才留，否則整組丟棄（可能是名稱與位置的指派錯誤）。
    dropped = []
    for (w, h, bits), names in by_mask.items():
        if len(names) < 2:
            continue
        sprite_names = [n for n in names if any('sprite' in k for k in uniq[(n, w, h, bits)].values())]
        support = {n: len(uniq[(n, w, h, bits)]) for n in names}
        for n in names:
            if n in sprite_names:
                continue
            others = [support[o] for o in names if o != n]
            if sprite_names or support[n] < 3 * max(others):
                dropped.append((n, w, h, bits))
    for t in dropped:
        del uniq[t]
    items = sorted(uniq)
    commit = subprocess.run(['git', '-C', str(CACHE), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    lines = [
        '// 活動地圖節點字母的字形庫（產生物，勿手改）。',
        '// 產生：python3 tools/map-glyphs/generate.py（說明與參數見該檔檔頭）。',
        f'// 來源：KagamiChan/kcs2-mapdata（MIT）commit {commit}；名稱監督：KC3Kai edges.json（MIT）。',
        '// 只存二值字身遮罩（列優先位元打包後的 base64），不含任何原圖；格式見 utils/map-glyph-mask.ts。',
        '',
        'export const MAP_GLYPHS: ReadonlyArray<{ name: string; w: number; h: number; bits: string }> = [',
    ]
    lines += [f'    {{ name: {ts_string(n)}, w: {w}, h: {h}, bits: {ts_string(bits)} }},' for n, w, h, bits in items]
    lines += ['];', '']
    args.out.write_text('\n'.join(lines), encoding='utf-8')

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for key, _, fixture, _ in results:
        if fixture:
            (FIXTURE_DIR / f'{key}.json').write_text(
                json.dumps(fixture, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

    print(f'地圖 {len(results)} 關；字形 {len(items)} 個，名稱 {len({i[0] for i in items})} 種；'
          f'{args.out} {args.out.stat().st_size} bytes')
    for _, _, _, st in results:
        if st['no_layer'] and st['nodes']:
            print(f"  {st['key']}：有 {st['nodes']} 個已知名稱節點但找不到 point 圖層")
    print(f"point 圖層監督字 {sum(r[3]['point_words'] for r in results)}，追加檔 sprite {sum(r[3]['sprites'] for r in results)}")
    if dropped:
        print(f'丟棄 {len(dropped)} 個名稱與其他名稱遮罩相同的 point 監督字形：{sorted({d[0] for d in dropped})}')
    still = {}
    for n, w, h, bits in items:
        still.setdefault((w, h, bits), []).append(n)
    ambiguous = [v for v in still.values() if len(v) > 1]
    if ambiguous:
        print(f'遮罩相同而名稱不同（遊戲 sprite 本身如此，比對時以讀不出處理）：{ambiguous}')


if __name__ == '__main__':
    main()
