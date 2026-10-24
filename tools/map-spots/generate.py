#!/usr/bin/env python3
"""海域節點座標與路線產生器：poi fcd/map.json → utils/map-spots.ts。

── 為什麼需要外部資料 ────────────────────────────────────────────────
節點在遊戲畫面上的位置與路線連接只存在遊戲的地圖資源（kcs2/resources/map/<area>/<no>_info.json
的 spots），不在任何 kcsapi 封包裡。poi 的 fcd/map.json 由該資源直接抽出：`spots` 是遊戲
1200×720 畫面座標的節點中心，出擊點以 `1`、`2`… 命名並標 `start`；`route` 是 route id →
[起點, 終點]，起點為 null 的是開放出擊點的虛擬路線（不畫）。

只收常規海域（world < 10）；活動海域每期不同，常規導航不處理。

── 交叉比對 ────────────────────────────────────────────────────────
route id → 終點字母必須與 KC3Kai edges.json（tools/map-edges/edges.json）一致；KC3Kai 把所有
出擊點都寫成 `Start`／`Start N`，故起點只比對非出擊點。不一致時列出並以非零狀態結束，
由維護者查證後再決定採用哪一邊（不自動挑選）。

── 來源與授權 ──────────────────────────────────────────────────────
https://raw.githubusercontent.com/poooi/poi/master/fcd/map.json
poi：MIT License, Copyright (c) 2015-2021 poi contributors（見 THIRD-PARTY-NOTICES.md）。
本目錄的 map.json 是取得當下的副本；更新時重新下載並重跑本腳本。

用法：
    python3 tools/map-spots/generate.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name('map.json')
EDGES = ROOT / 'tools' / 'map-edges' / 'edges.json'
OUT = ROOT / 'utils' / 'map-spots.ts'

# 已查證、確定以 poi 為準的差異：{map: {route id: 說明}}。
# 7-4 route 3：KC3Kai 記 A→C、poi 記 出擊點→C；wikiwiki 7-4 分岐表寫「出撃→A／C」，與 poi 相符。
KNOWN_DIFFS: dict[str, dict[str, str]] = {
    '7-4': {'3': 'KC3Kai 記起點 A；遊戲資源與 wikiwiki 皆為出擊點'},
}


def map_sort_key(key: str) -> tuple[int, int]:
    world, number = key.split('-')
    return int(world), int(number)


def main() -> None:
    raw = json.loads(SOURCE.read_text(encoding='utf-8'))
    edges = json.loads(EDGES.read_text(encoding='utf-8'))
    problems: list[str] = []
    maps: dict[str, dict] = {}
    for key, entry in raw.items():
        world, _ = map_sort_key(key)
        if world >= 10:
            continue
        spots = {name: (int(v[0]), int(v[1])) for name, v in entry['spots'].items()}
        starts = [name for name, v in entry['spots'].items() if v[2] == 'start']
        routes: dict[int, tuple[str, str]] = {}
        for rid, (src, dst) in entry['route'].items():
            if src is None:
                continue
            if src not in spots or dst not in spots:
                problems.append(f'{key} route {rid}：端點 {src}→{dst} 沒有座標')
                continue
            routes[int(rid)] = (src, dst)
        kc3 = edges.get(f'World {key}', {})
        for rid, (src, dst) in routes.items():
            pair = kc3.get(str(rid))
            if pair is None:
                problems.append(f'{key} route {rid}：KC3Kai 沒有此 edge')
                continue
            if KNOWN_DIFFS.get(key, {}).get(str(rid)):
                continue
            kc3_src, kc3_dst = pair
            src_ok = kc3_src.startswith('Start') if src in starts else kc3_src == src
            if kc3_dst != dst or not src_ok:
                problems.append(f'{key} route {rid}：poi {src}→{dst}，KC3Kai {kc3_src}→{kc3_dst}')
        maps[key] = {'spots': spots, 'starts': starts, 'routes': routes}

    if problems:
        print('\n'.join(problems), file=sys.stderr)
        sys.exit(1)

    lines = [
        '// 海域節點座標與路線 —— **產生物，勿手改**（改來源檔或產生器再重跑）：',
        '//     python3 tools/map-spots/generate.py',
        '//',
        '// 來源：poi fcd/map.json（MIT, Copyright (c) 2015-2021 poi contributors，見 THIRD-PARTY-NOTICES.md），',
        '// 由遊戲地圖資源抽出；route id → 終點已與 KC3Kai edges.json 逐筆比對一致。',
        '// spots 是遊戲 1200×720 畫面座標的節點中心；starts 是出擊點名稱（`1`、`2`…）。',
        f'// 收錄 {len(maps)} 張常規海域。',
        'export interface MapSpots {',
        '    spots: Record<string, readonly [number, number]>;',
        '    starts: readonly string[];',
        '    /** route id → [起點, 終點]。 */',
        '    routes: Record<number, readonly [string, string]>;',
        '}',
        '',
        'export const MAP_SPOTS: Record<string, MapSpots> = {',
    ]
    for key in sorted(maps, key=map_sort_key):
        m = maps[key]
        spots = ', '.join(f'{json.dumps(n, ensure_ascii=False)}: [{x}, {y}]' for n, (x, y) in m['spots'].items())
        starts = ', '.join(json.dumps(s) for s in m['starts'])
        routes = ', '.join(f'{rid}: [{json.dumps(a)}, {json.dumps(b)}]' for rid, (a, b) in sorted(m['routes'].items()))
        lines.append(f"    '{key}': {{")
        lines.append(f'        spots: {{ {spots} }},')
        lines.append(f'        starts: [{starts}],')
        lines.append(f'        routes: {{ {routes} }},')
        lines.append('    },')
    lines.append('};')
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}：{len(maps)} 張海域')


if __name__ == '__main__':
    main()
