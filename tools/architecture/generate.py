#!/usr/bin/env python3
"""README 用架構圖產生器。

輸出 docs/architecture-{en,zh-TW,ja}.svg（三份 README 各一）。
版面座標寫死在 LAYOUT，文案寫死在 STRINGS；換行位置由字串陣列決定（不做自動斷行，
CJK 與拉丁字寬差太多，交給人工斷行才不會溢出卡片）。

**產生物勿手改 SVG**——改這支再重跑：

    python3 tools/architecture/generate.py

PNG（可選，給不吃 SVG 的場合）：見同目錄 README.md。

刻意不用 <style>/CSS class：GitHub 會清洗 README 內嵌 SVG，樣式一律走 presentation
attribute 才保證顯示一致。
"""

from __future__ import annotations

import html
import pathlib

# ── 版面 ────────────────────────────────────────────────
W, H = 1280, 1010

FONT = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', "
        "'Noto Sans CJK TC', 'Noto Sans CJK JP', 'PingFang TC', 'Hiragino Sans', "
        "'Microsoft JhengHei', Roboto, Helvetica, Arial, sans-serif")

# 取自 entrypoints/panel/index.html 的亮色主題變數與 docs/design-guidelines.md 的語意色。
# 圖自帶不透明底色，故在 GitHub 亮/暗兩種主題下都可讀。
BG = '#f4f6fa'
CARD = '#ffffff'
TINT = '#f8fafc'
LINE = '#d3d8e2'
TEXT = '#26303f'
DIM = '#6b7688'
SEA = '#182c46'
BRASS = '#9a6b0b'
OK = '#2f7d4f'
NO = '#c0392b'
TAP = '#2f8fcf'

BOX_Y, BOX_H = 172, 100
SERVER_X, GAME_X, BOX_W = 210, 730, 340
EXT_X, EXT_Y, EXT_W, EXT_H = 48, 356, 1184, 368
STAGE_Y, STAGE_H, STAGE_W = 410, 162, 257
STAGE_XS = [72, 365, 658, 951]
OUT_Y, OUT_H = 596, 104
CHIP_XS = [96, 372, 648, 924]
CHIP_W = 260
FOOT_Y = 748
LEFT_W, RIGHT_X, RIGHT_W, FOOT_H = 712, 784, 448, 200


# ── SVG 基本元件 ─────────────────────────────────────────
def esc(s: str) -> str:
    return html.escape(s, quote=False)


def rect(x, y, w, h, fill, stroke=None, rx=12, sw=1.5) -> str:
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{s}/>'


def text(x, y, s, size=14, fill=TEXT, weight='400', anchor='start', tracking=None) -> str:
    t = f' letter-spacing="{tracking}"' if tracking else ''
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{t}>{esc(s)}</text>')


def line(x1, y1, x2, y2, stroke=LINE, sw=1.5, dash=None) -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"{d}/>'


def tri(cx, cy, direction, size, fill) -> str:
    """箭頭三角形。direction: 'l' / 'r' / 'd'。以顯式多邊形取代 marker（清洗器安全）。"""
    if direction == 'r':
        pts = f'{cx - size},{cy - size * 0.72} {cx + size * 0.5},{cy} {cx - size},{cy + size * 0.72}'
    elif direction == 'l':
        pts = f'{cx + size},{cy - size * 0.72} {cx - size * 0.5},{cy} {cx + size},{cy + size * 0.72}'
    else:
        pts = f'{cx - size * 0.72},{cy - size} {cx},{cy + size * 0.5} {cx + size * 0.72},{cy - size}'
    return f'<polygon points="{pts}" fill="{fill}"/>'


def cross(cx, cy, r=5.2, stroke=NO) -> str:
    return (f'<path d="M{cx - r},{cy - r} L{cx + r},{cy + r} M{cx + r},{cy - r} L{cx - r},{cy + r}" '
            f'fill="none" stroke="{stroke}" stroke-width="2.4" stroke-linecap="round"/>')


def check(cx, cy, stroke=OK) -> str:
    return (f'<path d="M{cx - 5.5},{cy - 0.2} L{cx - 1.8},{cy + 4} L{cx + 5.8},{cy - 5}" '
            f'fill="none" stroke="{stroke}" stroke-width="2.6" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


def badge(cx, cy, label) -> str:
    return (f'<circle cx="{cx}" cy="{cy}" r="15" fill="{SEA}"/>'
            + text(cx, cy + 5, label, 14.5, '#ffffff', '700', 'middle'))


def mark(x, y) -> str:
    """扁平化的計時器標記（取自 tools/app-icon/chronometer.svg，去漸層以利清洗器）。"""
    return (f'<g transform="translate({x},{y})">'
            f'<rect x="0" y="0" width="46" height="46" rx="11" fill="{SEA}"/>'
            f'<circle cx="23" cy="24" r="15.5" fill="{BRASS}"/>'
            f'<circle cx="23" cy="24" r="12" fill="#f3ead0"/>'
            f'<path d="M23,24 L23,16.5" stroke="#202b35" stroke-width="2.2" stroke-linecap="round"/>'
            f'<path d="M23,24 L28.6,27.2" stroke="#202b35" stroke-width="1.8" stroke-linecap="round"/>'
            f'<circle cx="23" cy="24" r="1.9" fill="#b77b21"/>'
            f'<path d="M23,4.5 L23,8" stroke="#f3ce72" stroke-width="2.6" stroke-linecap="round"/>'
            f'</g>')


# ── 文案 ────────────────────────────────────────────────
STRINGS = {
    'en': {
        'title': 'Fleet Chronometer — how it works',
        'subtitle': 'A passive KanColle monitor. It reads a copy of what the game already sent you — and nothing else.',
        'capA1': "The game talks to its servers exactly as it always has.",
        'capA2': 'Fleet Chronometer never sends, delays, alters or resends any of it.',
        'server': 'KanColle game servers',
        'serverSub': 'DMM / kancolle-server.com',
        'game': 'Your browser — the game tab',
        'gameSub': 'The game runs completely unchanged',
        'tap': ['A read-only copy of a response',
                'the game has already received'],
        'extTitle': 'Fleet Chronometer — runs entirely inside your browser. This project has no server, anywhere.',
        'stages': [
            ('Observe & sanitise', 'CONTENT SCRIPTS IN THE GAME PAGE',
             ['Copies the response the game has',
              'already received, then deletes your',
              'login token before anything is kept.']),
            ('File it once', 'BACKGROUND SERVICE WORKER',
             ['Parses the packet and writes one',
              'record. Every capture goes through',
              'this single entry point.']),
            ('Keep it local', 'INDEXEDDB, ON YOUR OWN COMPUTER',
             ['Events, sorties, expeditions,',
              'factory, resources, replays —',
              'all on your disk. Never uploaded.']),
            ('Work it out', 'PURE TYPESCRIPT CORE',
             ['Fleet state, battle prediction,',
              'MVP, heavy-damage warnings,',
              'fuel and ammo. All computed here.']),
        ],
        'outTitle': 'What you actually see',
        'chips': ['Live panel', 'Overview page', 'Desktop notifications',
                  'Backups to a folder you pick'],
        'neverTitle': 'What it never does',
        'never': [
            'Never sends a request to the game server',
            "Never modifies, delays or resends the game's traffic",
            'Never plays for you — no automation, no macros',
            'Never uploads your data — there is no backend',
            'Never stores your login token (api_token)',
        ],
        'livesTitle': 'Where your data lives',
        'lives': [
            "In your browser's local database (IndexedDB)",
            'In backup files, in a folder you choose',
            'No cloud account, no sync service, no telemetry',
        ],
        'livesNote': 'Nothing ever leaves your computer.',
        'foot': [
            'Permissions granted at install: alarms, notifications, scripting, activeTab, tabs — and zero access to any website.',
            'Page access for Fit to Window and screenshots is requested only at the moment you press the button.',
        ],
    },
    'zh-TW': {
        'title': 'Fleet Chronometer — 運作原理',
        'subtitle': '被動式艦これ監控：只讀取「遊戲已經收到」的那份回應的副本，其餘一概不做。',
        'capA1': '遊戲與伺服器之間，完全照原本的方式通訊。',
        'capA2': '本擴充不發送、不延遲、不修改、不重送其中任何一筆。',
        'server': '艦これ遊戲伺服器',
        'serverSub': 'DMM／kancolle-server.com',
        'game': '你的瀏覽器 — 遊戲分頁',
        'gameSub': '遊戲行為完全不受影響',
        'tap': ['只複製一份遊戲「已經收到」的',
                '回應內容（唯讀）'],
        'extTitle': 'Fleet Chronometer — 全部在你的瀏覽器內執行；本專案沒有任何伺服器。',
        'stages': [
            ('攔截與清理', '遊戲頁內的 CONTENT SCRIPT',
             ['複製回應的原始文字，在任何',
              '資料落地之前，先刪掉你的',
              '登入 token（api_token）。']),
            ('統一歸檔', '背景 SERVICE WORKER',
             ['解析封包，寫成一筆紀錄。',
              '所有擷取只走這一個入口，',
              '沒有任何路徑可以繞過。']),
            ('留在本機', 'INDEXEDDB，就在你的電腦上',
             ['事件、出擊、遠征、工廠、',
              '資源、重播——全在你的硬碟。',
              '不上傳，永遠不上傳。']),
            ('推算結果', '純 TYPESCRIPT 核心',
             ['艦隊狀態、戰鬥預測、MVP、',
              '大破警告、燃彈估算——',
              '全部在你的機器上算完。']),
        ],
        'outTitle': '你實際看到的畫面',
        'chips': ['即時面板', '鎮守府情報總括', '桌面通知', '備份到你指定的資料夾'],
        'neverTitle': '絕對不會做的事',
        'never': [
            '絕不對遊戲伺服器送出任何請求',
            '絕不修改、延遲或重送遊戲的流量',
            '絕不代打——沒有自動化、沒有腳本',
            '絕不上傳你的資料——本專案沒有後端',
            '絕不儲存你的登入 token（api_token）',
        ],
        'livesTitle': '你的資料在哪裡',
        'lives': [
            '瀏覽器的本機資料庫（IndexedDB）',
            '備份檔，只寫進你自己選的資料夾',
            '沒有雲端帳號、沒有同步服務、沒有遙測',
        ],
        'livesNote': '沒有任何資料離開你的電腦。',
        'foot': [
            '安裝時取得的權限：alarms、notifications、scripting、activeTab、tabs——且不含任何網站的存取權。',
            '視窗適應與拍照所需的頁面存取權，只在你按下按鈕的當下才索取。',
        ],
    },
    'ja': {
        'title': 'Fleet Chronometer — 仕組み',
        'subtitle': '受動型の艦これモニター。ゲームが既に受け取った応答のコピーを読むだけです。',
        'capA1': 'ゲームとサーバーの通信は、これまでどおり行われます。',
        'capA2': '本拡張はその一つも送信・遅延・改変・再送しません。',
        'server': '艦これゲームサーバー',
        'serverSub': 'DMM／kancolle-server.com',
        'game': 'あなたのブラウザ — ゲームタブ',
        'gameSub': 'ゲームの動作は一切変わりません',
        'tap': ['ゲームが既に受け取った応答の',
                'コピーを読むだけ（読み取り専用）'],
        'extTitle': 'Fleet Chronometer — すべてブラウザ内で動作。本プロジェクトのサーバーは存在しません。',
        'stages': [
            ('取得と除去', 'ゲームページ内の CONTENT SCRIPT',
             ['応答のテキストをコピーし、',
              '保存される前にログイン用の',
              'api_token を削除します。']),
            ('一元的に記録', 'バックグラウンド SERVICE WORKER',
             ['パケットを解析し 1 件記録します。',
              '取得はすべてこの単一の入口を通り、',
              '迂回する経路はありません。']),
            ('ローカルに保管', 'INDEXEDDB（あなたの PC 内）',
             ['イベント、出撃、遠征、工廠、',
              '資源、リプレイ——すべて手元に。',
              'アップロードは一切しません。']),
            ('計算する', '純粋な TYPESCRIPT コア',
             ['艦隊状態、戦闘予測、MVP、',
              '大破警告、燃料弾薬の推定——',
              'すべて手元の PC で計算します。']),
        ],
        'outTitle': '実際に表示されるもの',
        'chips': ['ライブパネル', '鎮守府情報総括', 'デスクトップ通知', '任意のフォルダへバックアップ'],
        'neverTitle': '絶対にしないこと',
        'never': [
            'ゲームサーバーへリクエストを送りません',
            'ゲーム通信の改変・遅延・再送をしません',
            '自動操作やマクロによる代行をしません',
            'データをアップロードしません（バックエンド無し）',
            'ログイン token（api_token）を保存しません',
        ],
        'livesTitle': 'データの保管場所',
        'lives': [
            'ブラウザのローカル DB（IndexedDB）',
            'バックアップは、あなたが選んだフォルダのみ',
            'クラウド連携・同期・テレメトリはありません',
        ],
        'livesNote': 'PC の外に出ることはありません。',
        'foot': [
            'インストール時の権限：alarms、notifications、scripting、activeTab、tabs — サイトへのアクセス権はゼロです。',
            'ウィンドウ適応とスクリーンショット用のページアクセスは、ボタンを押した瞬間にのみ要求します。',
        ],
    },
}


def build(s: dict) -> str:
    o: list[str] = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
             f'viewBox="0 0 {W} {H}" role="img" aria-label="{esc(s["title"])}">')
    o.append(f'<title>{esc(s["title"])}</title>')
    o.append(f'<desc>{esc(s["subtitle"])}</desc>')
    o.append(rect(0, 0, W, H, BG, rx=0))

    # ── 標頭 ──
    o.append(mark(48, 22))
    o.append(text(112, 50, s['title'], 27, SEA, '700', tracking='-0.01em'))
    o.append(text(112, 76, s['subtitle'], 14.5, DIM))
    o.append(line(48, 98, 1232, 98))

    # ── ① 遊戲照常運作 ──
    o.append(text(640, 128, s['capA1'], 14.5, DIM, anchor='middle'))
    o.append(text(640, 152, s['capA2'], 15, OK, '700', anchor='middle'))

    o.append(rect(SERVER_X, BOX_Y, BOX_W, BOX_H, CARD, LINE))
    for i, gy in enumerate((206, 218, 230)):
        o.append(rect(236, gy, 30, 9, SEA, rx=2.5))
        o.append(f'<circle cx="{261}" cy="{gy + 4.5}" r="1.8" fill="#f3ce72"/>')
    o.append(text(282, 216, s['server'], 16.5, TEXT, '700'))
    o.append(text(282, 240, s['serverSub'], 12.5, DIM))

    o.append(rect(GAME_X, BOX_Y, BOX_W, BOX_H, CARD, LINE))
    o.append(rect(756, 210, 30, 24, '#ffffff', SEA, rx=3.5, sw=1.8))
    o.append(line(756, 217.5, 786, 217.5, SEA, 1.8))
    for i in range(3):
        o.append(f'<circle cx="{760.5 + i * 4.5}" cy="{213.8}" r="1.1" fill="{SEA}"/>')
    o.append(text(802, 216, s['game'], 16.5, TEXT, '700'))
    o.append(text(802, 240, s['gameSub'], 12.5, DIM))

    o.append(line(566, 222, 714, 222, SEA, 2.6))
    o.append(tri(562, 222, 'l', 8, SEA))
    o.append(tri(718, 222, 'r', 8, SEA))

    # ── ② 唯讀副本（虛線＝只複製，不介入）──
    o.append(line(900, BOX_Y + BOX_H, 900, EXT_Y - 8, TAP, 2.4, dash='7 6'))
    o.append(tri(900, EXT_Y - 2, 'd', 8, TAP))
    o.append(badge(920 + 15, 306, '1'))
    o.append(text(956, 302, s['tap'][0], 13.5, TEXT, '600'))
    o.append(text(956, 321, s['tap'][1], 13.5, TEXT, '600'))

    # ── 擴充邊界 ──
    o.append(rect(EXT_X, EXT_Y, EXT_W, EXT_H, CARD, BRASS, rx=16, sw=2))
    o.append(text(72, 390, s['extTitle'], 16, SEA, '700'))

    for i, (title, sub, body) in enumerate(s['stages']):
        x = STAGE_XS[i]
        o.append(rect(x, STAGE_Y, STAGE_W, STAGE_H, TINT, LINE, rx=11))
        o.append(badge(x + 30, STAGE_Y + 32, str(i + 2)))
        o.append(text(x + 56, STAGE_Y + 38, title, 16, TEXT, '700'))
        o.append(text(x + 18, STAGE_Y + 64, sub, 10.5, BRASS, '700', tracking='0.06em'))
        o.append(line(x + 18, STAGE_Y + 78, x + STAGE_W - 18, STAGE_Y + 78))
        for j, ln in enumerate(body):
            o.append(text(x + 18, STAGE_Y + 100 + j * 20, ln, 12.5, TEXT))
        if i < 3:
            cx = (x + STAGE_W + STAGE_XS[i + 1]) / 2
            o.append(f'<path d="M{cx - 4},{STAGE_Y + 75} L{cx + 4},{STAGE_Y + 81} '
                     f'L{cx - 4},{STAGE_Y + 87}" fill="none" stroke="{DIM}" stroke-width="2.4" '
                     f'stroke-linecap="round" stroke-linejoin="round"/>')

    o.append(line(640, STAGE_Y + STAGE_H, 640, OUT_Y - 6, DIM, 2.2))
    o.append(tri(640, OUT_Y - 1, 'd', 7, DIM))

    o.append(rect(72, OUT_Y, 1136, OUT_H, TINT, LINE, rx=11))
    o.append(badge(96 + 15, OUT_Y + 28, '6'))
    o.append(text(132, OUT_Y + 33, s['outTitle'], 15.5, TEXT, '700'))
    for i, chip in enumerate(s['chips']):
        o.append(rect(CHIP_XS[i], OUT_Y + 46, CHIP_W, 40, CARD, LINE, rx=20))
        o.append(text(CHIP_XS[i] + CHIP_W / 2, OUT_Y + 71, chip, 13.5, TEXT, '600', 'middle'))

    # ── 絕不會做的事 ──
    o.append(rect(EXT_X, FOOT_Y, LEFT_W, FOOT_H, CARD, LINE, rx=14))
    o.append(text(72, FOOT_Y + 32, s['neverTitle'], 16, NO, '700'))
    for i, item in enumerate(s['never']):
        y = FOOT_Y + 64 + i * 26
        o.append(cross(82, y - 4.5))
        o.append(text(102, y, item, 13.5, TEXT))

    # ── 資料在哪裡 ──
    o.append(rect(RIGHT_X, FOOT_Y, RIGHT_W, FOOT_H, CARD, LINE, rx=14))
    o.append(text(RIGHT_X + 24, FOOT_Y + 32, s['livesTitle'], 16, OK, '700'))
    for i, item in enumerate(s['lives']):
        y = FOOT_Y + 64 + i * 30
        o.append(check(RIGHT_X + 34, y - 4.5))
        o.append(text(RIGHT_X + 54, y, item, 13.5, TEXT))
    o.append(text(RIGHT_X + 24, FOOT_Y + 172, s['livesNote'], 13.5, OK, '700'))

    for i, ln in enumerate(s['foot']):
        o.append(text(640, 974 + i * 18, ln, 12, DIM, anchor='middle'))

    o.append('</svg>')
    return '\n'.join(o) + '\n'


def main() -> None:
    docs = pathlib.Path(__file__).resolve().parents[2] / 'docs'
    docs.mkdir(exist_ok=True)
    for lang, strings in STRINGS.items():
        out = docs / f'architecture-{lang}.svg'
        out.write_text(build(strings), encoding='utf-8')
        print(f'wrote {out.relative_to(docs.parent)}')


if __name__ == '__main__':
    main()
