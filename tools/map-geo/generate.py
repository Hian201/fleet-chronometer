#!/usr/bin/env python3
"""常規導航底圖產生器：Natural Earth 陸地 × georef.json → utils/map-geo-data.ts。

── 為什麼不用遊戲底圖 ──────────────────────────────────────────────
遊戲海域底圖是原創美術，不能隨擴充散布。遊戲的海域多半照真實地理繪製（常見橫擺，
北朝左），故改用公有領域的 Natural Earth 陸地，依 georef.json 的中心、比例與北方角投影到
遊戲 1200×720 畫面座標，與 utils/map-spots.ts 的節點座標疊合。

georef 由 fit.py 擬合、review.py 目視核對後人工寫入；每筆都要附 `note` 說明依據與對齊程度。
遊戲美術與真實地理不完全一致（島形誇張、虛構島群），故輸出是近似對齊，不宣稱與遊戲畫面一致。

── 來源與授權 ──────────────────────────────────────────────────────
Natural Earth 1:10m Land、Minor Islands、Reefs —— https://www.naturalearthdata.com/
公有領域（public domain，見 THIRD-PARTY-NOTICES.md）。原始檔約 11MB，不進版本庫：
    curl -L -o tools/map-geo/.cache/ne_10m_land.geojson \\
        https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
    curl -L -o tools/map-geo/.cache/ne_10m_minor_islands.geojson \\
        https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_minor_islands.geojson
    curl -L -o tools/map-geo/.cache/ne_10m_reefs.geojson \\
        https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_reefs.geojson

用法：
    python3 tools/map-geo/generate.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geo import clip_ring, load_georef, load_reefs, load_rings, map_lines, map_rings, simplify_ring, svg_path, svg_polyline  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'utils' / 'map-geo-data.ts'


def map_sort_key(key: str) -> tuple[int, int]:
    world, number = key.split('-')
    return int(world), int(number)


# 海域選擇用的世界地圖：常規海域只在印度洋到太平洋（最西 4-4 馬達加斯加、最東 6-3 強斯頓環礁與
# 3-5 阿拉斯加半島、最北 3-1 白令海），故只畫東經 35°～205°（西經 155°）、南緯 30°～北緯 62°。
# 等距圓柱投影、每度 6px；西半球的環整個平移 +360° 接到右側。
WORLD = {'west': 35.0, 'east': 205.0, 'south': -30.0, 'north': 62.0, 'px': 6.0}


def world_path(rings) -> str:
    w, e, s, n, px = WORLD['west'], WORLD['east'], WORLD['south'], WORLD['north'], WORLD['px']
    width, height = (e - w) * px, (n - s) * px
    out = []
    for ring in rings:
        lons = [p[0] for p in ring]
        lats = [p[1] for p in ring]
        if max(lats) < s or min(lats) > n:
            continue
        shift = 360 if max(lons) < 0 else 0
        if max(lons) + shift < w or min(lons) + shift > e:
            continue
        pts = [((lon + shift - w) * px, (n - lat) * px) for lon, lat in ring]
        pts = clip_ring(pts, -2, -2, width + 2, height + 2)
        if len(pts) < 3:
            continue
        pts = simplify_ring(pts, 0.7)
        if len(pts) < 3:
            continue
        area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2
        if abs(area) < 1.5:
            continue
        out.append(pts)
    return svg_path(out)


def main() -> None:
    georef = load_georef()
    rings = load_rings()
    reefs = load_reefs()
    lines = [
        '// 常規導航底圖 —— **產生物，勿手改**（改 tools/map-geo/georef.json 再重跑）：',
        '//     python3 tools/map-geo/generate.py',
        '//',
        '// 陸地來自 Natural Earth 1:10m（公有領域，見 THIRD-PARTY-NOTICES.md），依 georef 投影到遊戲',
        '// 1200×720 畫面座標。land 是陸地（SVG path，fill-rule nonzero）、reef 是珊瑚礁線（只描邊；',
        '// 環礁在陸地層只有零星小島，要靠這層才畫得出來）。沒有的為空字串。',
        'export const MAP_GEO: Record<string, { land: string; reef: string }> = {',
    ]
    total = 0
    for key in sorted(georef, key=map_sort_key):
        land = svg_path(map_rings(georef[key], rings))
        reef = svg_polyline(map_lines(georef[key], reefs))
        total += len(land) + len(reef)
        lines.append(f"    '{key}': {{ land: {json.dumps(land)}, reef: {json.dumps(reef)} }},")
        print(f'{key}: 陸地 {len(land)}、礁 {len(reef)} 字元', file=sys.stderr)
    lines.append('};')
    world = world_path(rings)
    total += len(world)
    w, e, s_, n, px = WORLD['west'], WORLD['east'], WORLD['south'], WORLD['north'], WORLD['px']
    lines += [
        '',
        '/** 海域選擇用的世界地圖（印度洋～太平洋，等距圓柱投影；x＝(經−west)×px、y＝(north−緯)×px）。 */',
        f'export const WORLD_PICKER = {{ west: {w:g}, east: {e:g}, south: {s_:g}, north: {n:g}, px: {px:g}, width: {(e - w) * px:g}, height: {(n - s_) * px:g}, land: {json.dumps(world)} }};',
    ]
    print(f'世界地圖：{len(world)} 字元', file=sys.stderr)
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}：{len(georef)} 張海域，{total} 字元')


if __name__ == '__main__':
    main()
