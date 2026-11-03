#!/usr/bin/env python3
"""任務達成條件產生器：tools/quest-prep/conditions.py → utils/quest-prep-data.ts。

conditions.py 是人工審核資料（依據見該檔開頭）；這裡只負責：
  1. 艦名、裝備名依 samples/start2-master.json 換成 master id，道具名依 utils/item-catalog.ts 換成道具 id；
     任何名稱對不上、或同名對到多筆，一律報錯，不輸出。
  2. 廢棄條件與任務條件表（utils/quest-goal-data.ts）比對：條件表已收錄的任務沿用其計數，
     兩邊不一致時報錯，要先查證再改其中一邊。
  3. --report：與 kcwiki-quest-data（2024-06 後未更新）逐筆比對艦名，列出差異供人工複核；
     並附上 KC3Kai kc3-translations 的現行說明。兩者都只在開發者執行時抓一次並快取。

用法：
    python3 tools/quest-prep/generate.py            # 產生 utils/quest-prep-data.ts
    python3 tools/quest-prep/generate.py --report   # 另外列出與舊資料的差異
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / '.cache'
OUT = ROOT / 'utils' / 'quest-prep-data.ts'
START2 = ROOT / 'samples' / 'start2-master.json'
ITEM_CATALOG = ROOT / 'utils' / 'item-catalog.ts'
GOAL_DATA = ROOT / 'utils' / 'quest-goal-data.ts'
KCWIKI_COMMIT = '4bb60dd3b1069191867cd8455a898ed898eb4c36'
KCWIKI_URL = f'https://raw.githubusercontent.com/kcwikizh/kcwiki-quest-data/{KCWIKI_COMMIT}/data.min.json'
KC3_COMMIT = 'e72c4261e7e6a39bcf4918d461b2ea15ff9f4bf3'
KC3_URL = f'https://raw.githubusercontent.com/KC3Kai/kc3-translations/{KC3_COMMIT}/data/jp/quests.json'

spec = importlib.util.spec_from_file_location('conditions', HERE / 'conditions.py')
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def load_start2():
    text = START2.read_text(encoding='utf-8')
    data = json.loads(text[text.index('{'):])
    data = data.get('api_data', data)
    ships: dict[str, list[dict]] = {}
    for ship in data['api_mst_ship']:
        if ship['api_id'] < 1500:
            ships.setdefault(ship['api_name'], []).append(ship)
    gears: dict[str, list[int]] = {}
    for gear in data['api_mst_slotitem']:
        gears.setdefault(gear['api_name'], []).append(gear['api_id'])
    return ships, gears


SHIPS, GEARS = load_start2()


def ship_id(name: str) -> int:
    found = SHIPS.get(name, [])
    if len(found) != 1:
        fail(f'艦名「{name}」在 start2 對到 {len(found)} 筆')
        return 0
    return found[0]['api_id']


def ship_class(name: str) -> int:
    found = SHIPS.get(name, [])
    if len(found) != 1:
        fail(f'艦級代表艦「{name}」在 start2 對到 {len(found)} 筆')
        return 0
    return found[0]['api_ctype']


def gear_id(name: str) -> int:
    found = GEARS.get(name, [])
    if len(found) != 1:
        fail(f'裝備名「{name}」在 start2 對到 {len(found)} 筆')
        return 0
    return found[0]


def load_items() -> dict[str, dict]:
    """item-catalog.ts 的日文名 → 持有量來源。家具コイン在提督基本資料（api_basic.api_fcoin）。"""
    text = ITEM_CATALOG.read_text(encoding='utf-8')
    table: dict[str, dict] = {'家具コイン': {'kind': 'fcoin', 'id': 0}}
    pattern = re.compile(r"countSource: \{ kind: '(useitem|material)', (?:id|apiId): (\d+) \}, names: \{[^}]*ja: '([^']+)'")
    for kind, ident, name in pattern.findall(text):
        table[name] = {'kind': kind, 'id': int(ident)}
    return table


ITEMS = load_items()


def load_goal_raw() -> dict:
    text = GOAL_DATA.read_text(encoding='utf-8')
    line = next(l for l in text.splitlines() if l.startswith('export const QUEST_GOAL_RAW'))
    return json.loads(line[line.index('{'):].rstrip(';'))


GOAL_RAW = load_goal_raw()
# 本機修正的條件（utils/quest-goal-local.ts）判定時優先於來源條件表，已另行審核，不再比對。
LOCAL_GOAL_NOS = {int(n) for n in re.findall(r'^    (\d+): \{', (ROOT / 'utils' / 'quest-goal-local.ts').read_text(encoding='utf-8'), re.M)}


def lv_pair(value):
    return None if value is None else [value[0], value[1]]


def convert_req(req: dict) -> dict:
    out: dict = {'k': req['k']}
    if 'ships' in req:
        out['ships'] = [ship_id(name) for name in req['ships']]
    if 'types' in req:
        out['types'] = list(req['types'])
    if 'classes' in req:
        out['classes'] = sorted({ship_class(name) for name in req['classes']})
    if 'exclude' in req:
        out['exclude'] = [ship_id(name) for name in req['exclude']]
    for key in ('n', 'min', 'max'):
        if key in req:
            out[key] = req[key]
    if 'lv' in req:
        out['lv'] = lv_pair(req['lv'])
    return out


def scrap_subgoals(entries: list[dict]) -> dict:
    """廢棄條件 → 任務條件表格式（fuzzy，每個子目標恰好一種計數單位）。"""
    goal: dict = {'fuzzy': True}
    for index, entry in enumerate(entries):
        sub: dict = {'required': entry['n'], 'init': 0}
        if entry.get('times'):
            sub['times'] = [1]
        elif entry.get('items'):
            sub['anyItem'] = True
        elif 'types' in entry:
            sub['slotitemType2'] = list(entry['types'])
        else:
            sub['slotitemId'] = [gear_id(name) for name in entry['gears']]
        goal[f'destory_item@{index}'] = sub
    return goal


def scrap_signature(goal: dict) -> list:
    rows = []
    for key, sub in goal.items():
        if not isinstance(sub, dict) or not key.startswith('destory_item'):
            continue
        unit = ('times',) if 'times' in sub else ('any',) if sub.get('anyItem') else \
            ('type', tuple(sorted(sub['slotitemType2']))) if 'slotitemType2' in sub else ('id', tuple(sorted(sub['slotitemId'])))
        rows.append((unit, sub['required']))
    return sorted(rows)


def build() -> dict:
    out: dict = {}
    for no, (code, fleet, reqs) in C.COMPOSITION.items():
        out[no] = {'kind': 'composition', 'code': code, 'fleet': fleet, 'reqs': [convert_req(r) for r in reqs]}
    for no, spec_ in C.EQUIPMENT.items():
        reqs = []
        if spec_.get('flag') or spec_.get('flaglv'):
            reqs.append(convert_req({'k': 'flag', 'ships': spec_.get('flag', []),
                                     **({'lv': (spec_['flaglv'], None)} if spec_.get('flaglv') and not spec_.get('flagclass') else {})}))
        if spec_.get('flagtype'):
            reqs.append({'k': 'flagType', 'types': list(spec_['flagtype'])})
        if spec_.get('flagclass'):
            reqs.append(convert_req({'k': 'flagClass', 'classes': spec_['flagclass'],
                                     **({'lv': (spec_['flaglv'], None)} if spec_.get('flaglv') else {})}))
        for req in spec_.get('escorts', []):
            reqs.append(convert_req(req))
        entry: dict = {'kind': 'equipment', 'code': spec_['code'], 'fleet': 1, 'reqs': reqs}
        if spec_.get('slots'):
            entry['slots'] = [{'slot': s['slot'], 'gear': gear_id(s['gear']), **({'star': s['star']} if 'star' in s else {}),
                               **({'alv': True} if s.get('alv') else {}), **({'keep': True} if s.get('keep') else {})} for s in spec_['slots']]
        if spec_.get('hold'):
            entry['hold'] = [{'gear': gear_id(h['gear']), 'n': h['n'], **({'star': h['star']} if 'star' in h else {})} for h in spec_['hold']]
        if spec_.get('res') and any(spec_['res']):
            entry['res'] = spec_['res']
        if spec_.get('items'):
            entry['items'] = []
            for name, n in spec_['items'].items():
                source = ITEMS.get(name)
                if not source:
                    fail(f'{no} 道具「{name}」不在 item-catalog.ts')
                    continue
                entry['items'].append({**source, 'n': n})
        if spec_.get('gate'):
            entry['gate'] = True
        if spec_.get('scrap'):
            mine = scrap_subgoals(spec_['scrap'])
            source = GOAL_RAW.get(str(no))
            if no in LOCAL_GOAL_NOS:
                pass
            elif source is None:
                entry['scrap'] = mine
            elif scrap_signature(source) != scrap_signature(mine):
                fail(f'{no} 廢棄條件與任務條件表不同：本檔 {scrap_signature(mine)}，條件表 {scrap_signature(source)}')
        out[no] = entry
    for no, spec_ in C.MAP_CLEAR.items():
        out[no] = {'kind': 'map', 'code': spec_['code'], 'map': spec_['map']}
    overlap = set(C.EXCLUDED) & set(out)
    if overlap:
        fail(f'EXCLUDED 與條件表重複：{sorted(overlap)}')
    return dict(sorted(out.items()))


def fetch(url: str, name: str) -> object:
    path = CACHE / name
    if not path.exists():
        with urllib.request.urlopen(url, timeout=30) as response:
            text = response.read().decode('utf-8-sig')
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
    return json.loads(path.read_text(encoding='utf-8'))


def report() -> None:
    kcwiki = {q['game_id']: q for q in fetch(KCWIKI_URL, f'kcwiki-{KCWIKI_COMMIT[:12]}.json')}
    kc3 = fetch(KC3_URL, f'kc3-quests-{KC3_COMMIT[:12]}.json')
    print('── 與 kcwiki-quest-data 的差異（編成任務艦名）──')
    for no, (code, fleet, reqs) in C.COMPOSITION.items():
        old = kcwiki.get(no, {}).get('requirements', {})
        old_names = {name for g in old.get('groups', []) for name in ([g['ship']] if isinstance(g.get('ship'), str) else g.get('ship', []))}
        old_names = {n for n in old_names if n in SHIPS}
        mine = {name for r in reqs for name in r.get('ships', [])}
        notes = []
        if old_names - mine:
            notes.append(f'舊資料多 {sorted(old_names - mine)}')
        if mine - old_names:
            notes.append(f'本檔多 {sorted(mine - old_names)}')
        if old.get('disallowed') == '他の艦' and not any(r['k'] == 'size' and 'max' in r for r in reqs):
            notes.append('舊資料限定僅列出的艦，本檔沒有上限')
        if any(r['k'] == 'size' and 'max' in r for r in reqs) and old.get('disallowed') != '他の艦':
            notes.append('本檔有艘數上限，舊資料沒有')
        if not old:
            notes.append('舊資料未收錄')
        if notes:
            print(f'{no} {code}：' + '；'.join(notes))
            memo = kc3.get(str(no), {})
            print(f'    KC3Kai：{memo.get("desc", "")} {memo.get("memo", "")}'.replace('\n', ' ')[:300])
    print('\n── 不收錄 ──')
    for no, reason in C.EXCLUDED.items():
        print(f'{no}：{reason}')


def main() -> None:
    data = build()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    body = json.dumps({str(k): v for k, v in data.items()}, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(
        '// 任務達成條件表：編成、裝備準備／機種轉換、海域攻略（純資料，無 chrome.*）。\n'
        '//\n'
        '// **本檔由 tools/quest-prep/generate.py 產生，請勿手改**——人工審核資料在 tools/quest-prep/conditions.py\n'
        '// （wikiwiki 與 KC3Kai kc3-translations 現行說明逐筆核對）。艦娘、裝備皆為 master id，艦名表示該改造階段以後。\n'
        '// 欄位語意與判定見 utils/quest-prep.ts。\n'
        f'export const QUEST_PREP_RAW: Record<string, unknown> = {body};\n',
        encoding='utf-8',
    )
    kinds = {}
    for entry in data.values():
        kinds[entry['kind']] = kinds.get(entry['kind'], 0) + 1
    print(f'{OUT.relative_to(ROOT)}：{len(data)} 個任務 {kinds}')
    if '--report' in sys.argv:
        report()


if __name__ == '__main__':
    main()
