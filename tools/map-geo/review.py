#!/usr/bin/env python3
"""本機對照：把 georef 投影的海岸線與節點疊到遊戲地圖截圖上，輸出 .cache/review/<map>.png。

截圖只用來目視比對 georef 範圍，放在 .cache/shots/<map>.jpg（不進版本庫、不散布）。
截圖可能是遊戲畫面的裁切或縮放，換算寫在 .cache/shots/shots.json：
    {"1-5": {"scale": 1, "ox": 33, "oy": 6}}   # 遊戲座標 = 截圖座標 / scale + (ox, oy)
缺項時用 {"scale": 1, "ox": 0, "oy": 0}。

需要 Pillow。用法：
    python3 tools/map-geo/review.py 5-5 [1-5 …]
    python3 tools/map-geo/review.py 1-5=132.2,32.8,90,90   # 以 中心經,中心緯,px/度,北方角 試算，不改 georef.json
    python3 tools/map-geo/review.py '3-5=[[-166.6,53.9,593,376],…]'   # 以控制點試算
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geo import CACHE, H, W, load_georef, load_reefs, load_rings, map_lines, map_rings  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def load_spots(key: str) -> dict[str, tuple[int, int]]:
    text = (ROOT / 'utils' / 'map-spots.ts').read_text(encoding='utf-8')
    block = re.search(rf"'{re.escape(key)}': \{{\n\s+spots: \{{(.*?)\}},", text)
    if not block:
        return {}
    return {m.group(1): (int(m.group(2)), int(m.group(3)))
            for m in re.finditer(r'"([^"]+)": \[(\d+), (\d+)\]', block.group(1))}


def main(keys: list[str]) -> None:
    georef = load_georef()
    shots_cfg = {}
    cfg_path = CACHE / 'shots' / 'shots.json'
    if cfg_path.exists():
        shots_cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
    rings = load_rings()
    reefs = load_reefs()
    out_dir = CACHE / 'review'
    out_dir.mkdir(parents=True, exist_ok=True)
    for arg in keys:
        key, _, trial = arg.partition('=')
        if trial.startswith('['):
            georef[key] = {'points': json.loads(trial)}
        elif trial:
            lon, lat, scale, rot = (float(v) for v in trial.split(','))
            georef[key] = {'center': [lon, lat], 'scale': scale, 'rot': rot}
        canvas = Image.new('RGB', (W, H), (16, 21, 29))
        shot_path = CACHE / 'shots' / f'{key}.jpg'
        if shot_path.exists():
            cfg = {'scale': 1, 'ox': 0, 'oy': 0, **shots_cfg.get(key, {})}
            shot = Image.open(shot_path).convert('RGB')
            if cfg['scale'] != 1:
                shot = shot.resize((round(shot.width / cfg['scale']), round(shot.height / cfg['scale'])))
            canvas.paste(shot, (round(cfg['ox']), round(cfg['oy'])))
        draw = ImageDraw.Draw(canvas)
        ref = georef.get(key)
        if ref:
            for pts in map_rings(ref, rings):
                draw.line(pts + [pts[0]], fill=(255, 220, 0), width=2)
            for pts in map_lines(ref, reefs):
                draw.line(pts, fill=(0, 230, 255), width=2)
        for name, (x, y) in load_spots(key).items():
            draw.ellipse((x - 5, y - 5, x + 5, y + 5), outline=(255, 0, 255), width=2)
            draw.text((x + 7, y - 16), name, fill=(255, 0, 255))
        out = out_dir / f'{key}.png'
        canvas.save(out)
        print(out)


if __name__ == '__main__':
    main(sys.argv[1:])
