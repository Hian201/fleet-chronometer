#!/usr/bin/env python3
"""samples/i18n/*.csv 的 name_tw 欄機械式補完（可重複執行的獨立工具，非產生器本體）。

規則（使用者拍板，2026-07-29／2026-07-30）：
  1. 日文原名「全漢字」（含數字／半形全形括號／單位英文字母如 cm、mm，這些本來就
     跨語言通用、不算需要翻譯）──直接用 OpenCC `jp2t`（日文新字體→繁體中文）轉換
     字形，非漢字部分原樣通過（Mk.II/Mod.2/Flight II 等**型號designation**不譯、
     跟 wiki 英文名同慣例——這些不是語言詞彙，是真實存在的編號）。
  2. 改造形態與基礎形態同規律──若基礎形態已有 name_tw：
       a. 字尾是漢字（改／改二／改二丙…）──比照規則 1 處理後接在後面。
       b. 字尾是外語的「第二／第三…改」序數詞（見 ORDINAL_WORDS：德文
          zwei/drei、法文 Deux/Trois、義大利文 due/tre、瑞典文 andra/tredje、
          俄文 два/три）──這些詞在游戏裡功能上就是該艦娘專屬的「改二／改三」，
          直接轉寫成「改二／改三」（不是音譯、不是外語直接沿用）。
       c. 字尾是型號 designation（Mk.II 等，規則 1 已處理）或其他無法歸類的外語
          （如義大利文 nuovo「新」、法文 amélioration「改良」——這兩個不是序數詞，
          是該艦線自己的命名風格）──目前原樣沿用（含在基礎名之後），非真例外，
          但也不在此規則自動處理範圍，如需比照 b 改寫成「改二」請明講。
  3. **唯一的真例外**：日文原名含假名（ひらがな／カタカナ）──代表這是需要真人翻譯
     的日文詞彙（例如深海棲艦的片假名級別字母、砲/雷/観測機等片假名裝備名、姫/鬼
     的專有名稱），機械規則在這裡刻意不猜，保持空白等人工填。

只補「目前是空的」name_tw，不覆蓋已有資料（無論是人工填的還是先前已產生的）。
執行後請重跑 `tools/gamedata-names/generate.py` 讓 utils/gamedata-names.ts 生效。

依賴：pip install opencc（不是 opencc-python-reimplemented——後者沒有 jp2t 設定檔）。
"""
import csv
import pathlib
import re

try:
    import opencc
except ImportError as e:
    raise SystemExit("需要 'opencc' 套件（非 opencc-python-reimplemented）：pip install opencc") from e

ROOT = pathlib.Path(__file__).resolve().parents[2]
I18N_DIR = ROOT / 'samples' / 'i18n'
PLAYER = I18N_DIR / 'ship-names-i18n-player.csv'
ENEMY = I18N_DIR / 'ship-names-i18n-enemy.csv'
GEAR = I18N_DIR / 'equipment-names-i18n.csv'

CC = opencc.OpenCC('jp2t')
# ひらがな＋カタカナ：唯一視為「需要真人翻譯」的訊號。
KANA = re.compile(r'[぀-ヿ]')

# 各國「改二／改三…」的序數詞字尾（第一階改造遊戲一律用漢字「改」，故此表不含
# 「第一」；先預留以防未來新艦線用到）。key 一律小寫比對（拉丁字母不分大小寫，
# 西里爾字母原樣比對）。
ORDINAL_WORDS = {
    'eins': '', 'zwei': '二', 'drei': '三', 'vier': '四',            # 德文
    'un': '', 'deux': '二', 'trois': '三', 'quatre': '四',           # 法文
    'uno': '', 'due': '二', 'tre': '三', 'quattro': '四',            # 義大利文
    'första': '', 'andra': '二', 'tredje': '三', 'fjärde': '四',     # 瑞典文
    'один': '', 'два': '二', 'три': '三', 'четыре': '四',            # 俄文
}


def read_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def write_csv(path, rows):
    fieldnames = list(rows[0].keys())
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def fill_kana_free(rows, base_only=False):
    """規則 1：全列 name_ja 不含假名 → 直接轉換套用。

    base_only：只處理基礎形態（stage=='0'）。**規則 2/2b 之前的那一輪必須開這個開關**
    ——否則不含假名的改造形態（`Bismarck改`／`Bismarck zwei`）會先被原樣填掉，規則 2/2b
    只補空欄不覆蓋，就再也輪不到它們，外語艦線的 name_tw 會全部停在外語（例：
    `Bismarck改` 而非 `俾斯麥改`）。深海棲艦／裝備兩份沒有 stage 欄，一律不開。
    """
    n = 0
    for r in rows:
        if r.get('name_tw', '').strip():
            continue
        if base_only and r.get('stage') != '0':
            continue
        ja = r['name_ja']
        if not KANA.search(ja):
            r['name_tw'] = CC.convert(ja)
            n += 1
    return n


def fill_remodel_suffix(player_rows):
    """規則 2：改造形態沿用基礎形態的 name_tw + 同規律字尾（僅玩家艦娘，需要
    line_id/stage 分組資訊，深海棲艦／裝備沒有這種艦線關係，不適用）。"""
    by_line = {}
    for r in player_rows:
        by_line.setdefault(r['line_id'], []).append(r)
    n = 0
    for members in by_line.values():
        base = next((m for m in members if m['stage'] == '0'), None)
        if not base or not base.get('name_tw', '').strip():
            continue
        base_ja, base_tw = base['name_ja'], base['name_tw']
        for m in members:
            if m['stage'] == '0' or m.get('name_tw', '').strip():
                continue
            ja = m['name_ja']
            if ja.startswith(base_ja):
                suffix = ja[len(base_ja):]
                if suffix and not KANA.search(suffix):
                    m['name_tw'] = base_tw + CC.convert(suffix)
                    n += 1
    return n


def fill_ordinal_suffix(player_rows):
    """規則 2b：字尾是外語序數詞（ORDINAL_WORDS）→ 轉寫成「改二／改三…」，
    不是音譯、不是外語沿用（同規則 2 只適用玩家艦娘，需要 line_id/stage 分組）。"""
    by_line = {}
    for r in player_rows:
        by_line.setdefault(r['line_id'], []).append(r)
    n = 0
    for members in by_line.values():
        base = next((m for m in members if m['stage'] == '0'), None)
        if not base or not base.get('name_tw', '').strip():
            continue
        base_ja, base_tw = base['name_ja'], base['name_tw']
        for m in members:
            if m['stage'] == '0' or m.get('name_tw', '').strip():
                continue
            ja = m['name_ja']
            if not ja.startswith(base_ja):
                continue
            suffix = ja[len(base_ja):].strip()
            numeral = ORDINAL_WORDS.get(suffix.lower())
            if numeral is not None:
                m['name_tw'] = base_tw + '改' + numeral
                n += 1
    return n


def main():
    player_rows = read_csv(PLAYER)
    enemy_rows = read_csv(ENEMY)
    gear_rows = read_csv(GEAR)

    # 順序要緊：規則 2/2b 都要靠「基礎形態已有 name_tw」，故先跑一輪規則 1 **只補基礎
    # 形態**（base_only=True——漏了這個開關，改造形態會在這一輪就被原樣填掉，規則 2/2b
    # 只補空欄不覆蓋，就永遠輪不到）；規則 2b（序數詞轉寫）同理要在規則 1 的收尾 pass
    # 之前跑。最後再跑一次規則 1 掃尾（不限 stage），補齊 Mk.II/nuovo 這類無法歸類的
    # 殘餘外語字尾、以及深海棲艦／裝備兩份沒有艦線概念的表。
    # 2b 要在 2a **之前**跑：2a 只看「字尾不含假名」，外語序數詞也符合，先跑就會把
    # `Bismarck zwei` 填成「俾斯麥 zwei」而不是「俾斯麥改二」（＝已提交 CSV 的內容）。
    # 兩者不會互搶：ORDINAL_WORDS 全是拉丁／西里爾字，漢字字尾不可能命中 2b。
    fill_kana_free(player_rows, base_only=True)
    ordinal_n = fill_ordinal_suffix(player_rows)
    suffix_n = fill_remodel_suffix(player_rows)
    player_n = fill_kana_free(player_rows)
    enemy_n = fill_kana_free(enemy_rows)
    gear_n = fill_kana_free(gear_rows)

    write_csv(PLAYER, player_rows)
    write_csv(ENEMY, enemy_rows)
    write_csv(GEAR, gear_rows)

    def report(label, rows):
        missing = sum(1 for r in rows if not r.get('name_tw', '').strip())
        print(f'{label}：共 {len(rows)}，仍缺 name_tw 的 {missing} 筆需要真人翻譯（皆含假名）')

    print(f'改造同規律（漢字）新填 {suffix_n} 筆、序數詞轉寫新填 {ordinal_n} 筆、'
          f'其餘機械規則新填 player {player_n}／enemy {enemy_n}／gear {gear_n} 筆')
    report('玩家艦娘', player_rows)
    report('深海棲艦', enemy_rows)
    report('裝備', gear_rows)


if __name__ == '__main__':
    main()
