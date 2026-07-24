#!/usr/bin/env python3
"""節點字母對照表產生器：KC3Kai edges.json → utils/map-edge-letters.ts。

── 為什麼需要外部資料 ────────────────────────────────────────────────
戰鬥/進軍封包給的 `api_no` 是**路線段（edge）id**，不是格子 id，更不是字母。
KC3Kai 的 `edges.json` 一筆 edge 對到 `[起點字母, 終點字母]`，我們要的是終點字母。
同一個字母可以有多個 edge（同一個節點從不同方向進入，例：6-5 的 C／G／H／I／M 各兩條），
故這是「edge → 字母」的多對一表，無法由編號推算（已用真實資料否證，見 utils/map-edge-letters.ts）。

── 來源與授權 ──────────────────────────────────────────────────────
https://raw.githubusercontent.com/KC3Kai/KC3Kai/master/src/data/edges.json
KC3Kai：MIT License, Copyright (c) 2015-2026 dragonjet（見 THIRD-PARTY-NOTICES.md）。
本目錄的 edges.json 是取得當下的副本；更新時重新下載並重跑本腳本。

用法：
    python3 tools/map-edges/generate.py            # 用 tools/map-edges/edges.json
    python3 tools/map-edges/generate.py path.json  # 指定其他來源
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name('edges.json')
OUT = ROOT / 'utils' / 'map-edge-letters.ts'

WORLD_KEY = re.compile(r'^World (\d+)-(\d+)$')


def main() -> None:
    raw = json.loads(SOURCE.read_text(encoding='utf-8'))
    maps: dict[str, dict[int, str]] = {}
    for world_key, edges in raw.items():
        matched = WORLD_KEY.match(world_key)
        if not matched:
            print(f'跳過無法解析的鍵：{world_key}', file=sys.stderr)
            continue
        map_key = f'{int(matched.group(1))}-{int(matched.group(2))}'
        letters: dict[int, str] = {}
        for edge_id, pair in edges.items():
            # 值一律是 [起點, 終點] 兩個字串（已驗證來源檔 5904 筆全數符合）
            if not (isinstance(pair, list) and len(pair) == 2 and isinstance(pair[1], str)):
                print(f'跳過異常條目：{world_key} {edge_id} {pair!r}', file=sys.stderr)
                continue
            destination = pair[1].strip()
            if not destination:
                continue
            letters[int(edge_id)] = destination
        if letters:
            maps[map_key] = letters

    def map_sort_key(key: str) -> tuple[int, int]:
        world, number = key.split('-')
        return int(world), int(number)

    lines = [
        '// 節點字母對照表 —— **產生物，勿手改**（改來源檔或產生器再重跑）：',
        '//     python3 tools/map-edges/generate.py',
        '//',
        '// 來源：KC3Kai src/data/edges.json（MIT, Copyright (c) 2015-2026 dragonjet，',
        '// 見 THIRD-PARTY-NOTICES.md）。一筆 edge → [起點字母, 終點字母]，此處只留終點字母。',
        '//',
        '// 鍵是 `${world}-${mapnum}`（同 SortieLogRow.map），值是 `edge id → 字母`。',
        '// **多個 edge 可以對到同一個字母**（同一節點從不同方向進入），這是資料的事實不是錯誤。',
        f'// 收錄 {len(maps)} 張海域、{sum(len(v) for v in maps.values())} 條 edge。',
        'export const EDGE_LETTERS: Record<string, Record<number, string>> = {',
    ]
    for map_key in sorted(maps, key=map_sort_key):
        entries = ', '.join(
            f'{edge}: {json.dumps(letter, ensure_ascii=False)}'
            for edge, letter in sorted(maps[map_key].items())
        )
        lines.append(f"    '{map_key}': {{ {entries} }},")
    lines.append('};')
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}：{len(maps)} 張海域、{sum(len(v) for v in maps.values())} 條 edge')


if __name__ == '__main__':
    main()
