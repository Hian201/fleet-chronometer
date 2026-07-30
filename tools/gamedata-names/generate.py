#!/usr/bin/env python3
"""utils/gamedata-names.ts 產生器（同 tools/ship-debut 慣例：產出物勿手改，改這裡再重跑）。

輸入：samples/i18n/*.csv（三份 wiki 對照表，master_id 對真實封包）。name_tw 來源分兩層：
  1. 人工翻譯（沿用 samples/ship-debut-dates.json 的 tw 欄，332 艘艦娘基礎形態）
  2. 機械規則補完（tools/gamedata-names/fill-mechanical-tw.py，全漢字直接轉繁體字形、
     改造形態沿用基礎形態同規律字尾）——CSV 有新列（例如翻譯缺漏匯出抓到的新內容）時
     重跑該工具即可，只補空欄不覆蓋既有資料
兩層都補不到的（日文原名含假名，見 fill-mechanical-tw.py 開頭說明）留空，回退封包日文名。
輸出：utils/gamedata-names.ts —— SHIP_NAMES／GEAR_NAMES，形狀為
      utils/gamedata-i18n.ts 的 NameTable（Record<masterId, Partial<Record<Lang,string>>>）

只寫「有值」的語言欄——缺譯不補空字串，讓 localizeShip()/localizeGear() 的既有 fallback
（查無 → 回退封包日文原名）自然生效，不用在這裡特判。
"""
import csv
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
I18N_DIR = ROOT / 'samples' / 'i18n'
OUT = ROOT / 'utils' / 'gamedata-names.ts'


def read_rows(filename):
    with open(I18N_DIR / filename, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def build_table(rows):
    table = {}
    for r in rows:
        mid = int(r['master_id'])
        entry = {}
        en = (r.get('name_en') or '').strip()
        tw = (r.get('name_tw') or '').strip()
        if en:
            entry['en'] = en
        if tw:
            entry['zh-TW'] = tw
        if entry:
            table[mid] = entry
    return table


def fmt_table(table):
    lines = []
    for mid in sorted(table):
        entry = table[mid]
        parts = ', '.join(f"{lang!r}: {val!r}" for lang, val in entry.items())
        lines.append(f'    {mid}: {{ {parts} }},')
    return '\n'.join(lines)


def main():
    ship_rows = read_rows('ship-names-i18n-player.csv') + read_rows('ship-names-i18n-enemy.csv')
    gear_rows = read_rows('equipment-names-i18n.csv')

    ship_table = build_table(ship_rows)
    gear_table = build_table(gear_rows)

    OUT.write_text(f"""// 艦娘／裝備譯名表。純資料模組、無 chrome.*（設計原則 4）。
//
// **本檔由 tools/gamedata-names/generate.py 產生，請勿手改**——要補譯名請改
// samples/i18n/*.csv 的 name_tw／name_en 欄（來源見 CLAUDE.md「翻譯對照表」）後重跑
// 產生器。只有「有值」的語言欄會寫進來，缺譯的 id 完全不會出現在表裡——
// utils/gamedata-i18n.ts 的 localizeShip()/localizeGear() 查無 id 或該語言欄時
// 會自動回退封包原始日文名，這裡不需要（也不應該）補空字串或猜測值。
//
// 目前狀態：英文名取自 kancollewiki（Ship list／Enemy_Sortable／Equipment List），
// 覆蓋率高；繁體中文目前只有艦娘基礎形態的一部分（沿用 samples/ship-debut-dates.json
// 人工維護的 tw 欄），其餘（改造形態、深海棲艦、裝備）尚待人工翻譯補上 name_tw 後重跑。
import type {{ NameTable }} from './gamedata-i18n';

export const SHIP_NAMES: NameTable = {{
{fmt_table(ship_table)}
}};

export const GEAR_NAMES: NameTable = {{
{fmt_table(gear_table)}
}};
""", encoding='utf-8')

    ship_en = sum(1 for v in ship_table.values() if 'en' in v)
    ship_tw = sum(1 for v in ship_table.values() if 'zh-TW' in v)
    gear_en = sum(1 for v in gear_table.values() if 'en' in v)
    gear_tw = sum(1 for v in gear_table.values() if 'zh-TW' in v)
    print(f'艦娘/深海棲艦：{len(ship_table)} 筆有譯名（en {ship_en}／zh-TW {ship_tw}）')
    print(f'裝備：{len(gear_table)} 筆有譯名（en {gear_en}／zh-TW {gear_tw}）')
    print(f'寫入 {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
