#!/usr/bin/env python3
"""更新 samples/start2-master.json（start2 主資料子集）。

start2 是全玩家相同的遊戲 master；樣本只保留本專案用得到的表，排除圖檔中繼、家具等大表。
新艦、新裝備實裝後要重跑，否則依樣本產生的資料（任務條件表、譯名表等）會缺。

用法（擇一）：
    python3 tools/start2-sample/refresh.py --backup <總括頁匯出的完整備份.json>
        取備份 snapshot 表裡的 api_start2/getData（擴充自己擷取的封包；優先用這個）
    python3 tools/start2-sample/refresh.py --file <start2.json> --source "<來源說明>"
        直接讀 start2 回應（例：公開的 start2 鏡像），--source 會寫進樣本的 _note

執行後會列出與舊樣本相比新增／移除的艦娘與裝備。
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'samples' / 'start2-master.json'
TABLES = [
    'api_mst_ship', 'api_mst_slotitem', 'api_mst_stype', 'api_mst_slotitem_equiptype', 'api_mst_shipupgrade',
    'api_mst_maparea', 'api_mst_mapinfo', 'api_mst_mission', 'api_mst_equip_ship', 'api_mst_equip_exslot',
    'api_mst_equip_exslot_ship', 'api_mst_equip_limit_exslot',
]

KEEP_ENDED = ['api_mst_maparea', 'api_mst_mapinfo', 'api_mst_mission']


def load_json(path: pathlib.Path):
    text = path.read_text(encoding='utf-8-sig')
    return json.loads(text[text.index('{'):])


def from_backup(path: pathlib.Path) -> dict:
    backup = load_json(path)
    rows = [row for row in backup.get('tables', {}).get('snapshot', []) if row.get('path') == 'api_start2/getData']
    if not rows:
        sys.exit('備份裡沒有 api_start2/getData 快照')
    row = max(rows, key=lambda r: r.get('ts', 0))
    return row['api']


def main() -> None:
    args = sys.argv[1:]
    if '--backup' in args:
        source_path = pathlib.Path(args[args.index('--backup') + 1])
        data = from_backup(source_path)
        source = '使用者總括頁匯出的完整備份（snapshot 表的 api_start2/getData）'
    elif '--file' in args:
        source_path = pathlib.Path(args[args.index('--file') + 1])
        data = load_json(source_path)
        data = data.get('api_data', data)
        if '--source' not in args:
            sys.exit('--file 需要 --source 說明來源')
        source = args[args.index('--source') + 1]
    else:
        sys.exit(__doc__)
    missing = [table for table in TABLES if table not in data]
    if missing:
        sys.exit(f'start2 缺少表：{missing}')
    old = load_json(OUT)
    old_note = old.get('_note', '')
    # 舊 note 的欄位說明保留；第一句的來源改寫成這次的來源。
    detail = old_note.split('欄位重點：', 1)[1] if '欄位重點：' in old_note else ''
    note = ('start2 主資料子集（全玩家相同的遊戲 master，零個資）。'
            f'來源：{source}；由 tools/start2-sample/refresh.py 產生。'
            '刻意排除 api_mst_shipgraph、api_mst_furniture、bgm/mapbgm/payitem/useitem/item_shop/const 等本專案用不到的大表。'
            + (f'欄位重點：{detail}' if detail else ''))
    subset = {'_note': note, **{table: data[table] for table in TABLES}}
    # 活動海域與活動限定遠征在活動結束後就不再送出；舊樣本裡的這些列是真實封包證據，保留不丟。
    for table in KEEP_ENDED:
        present = {row['api_id'] for row in subset[table]}
        kept = [row for row in old.get(table, []) if row['api_id'] not in present]
        if kept:
            subset[table] = sorted(subset[table] + kept, key=lambda row: row['api_id'])
            print(f'{table}：保留活動結束後消失的 {[(row["api_id"], row.get("api_name")) for row in kept]}')
    OUT.write_text(json.dumps(subset, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    def ids(payload: dict, table: str, player_only: bool = False) -> dict[int, str]:
        return {row['api_id']: row.get('api_name', '') for row in payload.get(table, [])
                if not player_only or row['api_id'] < 1500}
    for label, table, player in (('艦娘', 'api_mst_ship', True), ('深海棲艦', 'api_mst_ship', False), ('裝備', 'api_mst_slotitem', False)):
        before, after = ids(old, table, player), ids(subset, table, player)
        if label == '深海棲艦':
            before = {k: v for k, v in before.items() if k >= 1500}
            after = {k: v for k, v in after.items() if k >= 1500}
        added = sorted(set(after) - set(before))
        removed = sorted(set(before) - set(after))
        renamed = sorted(k for k in set(before) & set(after) if before[k] != after[k])
        print(f'{label}：{len(after)} 筆；新增 {[(k, after[k]) for k in added]}；移除 {removed}；改名 {[(k, before[k], after[k]) for k in renamed]}')
    print(f'已寫入 {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
