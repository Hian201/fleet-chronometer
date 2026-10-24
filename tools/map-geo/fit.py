#!/usr/bin/env python3
"""本機輔助：用截圖的陸地／海洋像素自動擬合 georef（中心、比例、北方角）。

截圖依 .cache/shots/shots.json 換到遊戲座標後，以顏色分類：綠／褐為陸地、深藍為海；
標題列、左下羅盤、節點與 --mask-x 指定的量表範圍不計分。Natural Earth 陸地在搜尋區內
點陣化一次，候選參數只做查表，分數為陸地 IoU（均勻取樣，FP 依面積計）。

一定要給起點：`--near 經,緯,北方角`（遊戲關名的地名，或已知的考證座標與方位），
搜尋只在附近進行。結果只是起點，必須再用 review.py 目視確認。

需要 numpy、Pillow。用法：
    python3 tools/map-geo/fit.py 1-5 --near 132.2,32.8,90 [--smin 40 --smax 300] [--mask-x 30,150]
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geo import CACHE, H, W, load_rings, merc_y  # noqa: E402
from review import load_spots  # noqa: E402

RES = 0.01   # 點陣解析度（度）
TOP_K = 15


def shot_samples(key: str, mask_x, limit: int = 40000, debug: bool = False, loose_sea: bool = False):
    cfg_all = json.loads((CACHE / 'shots' / 'shots.json').read_text(encoding='utf-8'))
    cfg = {'scale': 1, 'ox': 0, 'oy': 0, **cfg_all.get(key, {})}
    img = np.asarray(Image.open(CACHE / 'shots' / f'{key}.jpg').convert('RGB')).astype(int)
    h, w, _ = img.shape
    ys, xs = np.mgrid[0:h, 0:w]
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    land = (g > b + 8) & (g > 45) & (r < 200)
    sea = (b > g + 15) & (b > r + 30)
    if loose_sea:
        # 海面被量表光暈等染色時：非陸地、非白色路線／文字的像素都當海
        sea = ~land & ~((r > 150) & (g > 150) & (b > 150))
    gx = xs / cfg['scale'] + cfg['ox']
    gy = ys / cfg['scale'] + cfg['oy']
    valid = (gy > 95) & (land | sea)
    valid &= (gx - 93) ** 2 + (gy - 646) ** 2 > 250 ** 2
    for x0, x1 in mask_x:
        valid &= (gx < x0) | (gx > x1)
    for x, y in load_spots(key).values():
        valid &= (gx - x) ** 2 + (gy - y) ** 2 > 32 ** 2
    if debug:
        dbg = np.zeros((h, w, 3), dtype=np.uint8)
        dbg[valid & land] = (60, 200, 60)
        dbg[valid & sea] = (20, 40, 120)
        (CACHE / 'review').mkdir(parents=True, exist_ok=True)
        Image.fromarray(dbg).save(CACHE / 'review' / f'{key}-mask.png')
    idx = np.flatnonzero(valid.ravel())
    rng = np.random.default_rng(0)
    if len(idx) > limit:
        idx = rng.choice(idx, limit, replace=False)
    # 回傳相對畫面中心的偏移（x 向右、y 向上）
    return gx.ravel()[idx] - W / 2, H / 2 - gy.ravel()[idx], land.ravel()[idx]


class Raster:
    def __init__(self, rings, lon0: float, lat0: float, radius: float):
        self.west, self.east = lon0 - radius, lon0 + radius
        south, north = max(-84.0, lat0 - radius), min(84.0, lat0 + radius)
        self.y_top = merc_y(north)
        y_bottom = merc_y(south)
        width = int((self.east - self.west) / RES) + 1
        height = int((self.y_top - y_bottom) / RES) + 1
        img = Image.new('1', (width, height), 0)
        draw = ImageDraw.Draw(img)
        for ring in rings:
            lats = [p[1] for p in ring]
            if max(lats) < south or min(lats) > north:
                continue
            lons = [p[0] for p in ring]
            for shift in (-360, 0, 360):
                if max(lons) + shift < self.west or min(lons) + shift > self.east:
                    continue
                pts = [((lon + shift - self.west) / RES, (self.y_top - merc_y(lat)) / RES) for lon, lat in ring]
                if len(pts) >= 3:
                    draw.polygon(pts, fill=1)
        self.grid = np.asarray(img, dtype=bool)

    def score(self, ex, ny, land, lon0, lat0, s, rot) -> float:
        t = math.radians(rot)
        east = ex * math.cos(t) + ny * math.sin(t)
        north = -ex * math.sin(t) + ny * math.cos(t)
        lon = lon0 + east / s
        my = merc_y(lat0) + north / s
        ix = ((lon - self.west) / RES).astype(int)
        iy = ((self.y_top - my) / RES).astype(int)
        ok = (ix >= 0) & (iy >= 0) & (ix < self.grid.shape[1]) & (iy < self.grid.shape[0])
        pred = np.zeros_like(land)
        pred[ok] = self.grid[iy[ok], ix[ok]]
        tp = np.count_nonzero(pred & land)
        fp = np.count_nonzero(pred & ~land)
        fn = np.count_nonzero(~pred & land)
        return tp / max(1, tp + fp + fn)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('key')
    ap.add_argument('--near', required=True, help='經,緯,北方角')
    ap.add_argument('--smin', type=float, default=30)
    ap.add_argument('--smax', type=float, default=400)
    ap.add_argument('--rot-range', type=float, default=15, help='北方角搜尋 ±度')
    ap.add_argument('--mask-x', action='append', default=[], help='排除的遊戲 x 範圍，例如 30,150（可重複）')
    ap.add_argument('--mask', action='store_true', help='輸出 .cache/review/<map>-mask.png 檢查顏色分類')
    ap.add_argument('--loose-sea', action='store_true', help='海面被染色時：非陸地且非白色的像素都當海')
    args = ap.parse_args()
    lon_h, lat_h, rot_h = (float(v) for v in args.near.split(','))
    mask_x = [tuple(float(v) for v in r.split(',')) for r in args.mask_x]
    ex, ny, land = shot_samples(args.key, mask_x, debug=args.mask, loose_sea=args.loose_sea)
    print(f'取樣 {len(ex)} 點，陸地 {np.count_nonzero(land)}', file=sys.stderr)
    # 最小比例時畫面半寬約 600/smin 度；中心最多偏離起點 0.6 個畫面寬，再留旋轉餘裕
    radius = min(60.0, 1.6 * W / args.smin)
    raster = Raster(load_rings(), lon_h, lat_h, radius)

    # 粗搜保留前幾名再各自細搜：單一最佳值常落在錯的比例（小島多的海域尤其明顯）
    top: list[tuple[float, float, float, float, float]] = []
    s = args.smin
    while s <= args.smax:
        span = W / s
        step = span * 0.04
        reach = span * 0.6
        for rot in np.arange(rot_h - args.rot_range, rot_h + args.rot_range + 0.1, 5):
            lon = lon_h - reach
            while lon <= lon_h + reach:
                lat = lat_h - reach
                while lat <= lat_h + reach:
                    v = raster.score(ex, ny, land, lon, lat, s, rot)
                    if len(top) < TOP_K or v > top[-1][0]:
                        top.append((v, lon, lat, s, rot))
                        top.sort(key=lambda c: -c[0])
                        del top[TOP_K:]
                    lat += step
                lon += step
        s *= 1.06

    def refine(cand):
        v, lon, lat, s, rot = cand
        for scale_step in (0.02, 0.005):
            improved = True
            while improved:
                improved = False
                span = W / s
                for d in ((1, 0, 0, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, -1, 0, 0),
                          (0, 0, 1, 0), (0, 0, -1, 0), (0, 0, 0, 1), (0, 0, 0, -1)):
                    nxt = (lon + d[0] * span * scale_step, lat + d[1] * span * scale_step,
                           s * (1 + d[2] * scale_step), rot + d[3] * scale_step * 50)
                    nv = raster.score(ex, ny, land, *nxt)
                    if nv > v:
                        v, (lon, lat, s, rot) = nv, nxt
                        improved = True
        return v, lon, lat, s, rot

    results = sorted((refine(c) for c in top), key=lambda c: -c[0])
    for r in results[1:4]:
        print(f'  次佳 IoU {r[0]:.3f}  {args.key}={r[1]:.3f},{r[2]:.3f},{r[3]:.1f},{r[4]:.1f}', file=sys.stderr)
    v, lon, lat, s, rot = results[0]
    print(f'IoU {v:.3f}')
    print(f'{args.key}={lon:.3f},{lat:.3f},{s:.1f},{rot:.1f}')


if __name__ == '__main__':
    main()
