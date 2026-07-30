#!/usr/bin/env python3
"""utils/gamedata-known-ids.ts 產生器（同 tools/ship-debut 慣例：產出物勿手改，改這裡再重跑）。

輸入：samples/i18n/*.csv（三份 wiki 對照表的 master_id 欄，見 CLAUDE.md「翻譯對照表」）
輸出：utils/gamedata-known-ids.ts —— 純資料，兩個 Set<number>（已知艦娘/深海棲艦、已知裝備）

用途：鎮守府情報總括 LLM 分區的「匯出翻譯缺漏」——拿目前封包載入的 GameState.master／
masterGears 的 id 跟這兩個 Set 做差集，抓出「遊戲有、對照表沒有」的新艦娘/新裝備/新深海
棲艦，是遊戲更新後才會出現的內容。故此檔只需要 id 本身，不需要名稱或譯名。
"""
import csv
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
I18N_DIR = ROOT / 'samples' / 'i18n'
OUT = ROOT / 'utils' / 'gamedata-known-ids.ts'

SOURCES = {
    'ship_ids': ['ship-names-i18n-player.csv', 'ship-names-i18n-enemy.csv'],
    'gear_ids': ['equipment-names-i18n.csv'],
}


def read_ids(filename):
    path = I18N_DIR / filename
    with open(path, encoding='utf-8-sig', newline='') as f:
        return [int(row['master_id']) for row in csv.DictReader(f)]


def main():
    ship_ids = sorted({i for fn in SOURCES['ship_ids'] for i in read_ids(fn)})
    gear_ids = sorted({i for fn in SOURCES['gear_ids'] for i in read_ids(fn)})

    def fmt(ids):
        return ', '.join(str(i) for i in ids)

    OUT.write_text(f"""// 已知艦娘／深海棲艦／裝備 master id 集合。純資料模組、無 chrome.*（設計原則 4）。
//
// **本檔由 tools/gamedata-coverage/generate.py 產生，請勿手改**——要更新請重新下載
// kancollewiki 的 Ship list／Enemy_Sortable／Equipment List 頁面（存成 HTML，不進版控）、
// 重新整理 samples/i18n/*.csv 後重跑產生器。
//
// 用途：utils/gamedata-coverage.ts 用它跟目前封包載入的 GameState.master／masterGears
// 的 id 做差集，找出「遊戲有、對照表沒有」的新內容（新艦娘/新深海棲艦/新裝備），
// 供鎮守府情報總括 LLM 分區的「匯出翻譯缺漏」使用。
export const KNOWN_SHIP_IDS = new Set<number>([{fmt(ship_ids)}]);
export const KNOWN_GEAR_IDS = new Set<number>([{fmt(gear_ids)}]);
""", encoding='utf-8')

    print(f'艦娘/深海棲艦 {len(ship_ids)} 筆、裝備 {len(gear_ids)} 筆 → {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
