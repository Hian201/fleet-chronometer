#!/usr/bin/env python3
"""utils/remodel-cost-data.ts 產生器（產出物勿手改，改這裡再重跑）。

改造所需的等級、彈藥、鋼材與大部分道具在遊戲 master 裡（api_mst_ship／api_mst_shipupgrade），
執行期直接讀封包。本檔只處理 master **沒有**的兩類資料：

  1. 開發資材、高速建造材、新型砲熕兵裝資材、改修資材、工廠資源的逐艦消耗量。
     這些寫死在遊戲 client 裡；KC3Kai 把它們整理成「改造前 master id → 數量」的 switch 表。
  2. 艦娘等級的累計經驗值（遊戲只給「目前累計」與「到下一級還差多少」）。

輸入（不放進本專案，執行時以參數指定下載好的檔案）：
  KC3Kai src/library/modules/RemodelDb.js
  KC3Kai src/data/exp_ship.json
來源與授權見 THIRD-PARTY-NOTICES.md「改造消耗例外表與艦娘經驗表」。

用法：
  python3 tools/remodel-cost/generate.py <RemodelDb.js> <exp_ship.json> <KC3Kai commit>

只擷取數值事實（id → 數量），不複製程式碼；判定規則另在 utils/remodel-goals.ts 以本專案的
寫法實作。經驗表只取 Lv1–99：改造所需等級目前最高 98，Lv100 以上涉及結婚後的累計基準，
用不到就不帶。
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'utils' / 'remodel-cost-data.ts'

# KC3Kai 的函式名 → 本專案的欄位名
FUNCTIONS = {
    'calcDevMat': 'devmat',
    'calcTorch': 'torch',
    'calcGunMat': 'gunMat',
    'calcScrew': 'screw',
    'calcArsenalMat': 'arsenalMat',
}


def function_body(source: str, name: str) -> str:
    start = re.search(rf'^\s+{name}: function\(', source, re.M)
    if not start:
        raise SystemExit(f'RemodelDb.js 找不到 {name}，上游結構已變，請檢查產生器')
    rest = source[start.end():]
    end = re.search(r'^\s+[A-Za-z]+: function\(', rest, re.M)
    return rest[:end.start()] if end else rest


def case_table(body: str) -> dict[int, int]:
    """把 `case A: case B: return N;` 攤平成 {A: N, B: N}；遇到 default 就停。"""
    table: dict[int, int] = {}
    pending: list[int] = []
    for line in body.splitlines():
        if re.match(r'\s*default\s*:', line):
            break
        case = re.match(r'\s*case\s+(\d+)\s*:', line)
        if case:
            pending.append(int(case.group(1)))
            continue
        ret = re.match(r'\s*return\s+(\d+)\s*;', line)
        if ret and pending:
            for ship_id in pending:
                table[ship_id] = int(ret.group(1))
            pending = []
    if pending:
        raise SystemExit(f'有 case 沒有對應的 return：{pending}')
    return table


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    source = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
    exp = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
    commit = sys.argv[3]

    extra: dict[int, dict[str, int]] = {}
    for name, field in FUNCTIONS.items():
        for ship_id, count in case_table(function_body(source, name)).items():
            extra.setdefault(ship_id, {})[field] = count
    if len(extra) < 50:
        raise SystemExit(f'只解析出 {len(extra)} 艘，疑似解析失敗')
    # 「用了設計圖就不耗開發資材」這條通則的例外艦
    exempt = re.search(r'!\[([\d,\s]+)\]\.includes\(ship_id_from\)', function_body(source, 'isIgnoreDevMat'))
    if not exempt:
        raise SystemExit('isIgnoreDevMat 找不到例外清單，上游結構已變')
    blueprint_devmat = sorted(int(x) for x in exempt.group(1).split(','))

    # exp_ship.json：{ "等級": [到下一級所需, 累計] }
    totals = [0] * 100
    for level in range(1, 100):
        totals[level] = int(exp[str(level)][1])
    if totals[50] != 122500 or totals[99] != 1000000:
        raise SystemExit('經驗表抽驗失敗（Lv50 應為 122,500、Lv99 應為 1,000,000）')

    lines = [
        '// 改造消耗例外表與艦娘累計經驗表。純資料模組、無 chrome.*。',
        '//',
        '// **本檔由 tools/remodel-cost/generate.py 產生，請勿手改**。',
        f'// 來源：KC3Kai（MIT）commit {commit}',
        '//   src/library/modules/RemodelDb.js、src/data/exp_ship.json',
        '//',
        '// 這些數量不在遊戲 master 裡，屬外部整理的參照資料，不是封包事實；介面一律標「推算」。',
        '// 表內沒有的艦＝來源沒有記載例外，不代表確定為 0（新艦可能尚未收錄）。',
        '',
        'export interface RemodelExtraCost {',
        '    /** 開發資材。未列時依鋼材量與設計圖數的通則推算，見 utils/remodel-goals.ts。 */',
        '    devmat?: number;',
        '    /** 高速建造材。 */',
        '    torch?: number;',
        '    /** 新型砲熕兵裝資材。 */',
        '    gunMat?: number;',
        '    /** 改修資材。 */',
        '    screw?: number;',
        '    /** 工廠資源。 */',
        '    arsenalMat?: number;',
        '}',
        '',
        '/** 鍵＝改造前的 master id。 */',
        'export const REMODEL_EXTRA_COST: Readonly<Record<number, RemodelExtraCost>> = {',
    ]
    for ship_id in sorted(extra):
        fields = ', '.join(f'{field}: {extra[ship_id][field]}' for field in FUNCTIONS.values() if field in extra[ship_id])
        lines.append(f'    {ship_id}: {{ {fields} }},')
    lines += [
        '};',
        '',
        '/** 改造用到設計圖時通常不耗開發資材；這些改造前 master id 例外，仍依鋼材量計。 */',
        f'export const BLUEPRINT_STILL_NEEDS_DEVMAT: readonly number[] = {blueprint_devmat};',
        '',
        '/** 索引＝等級（1–99），值＝到達該等級的累計經驗；索引 0 不使用。 */',
        'export const SHIP_EXP_TOTAL: readonly number[] = [',
    ]
    for start in range(0, 100, 10):
        lines.append('    ' + ', '.join(str(v) for v in totals[start:start + 10]) + ',')
    lines += ['];', '']
    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}：例外 {len(extra)} 艘、經驗表 Lv1–99')


if __name__ == '__main__':
    main()
