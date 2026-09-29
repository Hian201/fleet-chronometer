#!/usr/bin/env python3
"""任務進度條件產生器：poi 的 questgoal.json → utils/quest-goal-data.ts。

── 為什麼需要外部資料 ────────────────────────────────────────────────
questlist 只給受注狀態與 50%／80% 標記，不給任務條件；官方說明文字又常省略僚艦數、節點等細節。
poi（MIT）維護一份逐任務的結構化條件表：每個子目標是一種計數事件（Boss 戰 S 勝、抵達節點、
擊沉特定艦種……）加上海域、節點 edge、旗艦／僚艦／艦種／艦級等篩選。語意見 poi 的
skills/quest-goal-data/SKILL.md；判定引擎由本專案依該語意自行實作（utils/quest-goals.ts）。

── 抓取頻率 ────────────────────────────────────────────────────────
只在開發者更新任務資料時手動執行；擴充執行時不連網（正式 build 沒有 host_permissions）。
每次 1 個請求，固定 commit，快取在 tools/quest-goal/.cache/（不進 git）。

用法：
    python3 tools/quest-goal/generate.py            # 抓固定 commit 的 questgoal.json（有快取就不連網）
    python3 tools/quest-goal/generate.py --offline  # 只讀快取
更新資料時改 POI_COMMIT 後重跑，並更新 THIRD-PARTY-NOTICES.md 的 commit。
"""
from __future__ import annotations

import json
import pathlib
import sys
import unicodedata
import urllib.request

POI_COMMIT = '013c81dc0a8725ab0b3e1af89830f9c3ee2efa52'
URL = f'https://raw.githubusercontent.com/poooi/poi/{POI_COMMIT}/assets/data/fcd/questgoal.json'
ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = pathlib.Path(__file__).resolve().parent / '.cache' / f'questgoal-{POI_COMMIT[:12]}.json'
OUT = ROOT / 'utils' / 'quest-goal-data.ts'
START2 = ROOT / 'samples' / 'start2-master.json'
QUEST_LEVEL_KEYS = {'type', 'fuzzy', 'resetInterval'}


def load(offline: bool) -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding='utf-8-sig'))
    if offline:
        sys.exit(f'找不到快取：{CACHE}')
    with urllib.request.urlopen(URL, timeout=30) as response:
        text = response.read().decode('utf-8-sig')
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(text, encoding='utf-8')
    return json.loads(text)


def validate(data: dict) -> None:
    for no, quest in data.items():
        if not no.isdigit():
            sys.exit(f'非數字任務編號：{no}')
        subgoals = {k: v for k, v in quest.items() if k not in QUEST_LEVEL_KEYS}
        if not subgoals:
            sys.exit(f'{no} 沒有子目標')
        for key, sub in subgoals.items():
            if not isinstance(sub, dict) or not isinstance(sub.get('required'), int) or sub['required'] <= 0:
                sys.exit(f'{no} {key} 的 required 無效')


def mission_ids() -> dict[str, list[int]]:
    """遠征名稱 → master id（samples/start2-master.json 的 api_mst_mission；比對前做 NFKC 並去空白）。"""
    text = START2.read_text(encoding='utf-8')
    data = json.loads(text[text.index('{'):])
    data = data.get('api_data', data)
    table: dict[str, list[int]] = {}
    for mission in data['api_mst_mission']:
        table.setdefault(normalize(mission['api_name']), []).append(mission['api_id'])
    return table


def normalize(name: str) -> str:
    return unicodedata.normalize('NFKC', name).replace(' ', '').replace('\u3000', '')


def convert_missions(data: dict) -> list[str]:
    """條件表以遠征名稱篩選；換成封包驗證過的遠征 id（missionId）。對不上或同名多筆時保留原欄位，
    讓判定引擎把整個任務標為不支援，不猜。"""
    table = mission_ids()
    unresolved: list[str] = []
    for no, quest in data.items():
        for value in quest.values():
            if not isinstance(value, dict) or 'mission' not in value:
                continue
            ids = [table.get(normalize(name), []) for name in value['mission']]
            if all(len(match) == 1 for match in ids):
                value['missionId'] = [match[0] for match in ids]
                del value['mission']
            else:
                unresolved.append(no)
    return unresolved


def main() -> None:
    payload = load('--offline' in sys.argv)
    data = payload['data']
    validate(data)
    unresolved = convert_missions(data)
    if unresolved:
        print(f'遠征名稱對不上 start2 樣本、保留為不支援：{sorted(set(unresolved), key=int)}')
    # description 是 poi 的簡體中文說明，介面不顯示（標籤由子目標結構自行組出），故不收錄。
    compact = {
        no: {key: ({k: v for k, v in value.items() if k != 'description'} if isinstance(value, dict) else value)
             for key, value in quest.items()}
        for no, quest in sorted(data.items(), key=lambda item: int(item[0]))
    }
    body = json.dumps(compact, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(
        '// 任務進度條件表（純資料，無 chrome.*）。\n'
        '//\n'
        '// **本檔由 tools/quest-goal/generate.py 產生，請勿手改**——來源為 poi（MIT）固定 commit 的\n'
        f'// assets/data/fcd/questgoal.json（{POI_COMMIT}，版本 {payload["meta"]["version"]}）。\n'
        '// 遠征名稱（mission）已依 samples/start2-master.json 換成遠征 id（missionId）。\n'
        '// 欄位語意與判定見 utils/quest-goals.ts；本機修正放在該檔的 QUEST_GOAL_OVERRIDES。\n'
        f'export const QUEST_GOAL_SOURCE = {{ commit: {json.dumps(POI_COMMIT)}, version: {json.dumps(payload["meta"]["version"])} }} as const;\n'
        f'export const QUEST_GOAL_RAW: Record<string, Record<string, unknown>> = {body};\n',
        encoding='utf-8',
    )
    print(f'{OUT.relative_to(ROOT)}：{len(compact)} 個任務')


if __name__ == '__main__':
    main()
