# -*- coding: utf-8 -*-
"""fleet-chronometer 裝備／資源圖示產生器（原創向量，以遊戲原圖構圖概念為藍本）。
配色：機身/器材主色取自 EO 原圖採樣（遊戲慣例的客觀依據）；徽章文字與顏色依使用者實機確認。
輸出：<id>.svg（檔名即 api_type[3]）。viewBox 32×32。
"""
import os, sys, colorsys

OUT_EQ = sys.argv[1]
OUT_RS = sys.argv[2]
os.makedirs(OUT_EQ, exist_ok=True)
os.makedirs(OUT_RS, exist_ok=True)

# ── 深色底可讀性（硬約束）────────────────────────────────
# 面板背景為深色，近黑色會被背景吸收（16px 小圖尤其明顯）。故所有輸出色一律過
# clamp_light()，強制 HSL 明度 ≥ FLOOR，保留色相與飽和。與飛機族（planes_all.py）同一組參數。
FLOOR = 0.26

def _parse(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def _hex(r, g, b):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v*255))) for v in (r, g, b))
def clamp_light(hexc, lo=None):
    """明度下限（lo=None 時於呼叫時讀 FLOOR，不可用預設參數綁定）。"""
    lo = FLOOR if lo is None else lo
    r, g, b = _parse(hexc)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return _hex(*colorsys.hls_to_rgb(h, max(l, lo), s))

FONT = "'Hiragino Sans','Noto Sans CJK TC','Microsoft JhengHei',sans-serif"

# ── 徽章：黑底＋對應色外框與字（實機確認的樣式）──────────────────
def badge_hex(cx, cy, color, kanji):
    r = 6.9; hw = r * 0.866; hh = r * 0.5
    pts = f"{cx},{cy-r} {cx+hw},{cy-hh} {cx+hw},{cy+hh} {cx},{cy+r} {cx-hw},{cy+hh} {cx-hw},{cy-hh}"
    return (f'<polygon points="{pts}" fill="#000" stroke="{color}" stroke-width="1.3" stroke-linejoin="round"/>'
            f'<text x="{cx}" y="{cy+3.2}" font-size="8.8" font-weight="700" fill="{color}" '
            f'text-anchor="middle" font-family="{FONT}">{kanji}</text>')

def badge_rect(cx, cy, color, k2):
    return (f'<rect x="{cx-7.6}" y="{cy-5.1}" width="15.2" height="10.2" rx="3" fill="#000" '
            f'stroke="{color}" stroke-width="1.3"/>'
            f'<text x="{cx}" y="{cy+2.6}" font-size="7" font-weight="700" fill="{color}" '
            f'text-anchor="middle" letter-spacing="-0.4" font-family="{FONT}">{k2}</text>')

def badge_bare(cx, cy, color, kanji):
    """無六邊形的裸字徽章（51 夜間水上魚雷機）"""
    return (f'<text x="{cx}" y="{cy+3.4}" font-size="10" font-weight="700" fill="{color}" '
            f'text-anchor="middle" font-family="{FONT}">{kanji}</text>')

BADGE_POS = (23.6, 23.2)      # 六邊形／裸字中心
BADGE_POS_R = (22.6, 24.4)    # 圓矩形中心

def bdg(spec):
    if not spec: return ''
    kind, color, text = spec
    if kind == 'hex':  return badge_hex(*BADGE_POS, color, text)
    if kind == 'rect': return badge_rect(*BADGE_POS_R, color, text)
    if kind == 'bare': return badge_bare(*BADGE_POS, color, text)
    return ''

def svg(body):
    # 本體包進 <g class="a">：normalize.py 會量測其實際渲染範圍並注入縮放，
    # 使全 69 顆的視覺佔用一致（見 tools/icons/README.md「尺寸正規化」）。
    return ('<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            '<g class="a">' + body + '</g></svg>')

def shade(hex_color, f=0.62):
    """主色的暗階（結構線用）。輸出過明度下限，避免深色底吸收。"""
    h = hex_color.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return clamp_light('#%02x%02x%02x' % (int(r*f), int(g*f), int(b*f)))

def light(hex_color, f=0.35):
    h = hex_color.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return clamp_light('#%02x%02x%02x' % (int(r+(255-r)*f), int(g+(255-g)*f), int(b+(255-b)*f)))

ICONS = {}

# ══ A. 砲熕族：俯視砲塔（幾何＝預覽頁已驗收版本原樣移植；色＝EO 採樣的口徑分級）══
def turret_twin(main, size):
    """小/中口径主砲：雙管朝8點鐘。size='s'|'m'"""
    d = shade(main, 0.62); lt = light(main, 0.12)
    if size == 's':
        return ''.join([
            f'<rect x="20.15" y="13.45" width="11" height="1.5" rx="0.75" fill="{lt}" transform="rotate(150 20.15 14.2)"/>',
            f'<rect x="18.65" y="10.85" width="11" height="1.5" rx="0.75" fill="{lt}" transform="rotate(150 18.65 11.6)"/>',
            f'<rect x="29.35" y="13.45" width="1.8" height="1.5" rx="0.7" fill="{d}" transform="rotate(150 20.15 14.2)"/>',
            f'<rect x="27.85" y="10.85" width="1.8" height="1.5" rx="0.7" fill="{d}" transform="rotate(150 18.65 11.6)"/>',
            f'<rect x="16.25" y="7.5" width="7.5" height="7" rx="1.8" fill="{main}" transform="rotate(30 20 11)"/>',
            f'<rect x="17.6" y="8.7" width="3" height="4.6" rx="1" fill="{d}" opacity="0.4" transform="rotate(30 20 11)"/>',
        ])
    return ''.join([
        f'<rect x="19.75" y="13.82" width="12.5" height="1.9" rx="0.95" fill="{lt}" transform="rotate(150 19.75 14.77)"/>',
        f'<rect x="18.05" y="10.88" width="12.5" height="1.9" rx="0.95" fill="{lt}" transform="rotate(150 18.05 11.83)"/>',
        f'<rect x="30.25" y="13.82" width="2" height="1.9" rx="0.9" fill="{d}" transform="rotate(150 19.75 14.77)"/>',
        f'<rect x="28.55" y="10.88" width="2" height="1.9" rx="0.9" fill="{d}" transform="rotate(150 18.05 11.83)"/>',
        f'<rect x="14.6" y="7.1" width="9.8" height="8.8" rx="2.2" fill="{main}" transform="rotate(30 19.5 11.5)"/>',
        f'<rect x="16.2" y="8.6" width="3.8" height="5.8" rx="1.2" fill="{d}" opacity="0.4" transform="rotate(30 19.5 11.5)"/>',
    ])

def turret_triple(main):
    """大口径主砲（46cm三連装）：三管朝4點鐘"""
    d = shade(main, 0.62); lt = light(main, 0.12)
    return ''.join([
        f'<rect x="14.6" y="10" width="12.5" height="2.4" rx="1.2" fill="{shade(main,0.8)}" transform="rotate(30 14.6 11.2)"/>',
        f'<rect x="13" y="12.8" width="13.5" height="2.4" rx="1.2" fill="{lt}" transform="rotate(30 13 14)"/>',
        f'<rect x="11.4" y="15.6" width="12.5" height="2.4" rx="1.2" fill="{shade(main,0.8)}" transform="rotate(30 11.4 16.8)"/>',
        f'<rect x="25.1" y="10" width="2" height="2.4" rx="1" fill="{d}" transform="rotate(30 14.6 11.2)"/>',
        f'<rect x="24.5" y="12.8" width="2" height="2.4" rx="1" fill="{d}" transform="rotate(30 13 14)"/>',
        f'<rect x="21.9" y="15.6" width="2" height="2.4" rx="1" fill="{d}" transform="rotate(30 11.4 16.8)"/>',
        f'<rect x="1.5" y="6.5" width="12.5" height="12.5" rx="3" fill="{main}" transform="rotate(30 7.75 12.75)"/>',
        f'<rect x="3.5" y="9" width="5.5" height="7.5" rx="1.8" fill="{d}" opacity="0.4" transform="rotate(30 7.75 12.75)"/>',
    ])

def turret_small_gun(main):
    """副砲：最小基座・單管朝8點鐘"""
    d = shade(main, 0.62); lt = light(main, 0.12)
    return ''.join([
        f'<rect x="19.6" y="12.2" width="9.4" height="1.5" rx="0.75" fill="{lt}" transform="rotate(150 19.6 12.95)"/>',
        f'<rect x="27.2" y="12.2" width="1.8" height="1.5" rx="0.7" fill="{d}" transform="rotate(150 19.6 12.95)"/>',
        f'<rect x="16.6" y="9.6" width="6.6" height="6.2" rx="1.6" fill="{main}" transform="rotate(30 19.9 12.7)"/>',
        f'<rect x="17.8" y="10.7" width="2.6" height="4" rx="0.9" fill="{d}" opacity="0.4" transform="rotate(30 19.9 12.7)"/>',
    ])

ICONS[1] = svg(turret_twin("#ff8080", 's'))     # 小口径主砲
ICONS[2] = svg(turret_twin("#ff4040", 'm'))     # 中口径主砲
ICONS[3] = svg(turret_triple("#ff0000"))        # 大口径主砲（46cm三連装）
ICONS[4] = svg(turret_small_gun("#ffdd00"))     # 副砲

def aa_gun_mount(main, barrels=2):
    """高角砲：仰角雙管"""
    d = shade(main); lt = light(main, 0.28)
    p = []
    xs = [16 - (barrels-1)*1.5 + i*3.0 for i in range(barrels)]
    for x in xs:
        p.append(f'<rect x="{x-0.85:.2f}" y="3.2" width="1.7" height="13" rx="0.85" fill="{lt}" '
                 f'transform="rotate(-18 {x:.2f} 16)"/>')
        p.append(f'<rect x="{x-0.85:.2f}" y="3.2" width="1.7" height="2.2" rx="0.85" fill="{d}" '
                 f'transform="rotate(-18 {x:.2f} 16)"/>')
    p.append(f'<path fill="{main}" d="M7.5 25.5 Q7.5 16.2 16 16.2 Q24.5 16.2 24.5 25.5 Z"/>')
    p.append(f'<rect x="5.5" y="25" width="21" height="3.4" rx="1.7" fill="{d}"/>')
    return ''.join(p)
ICONS[16] = svg(aa_gun_mount("#60d080", 2))     # 高角砲

# ══ B. 對空器材族 ═══════════════════════════════════════════════
def mg_mount():                                                               # 対空機銃（多連裝機銃）
    main = "#60d080"; d = shade(main); lt = light(main, 0.3)
    p = []
    for x in (12.4, 16.0, 19.6):
        p.append(f'<rect x="{x-0.75}" y="2.6" width="1.5" height="14" rx="0.75" fill="{lt}"/>')
        p.append(f'<rect x="{x-0.75}" y="2.6" width="1.5" height="2" rx="0.75" fill="{d}"/>')
    p.append(f'<rect x="9.5" y="15.4" width="13" height="5.2" rx="1.6" fill="{main}"/>')
    p.append(f'<circle cx="23.6" cy="18" r="2.1" fill="{d}"/>')
    p.append(f'<path fill="{main}" d="M9 28 Q9 20.4 16 20.4 Q23 20.4 23 28 Z"/>')
    p.append(f'<rect x="7" y="27.4" width="18" height="3" rx="1.5" fill="{d}"/>')
    return ''.join(p)
ICONS[15] = svg(mg_mount())

def aa_director():                                                            # 高射装置（測距儀）
    main = "#889955"; d = shade(main); lt = light(main, 0.32)
    return ''.join([
        f'<rect x="1.8" y="12.4" width="28.4" height="4.4" rx="2.2" fill="{lt}"/>',
        f'<circle cx="3.6" cy="14.6" r="2.6" fill="{d}"/>',
        f'<circle cx="28.4" cy="14.6" r="2.6" fill="{d}"/>',
        f'<rect x="10.5" y="9.2" width="11" height="10.6" rx="2.4" fill="{main}"/>',
        f'<rect x="13.6" y="11.4" width="4.8" height="3.4" rx="1" fill="{d}" opacity="0.5"/>',
        f'<rect x="14.4" y="19.4" width="3.2" height="5" fill="{d}"/>',
        f'<path fill="{main}" d="M9.5 29.4 Q9.5 23.4 16 23.4 Q22.5 23.4 22.5 29.4 Z"/>',
    ])
ICONS[30] = svg(aa_director())

# ══ C. 水雷族 ══════════════════════════════════════════════════
def torpedo(main="#4080c0"):
    d = shade(main); lt = light(main, 0.3)
    return ''.join([
        f'<path fill="{lt}" d="M8 12.6 L24.5 12.6 Q29.6 13.2 30.2 16 Q29.6 18.8 24.5 19.4 L8 19.4 Z"/>',
        f'<path fill="{d}" d="M8.4 13.4 L3.2 8.4 L3.2 13.4 Z"/>',
        f'<path fill="{d}" d="M8.4 18.6 L3.2 23.6 L3.2 18.6 Z"/>',
        f'<rect x="1.8" y="13.6" width="2.4" height="4.8" rx="1.2" fill="{d}"/>',
        f'<path fill="{d}" d="M12.5 12.6 L14.6 8.6 L16.7 12.6 Z"/>',
        f'<circle cx="26.4" cy="16" r="1.6" fill="{main}"/>',
    ])
ICONS[5] = svg(torpedo())

def sub_equip():                                                              # 潜水艦装備（潛望鏡＋艇殼）
    main = "#99bbee"; d = shade(main, 0.55); lt = light(main, 0.3)
    return ''.join([
        f'<path fill="{main}" d="M2.5 18.5 Q2.5 15.4 6 15.4 L26 15.4 Q29.5 15.4 29.5 18.5 Q29.5 22.6 24 22.6 L8 22.6 Q2.5 22.6 2.5 18.5 Z"/>',
        f'<rect x="13.2" y="10.6" width="5.6" height="5.6" rx="1.4" fill="{lt}"/>',
        f'<rect x="15.2" y="3.4" width="1.9" height="8" rx="0.95" fill="{d}"/>',
        f'<rect x="15.2" y="3.4" width="4.4" height="1.9" rx="0.95" fill="{d}"/>',
        f'<circle cx="8.5" cy="18.8" r="1.15" fill="{d}" opacity="0.6"/>',
        f'<circle cx="12.5" cy="18.8" r="1.15" fill="{d}" opacity="0.6"/>',
        f'<circle cx="16.5" cy="18.8" r="1.15" fill="{d}" opacity="0.6"/>',
        f'<circle cx="20.5" cy="18.8" r="1.15" fill="{d}" opacity="0.6"/>',
    ])
ICONS[42] = svg(sub_equip())

# ══ D/E/F. 飛機族：俯視機體 ════════════════════════════════════
def plane(body, nose='radial', wing=(2.5, 27.0, 5.6), tail=(10.0, 12.0, 3.2),
          fus=(4.6, 28.0), badge=None, extras='', floats=False, twin=False,
          jet=False, canopy=True, delta=False, rotor=False, flying_boat=False):
    """通用機體：wing=(x,寬,高)、tail=(x,寬,高)、fus=(頭y,尾y)"""
    d = shade(body, 0.6); lt = light(body, 0.22)
    p = []
    wx, ww, wh = wing
    tx, tw, th = tail
    ny, ty = fus

    if rotor:  # 回転翼機（カ号）：側面視角＝機身＋上方旋翼＋尾桁（B 案）
        p.append(f'<rect x="2.0" y="5.4" width="28.0" height="1.9" rx="0.95" fill="{lt}"/>')
        p.append(f'<rect x="15.1" y="6.6" width="1.9" height="6.2" fill="{d}"/>')
        p.append(f'<ellipse cx="16" cy="4.4" rx="1.6" ry="1.2" fill="{d}"/>')
        p.append(f'<path fill="{body}" d="M6.0 12.6 Q10.4 11.0 14.6 11.4 L22.0 12.6 Q25.6 13.4 25.6 16.6 '
                 f'Q25.6 20.2 21.4 20.6 L8.4 20.6 Q4.6 20.6 4.6 17.0 Q4.6 13.6 6.0 12.6 Z"/>')
        p.append(f'<rect x="24.0" y="15.2" width="6.6" height="2.2" rx="1.1" fill="{body}"/>')
        p.append(f'<path fill="{d}" d="M28.6 11.4 L30.6 11.4 L30.6 18.4 L28.6 18.4 Z"/>')
        p.append(f'<ellipse cx="10.4" cy="15.4" rx="3.0" ry="2.4" fill="#8fb8d8"/>')
        p.append(f'<rect x="9.0" y="20.4" width="1.7" height="4.6" fill="{d}"/>')
        p.append(f'<rect x="18.6" y="20.4" width="1.7" height="4.6" fill="{d}"/>')
        p.append(f'<rect x="5.6" y="24.6" width="17.4" height="1.9" rx="0.95" fill="{d}"/>')
        p.append(bdg(badge))
        return ''.join(p)

    if flying_boat:  # 大型飛行艇：船型艇身（V字底）＋高翼＋四發
        p.append(f'<rect x="0.8" y="11.4" width="30.4" height="4.6" rx="2.3" fill="{body}"/>')
        for ex in (5.6, 10.4, 21.6, 26.4):
            p.append(f'<ellipse cx="{ex}" cy="10.2" rx="1.6" ry="2.4" fill="{d}"/>')
        # 艇身：船首尖、艇腹寬、艇尾上翹（飛行艇的識別特徵）
        p.append(f'<path fill="{lt}" d="M16 2.6 Q19.4 5.4 19.8 11 L20.2 19.6 Q20.4 24.4 18.4 26.6 '
                 f'L13.6 26.6 Q11.6 24.4 11.8 19.6 L12.2 11 Q12.6 5.4 16 2.6 Z"/>')
        p.append(f'<path fill="{d}" opacity="0.55" d="M12.0 20.4 Q16 23.8 20.0 20.4 L19.6 25.4 Q16 27.8 12.4 25.4 Z"/>')
        p.append(f'<rect x="9.2" y="26.0" width="13.6" height="2.6" rx="1.3" fill="{body}"/>')
        p.append(f'<ellipse cx="16" cy="8.4" rx="1.5" ry="2.8" fill="#8fb8d8"/>')
        p.append(bdg(badge))
        return ''.join(p)

    # 主翼
    if delta:
        p.append(f'<path fill="{body}" d="M16 5 L30 21.5 L30 25 L2 25 L2 21.5 Z"/>')
    else:
        p.append(f'<rect x="{wx}" y="{12.2 if not floats else 11.4}" width="{ww}" height="{wh}" rx="{wh/2:.2f}" fill="{body}"/>')
        p.append(f'<rect x="{tx}" y="{23.6 if not floats else 22.8}" width="{tw}" height="{th}" rx="{th/2:.2f}" fill="{body}"/>')

    # 雙發引擎（陸攻等）
    if twin:
        for ex in (8.6, 23.4):
            p.append(f'<ellipse cx="{ex}" cy="{11.0 if not floats else 10.2}" rx="2.0" ry="2.9" fill="{d}"/>')
            p.append(f'<ellipse cx="{ex}" cy="{9.0 if not floats else 8.2}" rx="0.9" ry="1.1" fill="{lt}"/>')

    # 機身
    if not delta:
        p.append(f'<path fill="{d}" d="M{16-2.0} {ny+1.2} L{16+2.0} {ny+1.2} Q{16+2.6} 12 {16+2.1} 19.5 '
                 f'Q{16+1.7} 25.8 16 {ty} Q{16-1.7} 25.8 {16-2.1} 19.5 Q{16-2.6} 12 {16-2.0} {ny+1.2} Z"/>')

    # 機首
    if nose == 'radial':      # 星型引擎（零戦・天山）
        p.append(f'<circle cx="16" cy="{ny+1.4:.1f}" r="3.4" fill="{shade(body,0.45)}"/>')
        p.append(f'<circle cx="16" cy="{ny+1.4:.1f}" r="1.3" fill="{lt}"/>')
    elif nose == 'inline':    # 液冷尖鼻（彗星・彩雲）
        p.append(f'<path fill="{shade(body,0.45)}" d="M16 {ny-2.6:.1f} Q17.9 {ny:.1f} 18.1 {ny+3.0:.1f} L13.9 {ny+3.0:.1f} Q14.1 {ny:.1f} 16 {ny-2.6:.1f} Z"/>')
        p.append(f'<rect x="15.3" y="{ny-4.4:.1f}" width="1.4" height="2.6" rx="0.7" fill="{lt}"/>')
    elif nose == 'jet':       # 噴式（無槳、圓鈍頭）
        p.append(f'<path fill="{shade(body,0.5)}" d="M16 {ny-1.4:.1f} Q19.0 {ny+0.6:.1f} 18.6 {ny+4.4:.1f} L13.4 {ny+4.4:.1f} Q13.0 {ny+0.6:.1f} 16 {ny-1.4:.1f} Z"/>')
    elif nose == 'blunt':     # 粗胴（雷電・局戦）
        p.append(f'<ellipse cx="16" cy="{ny+2.0:.1f}" rx="3.9" ry="3.4" fill="{shade(body,0.45)}"/>')
        p.append(f'<circle cx="16" cy="{ny+2.0:.1f}" r="1.4" fill="{lt}"/>')

    if canopy and not delta:
        p.append(f'<ellipse cx="16" cy="{ny+7.4:.1f}" rx="1.5" ry="2.9" fill="#8fb8d8"/>')

    p.append(extras)

    if floats:  # 浮舟（水上機）
        for fx in (8.4, 23.6):
            p.append(f'<rect x="{fx-1.5}" y="14.0" width="3.0" height="11.5" rx="1.5" fill="{lt}"/>')
            p.append(f'<rect x="{fx-1.5}" y="14.0" width="3.0" height="2.4" rx="1.2" fill="{d}"/>')
            p.append(f'<rect x="{fx-0.5}" y="11.6" width="1.0" height="3.0" fill="{d}"/>')

    p.append(bdg(badge))
    return ''.join(p)

CARRIER = "#00c040"      # 艦載機（EO 採樣）
LANDPL  = "#00b020"      # 陸上機
JETPL   = "#44aa88"      # 噴式
SEAPL   = "#80d0aa"      # 水上機
BOAT    = "#88cc99"      # 大型飛行艇
NIGHTB  = "#817aad"      # 夜間系徽章（實機確認）

# 徽章顏色（EO 採樣＋實機確認）
B_SEN  = ('hex', '#60c080', '戦')
B_BAKU = ('hex', '#f06968', '爆')
B_KOU  = ('hex', '#4080c0', '攻')
B_TEI  = ('hex', '#ffdd00', '偵')

# 6 艦上戦闘機（零式艦戦：星型引擎・直翼）
ICONS[6] = svg(plane(CARRIER, nose='radial', badge=B_SEN))
# 7 艦上爆撃機（彗星：液冷尖鼻）
ICONS[7] = svg(plane(CARRIER, nose='inline', fus=(4.2, 28.0), badge=B_BAKU))
# 8 艦上攻撃機（天山：機腹掛魚雷）
TORP_UNDER = ('<rect x="17.4" y="9.4" width="2.0" height="12.0" rx="1.0" fill="#7f96a6"/>'
              '<rect x="17.4" y="9.4" width="2.0" height="2.6" rx="1.0" fill="#9fb2bf"/>')
ICONS[8] = svg(plane(CARRIER, nose='radial', wing=(1.6, 28.8, 5.8), tail=(9.4, 13.2, 3.3),
                     extras=TORP_UNDER, badge=B_KOU))
# 9 艦上偵察機（彩雲：長座艙・細長機身）
ICONS[9] = svg(plane(CARRIER, nose='inline', fus=(3.6, 29.0), wing=(2.0, 28.0, 5.2),
                     extras='<ellipse cx="16" cy="14.4" rx="1.4" ry="4.4" fill="#8fb8d8"/>',
                     canopy=False, badge=B_TEI))
# 21 回転翼機（カ号：無徽章）
ICONS[21] = svg(plane("#65ca76", rotor=True))
# 22 対潜哨戒機（東海：雙發）
ICONS[22] = svg(plane("#7eccd8", nose='radial', twin=True, wing=(1.4, 29.2, 5.4),
                      badge=('hex', '#7eccd8', '哨')))
# 39 噴式戦闘爆撃機（景雲改）
ICONS[39] = svg(plane(JETPL, nose='jet', fus=(4.4, 28.2), badge=('hex', '#d9a70f', '噴')))
# 40 噴式戦闘爆撃機（橘花改：雙噴射engine）
ICONS[40] = svg(plane(JETPL, nose='jet', fus=(4.4, 28.2), twin=True,
                      badge=('hex', '#d9a70f', '噴')))
# 45 夜間戦闘機（F6F-3N）
ICONS[45] = svg(plane(CARRIER, nose='radial',
                      extras='<rect x="9.0" y="9.4" width="2.4" height="0.9" rx="0.45" fill="#d9c95a"/>'
                             '<rect x="9.0" y="11.0" width="3.6" height="0.9" rx="0.45" fill="#d9c95a"/>',
                      badge=('rect', NIGHTB, '夜戦')))
# 46 夜間攻撃機（TBM-3D）
ICONS[46] = svg(plane(CARRIER, nose='radial', wing=(1.6, 28.8, 5.8),
                      extras=TORP_UNDER +
                             '<rect x="9.0" y="9.4" width="2.4" height="0.9" rx="0.45" fill="#d9c95a"/>',
                      badge=('rect', NIGHTB, '夜攻')))

# ── E. 水上機族 ──
# 10 水上機（瑞雲：浮舟）
ICONS[10] = svg(plane(SEAPL, nose='radial', floats=True, wing=(2.5, 27.0, 5.2),
                      tail=(10.6, 10.8, 3.0), fus=(4.4, 27.4)))
# 33 大型飛行艇（二式大艇）
ICONS[33] = svg(plane(BOAT, flying_boat=True))
# 43 水上戦闘機（強風）
ICONS[43] = svg(plane(SEAPL, nose='radial', floats=True, wing=(3.2, 25.6, 5.0),
                      tail=(11.0, 10.0, 2.9), fus=(4.6, 27.2)))
# 50 夜間水上偵察機（夜偵：六邊形「夜」）
ICONS[50] = svg(plane(SEAPL, nose='inline', floats=True, wing=(2.8, 26.4, 5.0),
                      tail=(10.8, 10.4, 2.9), fus=(4.0, 27.4),
                      badge=('hex', NIGHTB, '夜')))
# 51 夜間水上魚雷機（夜間瑞雲：裸字「夜」）
ICONS[51] = svg(plane(SEAPL, nose='radial', floats=True, wing=(2.5, 27.0, 5.2),
                      tail=(10.6, 10.8, 3.0), fus=(4.4, 27.4),
                      badge=('bare', NIGHTB, '夜')))

# ── F. 陸上機族 ──
# 37 陸上攻撃機（一式陸攻：雙發）
ICONS[37] = svg(plane(LANDPL, nose='radial', twin=True, wing=(1.2, 29.6, 5.6),
                      tail=(9.2, 13.6, 3.4), badge=('hex', '#3daf0f', '陸')))
# 38 局地戦闘機（雷電：粗胴）
ICONS[38] = svg(plane(LANDPL, nose='blunt', fus=(4.0, 28.0), wing=(3.4, 25.2, 5.4),
                      badge=('hex', '#60c080', '局')))
# 44 陸軍戦闘機（隼）
ICONS[44] = svg(plane(LANDPL, nose='radial', wing=(3.0, 26.0, 5.2),
                      badge=('hex', '#9ff3aa', '陸')))
# 47 陸上対潜哨戒機
ICONS[47] = svg(plane("#7eccd8", nose='radial', twin=True, wing=(1.4, 29.2, 5.4),
                      badge=('hex', '#7eccd8', '哨')))
# 48 陸上襲撃機（キ102乙改＋イ号誘導弾）
ICONS[48] = svg(plane(LANDPL, nose='inline', twin=True, wing=(1.6, 28.8, 5.4),
                      extras='<rect x="10.4" y="17.6" width="1.8" height="6.4" rx="0.9" fill="#c9a23d"/>'
                             '<rect x="19.8" y="17.6" width="1.8" height="6.4" rx="0.9" fill="#c9a23d"/>',
                      badge=('hex', '#60c080', '襲')))
# 49 大型陸上機（深山：四發・重爆）
ICONS[49] = svg(plane(LANDPL, nose='radial', wing=(0.8, 30.4, 5.8), tail=(8.6, 14.8, 3.6),
                      fus=(3.6, 29.2),
                      extras=''.join(
                          f'<ellipse cx="{ex}" cy="11.0" rx="1.8" ry="2.7" fill="{shade(LANDPL,0.6)}"/>'
                          f'<ellipse cx="{ex}" cy="9.2" rx="0.8" ry="1.0" fill="{light(LANDPL,0.22)}"/>'
                          for ex in (6.2, 10.4, 21.6, 25.8)),
                      badge=('rect', '#f06968', '重爆')))
# 56 局地戦闘機（Me 262 A-1a/R1：噴式・後掠翼）
ICONS[56] = svg(plane(JETPL, nose='jet', fus=(4.4, 28.4), wing=(2.2, 27.6, 5.0),
                      extras=f'<ellipse cx="10.2" cy="14.6" rx="1.7" ry="3.4" fill="{shade(JETPL,0.55)}"/>'
                             f'<ellipse cx="21.8" cy="14.6" rx="1.7" ry="3.4" fill="{shade(JETPL,0.55)}"/>',
                      badge=('hex', '#60c080', '局')))
# 57 試製震電（鴨式前翼・無徽章）
ICONS[57] = svg(''.join([
    f'<rect x="3.0" y="17.4" width="26.0" height="5.4" rx="2.7" fill="{LANDPL}"/>',          # 主翼（後方）
    f'<rect x="9.8" y="7.0" width="12.4" height="3.0" rx="1.5" fill="{LANDPL}"/>',           # 前翼（鴨翼）
    f'<path fill="{shade(LANDPL,0.6)}" d="M14.0 4.4 L18.0 4.4 Q19.0 12 18.4 20 Q18.0 26 16 28.6 '
    f'Q14.0 26 13.6 20 Q13.0 12 14.0 4.4 Z"/>',
    f'<path fill="{shade(LANDPL,0.45)}" d="M16 2.2 Q17.6 4.0 17.8 6.6 L14.2 6.6 Q14.4 4.0 16 2.2 Z"/>',
    f'<ellipse cx="16" cy="10.6" rx="1.5" ry="2.8" fill="#8fb8d8"/>',
    f'<circle cx="16" cy="26.4" r="2.6" fill="{shade(LANDPL,0.45)}"/>',                      # 推進式螺旋槳
    f'<rect x="15.4" y="22.6" width="1.2" height="7.6" rx="0.6" fill="{light(LANDPL,0.25)}"/>',
]))
# 58 夜間爆撃機（零戦62型改：夜爆）
ICONS[58] = svg(plane(CARRIER, nose='radial',
                      extras='<circle cx="16" cy="22.4" r="1.9" fill="#7f96a6"/>',
                      badge=('rect', NIGHTB, '夜爆')))
# 59 噴式（Ho229：飛翼・灰字噴）
ICONS[59] = svg(''.join([
    f'<path fill="{JETPL}" d="M16 4.6 L30.4 24.2 L30.4 27.0 L1.6 27.0 L1.6 24.2 Z"/>',
    f'<path fill="{shade(JETPL,0.6)}" d="M16 7.4 L20.2 13.6 L11.8 13.6 Z"/>',
    f'<ellipse cx="11.2" cy="19.6" rx="1.7" ry="3.2" fill="{shade(JETPL,0.5)}"/>',
    f'<ellipse cx="20.8" cy="19.6" rx="1.7" ry="3.2" fill="{shade(JETPL,0.5)}"/>',
    f'<ellipse cx="16" cy="16.4" rx="1.4" ry="2.4" fill="#8fb8d8"/>',
    badge_hex(23.6, 23.2, '#bebec3', '噴'),
]))
# 60 噴式（震電改三：鴨式＋噴式・灰字噴）
ICONS[60] = svg(''.join([
    f'<rect x="3.0" y="17.4" width="26.0" height="5.4" rx="2.7" fill="{JETPL}"/>',
    f'<rect x="9.8" y="7.0" width="12.4" height="3.0" rx="1.5" fill="{JETPL}"/>',
    f'<path fill="{shade(JETPL,0.6)}" d="M14.0 4.4 L18.0 4.4 Q19.0 12 18.4 20 Q18.0 26 16 29.0 '
    f'Q14.0 26 13.6 20 Q13.0 12 14.0 4.4 Z"/>',
    f'<path fill="{shade(JETPL,0.45)}" d="M16 2.4 Q18.2 4.6 18.4 8.0 L13.6 8.0 Q13.8 4.6 16 2.4 Z"/>',
    f'<ellipse cx="16" cy="11.4" rx="1.5" ry="2.8" fill="#8fb8d8"/>',
    f'<path fill="{shade(JETPL,0.5)}" d="M13.4 24.0 L18.6 24.0 L17.8 29.4 L14.2 29.4 Z"/>',
    badge_hex(23.6, 23.2, '#bebec3', '噴'),
]))

# ══ G. 電探／光學族 ═════════════════════════════════════════════
def radar():                                                                  # 11 電探：圓外圈＋心電圖波形（實機指定）
    main = "#d48e32"; lt = light(main, 0.3)
    return ''.join([
        f'<circle cx="16" cy="16" r="12.6" fill="none" stroke="{main}" stroke-width="2.4"/>',
        f'<path fill="none" stroke="{lt}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" '
        f'd="M5.4 17.6 L9.6 17.6 L11.6 11.4 L14.4 22.6 L17.2 8.8 L19.8 20.4 L21.8 17.6 L26.6 17.6"/>',
    ])
ICONS[11] = svg(radar())

def sonar():
    """ソナー／水中聴音機：與電探同型（圓框＋心電圖波形），僅換色"""
    main = "#59a8b4"; lt = light(main, 0.3)
    return ''.join([
        f'<circle cx="16" cy="16" r="12.6" fill="none" stroke="{main}" stroke-width="2.4"/>',
        f'<path fill="none" stroke="{lt}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" '
        f'd="M5.4 17.6 L9.6 17.6 L11.6 11.4 L14.4 22.6 L17.2 8.8 L19.8 20.4 L21.8 17.6 L26.6 17.6"/>',
    ])
ICONS[18] = svg(sonar())

def searchlight():                                                            # 24 探照灯
    main = "#ff6000"; lt = "#ff8f00"; d = shade(main, 0.55)
    return ''.join([
        f'<path fill="{lt}" opacity="0.55" d="M19.4 9.2 L30.4 3.4 L30.4 20.6 L19.4 16.6 Z"/>',
        f'<circle cx="14.6" cy="13.0" r="7.4" fill="{main}"/>',
        f'<circle cx="14.6" cy="13.0" r="4.2" fill="{light(main,0.5)}"/>',
        f'<rect x="13.2" y="20.0" width="3.0" height="5.0" fill="{d}"/>',
        f'<path fill="{main}" d="M8.4 29.4 Q8.4 24.0 14.7 24.0 Q21.0 24.0 21.0 29.4 Z"/>',
    ])
ICONS[24] = svg(searchlight())

def star_shell():                                                             # 27 照明弾（降落傘照明彈）
    main = "#ffaa00"; d = shade(main, 0.6); lt = light(main, 0.35)
    return ''.join([
        f'<path fill="{main}" d="M4.6 12.4 Q4.6 3.6 16 3.6 Q27.4 3.6 27.4 12.4 Z"/>',
        f'<path fill="{d}" opacity="0.4" d="M11.4 12.4 Q11.4 3.9 16 3.6 Q20.6 3.9 20.6 12.4 Z"/>',
        f'<path fill="none" stroke="{d}" stroke-width="1.1" d="M6.2 12.8 L15.2 20.4 M25.8 12.8 L16.8 20.4 M16 12.8 L16 20.4"/>',
        f'<rect x="13.6" y="20.2" width="4.8" height="8.0" rx="1.6" fill="{lt}"/>',
        f'<circle cx="16" cy="27.0" r="2.6" fill="#fff7dd"/>',
    ])
ICONS[27] = svg(star_shell())

def smoke_gen():                                                              # 54 艦載発煙装置
    main = "#7b7b7b"; d = shade(main, 0.6); lt = light(main, 0.4)
    return ''.join([
        f'<rect x="10.0" y="14.6" width="8.4" height="13.6" rx="1.8" fill="{main}"/>',
        f'<rect x="10.0" y="17.4" width="8.4" height="1.4" fill="{d}"/>',
        f'<rect x="10.0" y="23.0" width="8.4" height="1.4" fill="{d}"/>',
        f'<circle cx="20.6" cy="9.0" r="4.0" fill="{lt}" opacity="0.75"/>',
        f'<circle cx="25.6" cy="5.4" r="3.0" fill="{lt}" opacity="0.55"/>',
        f'<circle cx="15.4" cy="7.0" r="2.8" fill="{lt}" opacity="0.6"/>',
        f'<rect x="12.8" y="11.8" width="2.8" height="3.4" rx="1.0" fill="{d}"/>',
    ])
ICONS[54] = svg(smoke_gen())

# ══ H. 彈藥族 ═══════════════════════════════════════════════════
def shell(main, tip, band=None, burst=False):
    d = shade(main, 0.55);
    p = [f'<path fill="{main}" d="M11.0 12.0 Q11.0 5.0 16 1.8 Q21.0 5.0 21.0 12.0 L21.0 25.6 '
         f'Q21.0 27.0 19.6 27.0 L12.4 27.0 Q11.0 27.0 11.0 25.6 Z"/>',
         f'<path fill="{tip}" d="M11.6 9.2 Q12.2 4.6 16 1.8 Q19.8 4.6 20.4 9.2 Z"/>']
    if band:
        p.append(f'<rect x="11.0" y="20.4" width="10.0" height="2.4" fill="{band}"/>')
    p.append(f'<rect x="11.0" y="25.0" width="10.0" height="2.0" rx="0.6" fill="{d}"/>')
    if burst:
        for a, r1, r2 in ((-52, 7.0, 10.6), (-16, 7.4, 11.2), (16, 7.4, 11.2), (52, 7.0, 10.6)):
            import math
            rad = math.radians(a - 90)
            x1, y1 = 16 + r1*math.cos(rad), 9.0 + r1*math.sin(rad)
            x2, y2 = 16 + r2*math.cos(rad), 9.0 + r2*math.sin(rad)
            p.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                     f'stroke="{tip}" stroke-width="1.9" stroke-linecap="round"/>')
    return ''.join(p)

ICONS[12] = svg(shell("#ff0000", "#ffdd44", burst=True))       # 対空強化弾（三式弾）
ICONS[13] = svg(shell("#ffffff", "#4a4f57", band="#8a8a8a"))   # 徹甲弾（白彈體＋黑彈頭）

def depth_charge():                                                           # 17 爆雷
    main = "#7eccd8"; d = shade(main, 0.55); lt = light(main, 0.3)
    return ''.join([
        f'<rect x="9.0" y="7.4" width="14.0" height="17.6" rx="2.4" fill="{main}"/>',
        f'<rect x="9.0" y="11.0" width="14.0" height="1.7" fill="{d}"/>',
        f'<rect x="9.0" y="19.6" width="14.0" height="1.7" fill="{d}"/>',
        f'<rect x="11.4" y="8.4" width="2.2" height="15.6" rx="1.1" fill="{lt}" opacity="0.6"/>',
        f'<rect x="13.4" y="4.0" width="5.2" height="3.8" rx="1.2" fill="{d}"/>',
        f'<path fill="none" stroke="{lt}" stroke-width="1.5" stroke-linecap="round" opacity="0.75" '
        f'd="M6.0 27.4 Q16 31.4 26.0 27.4"/>',
    ])
ICONS[17] = svg(depth_charge())

def rocket_launcher():                                                        # 31 対地装備（WG42 噴進砲）
    main = "#ff3333"; d = shade(main, 0.55); lt = light(main, 0.3)
    p = []
    for x in (10.0, 16.0, 22.0):
        p.append(f'<rect x="{x-2.4}" y="5.0" width="4.8" height="14.0" rx="2.4" fill="{main}" '
                 f'transform="rotate(-14 {x} 12)"/>')
        p.append(f'<ellipse cx="{x-1.4:.1f}" cy="{5.4}" rx="2.4" ry="1.2" fill="{d}" '
                 f'transform="rotate(-14 {x} 12)"/>')
    p.append(f'<rect x="6.4" y="19.0" width="19.2" height="4.0" rx="1.4" fill="{lt}"/>')
    p.append(f'<path fill="{d}" d="M9.0 29.6 Q9.0 23.2 16 23.2 Q23.0 23.2 23.0 29.6 Z"/>')
    return ''.join(p)
ICONS[31] = svg(rocket_launcher())

# ══ I. 舟艇／車輛族 ════════════════════════════════════════════
def landing_craft():
    """大発動艇：側面視角（船身側面＋艏跳板），比正面更像船"""
    main = "#9aa55d"; d = shade(main, 0.6); lt = light(main, 0.28)
    return ''.join([
        # 船身側面：艉方艏尖、吃水線
        f'<path fill="{main}" d="M2.6 13.6 L24.0 13.6 Q28.4 13.6 29.4 16.4 L30.0 20.2 '
        f'Q30.2 23.8 26.6 23.8 L6.0 23.8 Q2.6 23.8 2.6 20.4 Z"/>',
        # 艏跳板（放下的登陸斜板）
        f'<path fill="{lt}" d="M2.6 13.6 L2.6 20.4 L-0.4 24.6 L-0.4 15.0 Z" transform="translate(3.4 0)"/>',
        # 上構（駕駛室）
        f'<rect x="19.0" y="8.4" width="7.6" height="5.4" rx="1.2" fill="{lt}"/>',
        f'<rect x="20.6" y="9.8" width="4.4" height="2.4" rx="0.7" fill="{d}" opacity="0.5"/>',
        # 貨艙分隔線
        f'<rect x="8.0" y="15.4" width="9.6" height="1.5" fill="{d}" opacity="0.45"/>',
        # 吃水線
        f'<rect x="2.6" y="21.0" width="27.2" height="1.6" fill="{d}" opacity="0.55"/>',
    ])
ICONS[20] = svg(landing_craft())

def amphib_tank():
    """特型内火艇：兩棲戰車＝砲塔側車頭做成船艏（尖艏＋浮航船殼）"""
    main = "#9aa55d"; d = shade(main, 0.6); lt = light(main, 0.3)
    return ''.join([
        # 車體＋船艏（右側尖艏上翹，兩棲特徵）
        f'<path fill="{main}" d="M3.0 14.6 L22.0 14.6 Q26.4 14.6 29.6 18.0 Q26.4 23.6 22.0 23.6 '
        f'L3.0 23.6 Q1.6 23.6 1.6 22.2 L1.6 16.0 Q1.6 14.6 3.0 14.6 Z"/>',
        # 砲塔
        f'<rect x="8.6" y="8.6" width="10.4" height="6.4" rx="2.0" fill="{lt}"/>',
        # 砲管（朝船艏方向）
        f'<rect x="17.6" y="10.4" width="10.6" height="1.9" rx="0.95" fill="{d}"/>',
        # 履帶輪
        ''.join(f'<circle cx="{cx}" cy="23.4" r="2.2" fill="{d}"/>' for cx in (5.4, 10.0, 14.6, 19.2)),
        f'<rect x="3.2" y="24.4" width="18.4" height="2.4" rx="1.2" fill="{d}" opacity="0.6"/>',
    ])
ICONS[36] = svg(amphib_tank())

def army_infantry():                                                          # 52 陸戦部隊
    main = "#947f2c"; d = shade(main, 0.55); lt = light(main, 0.3)
    return ''.join([
        f'<path fill="{main}" d="M4.0 16.4 L28.0 16.4 Q29.4 16.4 29.4 17.8 L29.4 23.0 '
        f'Q29.4 24.4 28.0 24.4 L4.0 24.4 Q2.6 24.4 2.6 23.0 L2.6 17.8 Q2.6 16.4 4.0 16.4 Z"/>',
        f'<path fill="{lt}" d="M9.6 10.0 L21.4 10.0 Q22.6 10.0 22.6 11.2 L22.6 16.4 L8.4 16.4 L8.4 11.2 Q8.4 10.0 9.6 10.0 Z"/>',
        f'<rect x="21.0" y="11.4" width="9.4" height="1.8" rx="0.9" fill="{d}"/>',
        ''.join(f'<circle cx="{cx}" cy="24.8" r="2.0" fill="{d}"/>' for cx in (6.6, 11.2, 15.8, 20.4, 25.0)),
    ])
ICONS[52] = svg(army_infantry())

# ══ J. 人員族 ═════════════════════════════════════════════════
def personnel(main, accent, tool=''):
    d = shade(main, 0.55)
    return ''.join([
        f'<circle cx="16" cy="8.6" r="4.6" fill="{main}"/>',
        f'<path fill="{accent}" d="M11.0 8.0 Q11.0 3.0 16 3.0 Q21.0 3.0 21.0 8.0 Z"/>',
        f'<path fill="{main}" d="M16 14.0 Q22.6 14.0 24.2 20.4 L25.4 28.0 Q25.6 29.4 24.2 29.4 '
        f'L7.8 29.4 Q6.4 29.4 6.6 28.0 L7.8 20.4 Q9.4 14.0 16 14.0 Z"/>',
        f'<path fill="{d}" opacity="0.35" d="M13.4 14.6 L18.6 14.6 L18.6 29.4 L13.4 29.4 Z"/>',
        tool,
    ])
def damecon_hammer():                                                         # 14 応急修理要員／女神
    """遊戲原圖是一把**白色釘鎚**（不是拿工具的人員），故 14 不走 personnel() 這一族。

    與 UI 的造船鎚（`gen_ui.py` 的 build，黃銅色＋漏斗狀打擊面＋金銀鉚釘）刻意分開：
    那顆代表「建造中」，這顆是裝備圖示（損管），同框出現時必須一眼分得出來——
    此處為單色白／銀、平打擊面、直羊角，不放鉚釘。
    """
    head = "#ffffff"; hd = shade(head, 0.62)
    grip = "#e6eaf0"; gd = shade(grip, 0.66)
    p = ['<g transform="rotate(-20 16 16)">']
    # 柄：等寬白木，末端微收並倒角（小尺寸下純矩形會跟鎚頭連成一塊）
    p.append(f'<path fill="{grip}" d="M13.8 10.8 L18.2 10.8 L17.6 28.6 '
             f'Q17.6 29.8 16.3 29.8 L15.3 29.8 Q14.0 29.8 14.0 28.6 Z"/>')
    p.append(f'<path fill="{gd}" opacity="0.45" d="M16.5 10.8 L18.2 10.8 L17.6 28.6 '
             f'Q17.6 29.8 16.3 29.8 L16.1 29.8 Z"/>')
    # 鎚頭：左端平打擊面 → 頸 → 眼部 → 右端羊角（分叉凹口靠 normalize 的 r=0.85 描邊保留）
    p.append(f'<path fill="{head}" d="'
             'M3.6 5.0 Q3.6 3.4 5.2 3.4 L7.8 3.4 Q9.0 3.4 9.2 4.8 '     # 打擊面上緣
             'L12.4 5.4 L12.4 3.0 L17.6 3.0 '                            # 頸→眼部上緣
             'C22.8 2.8 26.6 6.0 28.4 11.4 '                             # 羊角外緣
             'L25.3 12.4 '
             'C24.1 8.8 22.0 7.0 19.2 7.2 '                              # 羊角內緣（回勾出凹口）
             'L19.2 13.0 L12.4 13.0 L12.4 10.6 '                         # 眼部下緣→頸
             'L9.2 11.2 Q9.0 12.6 7.8 12.6 L5.2 12.6 Q3.6 12.6 3.6 11.0 Z"/>')
    # 眼部暗階（柄穿過鎚頭處）＋頸下緣陰影，讓白對白仍有層次
    p.append(f'<rect x="13.2" y="4.2" width="5.4" height="8.0" rx="1.2" fill="{hd}" opacity="0.32"/>')
    p.append(f'<path fill="{hd}" opacity="0.22" d="M9.2 10.2 L12.4 10.0 L12.4 13.0 L9.2 11.2 Z"/>')
    p.append('</g>')
    return svg(''.join(p))
ICONS[14] = damecon_hammer()
ICONS[29] = svg(personnel("#cc9966", "#7a5a3a",                               # 航空要員
    tool='<path fill="#5a7a3a" d="M22.0 16.0 L29.6 16.0 L29.6 18.0 L22.0 18.0 Z"/>'
         '<circle cx="21.6" cy="17.0" r="2.0" fill="#3a5a2a"/>'))
ICONS[32] = svg(personnel("#88ff4d", "#3a7a1a",                               # 水上艦要員（見張員：雙眼鏡）
    tool='<rect x="19.6" y="13.4" width="3.4" height="5.6" rx="1.2" fill="#7f96a6"/>'
         '<rect x="23.6" y="13.4" width="3.4" height="5.6" rx="1.2" fill="#7f96a6"/>'
         '<rect x="22.4" y="14.6" width="2.0" height="1.6" fill="#7f96a6"/>'))

# ══ K. 艦體設備／物資族 ════════════════════════════════════════
def turbine():                                                                # 19 機関部強化（タービン）
    main = "#ffdd00"; d = shade(main, 0.55); lt = light(main, 0.3)
    import math
    p = [f'<circle cx="16" cy="16" r="11.6" fill="{main}"/>']
    for i in range(8):
        a = math.radians(i * 45)
        x1, y1 = 16 + 4.0*math.cos(a), 16 + 4.0*math.sin(a)
        x2, y2 = 16 + 10.4*math.cos(a), 16 + 10.4*math.sin(a)
        p.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{d}" '
                 f'stroke-width="2.6" stroke-linecap="round"/>')
    p.append(f'<circle cx="16" cy="16" r="4.4" fill="{lt}"/>')
    p.append(f'<circle cx="16" cy="16" r="1.9" fill="{d}"/>')
    return ''.join(p)
ICONS[19] = svg(turbine())

def bulge():                                                                  # 23 追加装甲（バルジ）
    main = "#9030ff"; d = shade(main, 0.6); lt = light(main, 0.32)
    return ''.join([
        f'<path fill="{main}" d="M16 2.6 L28.2 7.6 Q28.2 20.4 16 29.4 Q3.8 20.4 3.8 7.6 Z"/>',
        f'<path fill="{lt}" opacity="0.55" d="M16 6.4 L24.6 9.8 Q24.6 19.0 16 25.4 Z"/>',
        f'<path fill="none" stroke="{d}" stroke-width="1.6" d="M16 2.6 L16 29.4"/>',
    ])
ICONS[23] = svg(bulge())

def drum_canister():                                                          # 25 ドラム缶
    main = "#a4a3a3"; d = shade(main, 0.6); lt = light(main, 0.35)
    return ''.join([
        f'<rect x="8.4" y="5.0" width="15.2" height="22.0" rx="2.6" fill="{main}"/>',
        f'<ellipse cx="16" cy="5.6" rx="7.6" ry="2.4" fill="{lt}"/>',
        f'<rect x="8.4" y="10.6" width="15.2" height="2.0" fill="{d}"/>',
        f'<rect x="8.4" y="19.4" width="15.2" height="2.0" fill="{d}"/>',
        f'<rect x="10.6" y="6.4" width="2.4" height="19.6" rx="1.2" fill="{lt}" opacity="0.5"/>',
    ])
ICONS[25] = svg(drum_canister())

def repair_facility():                                                        # 26 艦艇修理施設
    main = "#b29f81"; d = shade(main, 0.6); lt = light(main, 0.3)
    return ''.join([
        f'<rect x="2.4" y="19.0" width="27.2" height="8.4" rx="1.6" fill="{main}"/>',
        f'<path fill="{d}" opacity="0.5" d="M2.4 24.0 L29.6 24.0 L29.6 27.4 L2.4 27.4 Z"/>',
        f'<rect x="6.0" y="4.6" width="3.0" height="14.4" fill="{lt}"/>',
        f'<rect x="6.0" y="4.6" width="16.4" height="2.8" rx="1.0" fill="{lt}"/>',
        f'<rect x="20.0" y="6.4" width="1.8" height="7.0" fill="{d}"/>',
        f'<rect x="17.2" y="13.0" width="7.4" height="5.2" rx="1.4" fill="{d}"/>',
        f'<circle cx="7.5" cy="21.0" r="1.4" fill="{d}"/>',
    ])
ICONS[26] = svg(repair_facility())

def command_facility():
    """司令部施設：電波塔（參照通天閣：四腳收束塔身＋頂部展望層）＋電波閃電"""
    main = "#c5a7fa"; d = shade(main, 0.62); lt = light(main, 0.3)
    return ''.join([
        # 塔身（四腳外張、向上收束）
        f'<path fill="{main}" d="M4.0 29.0 L9.6 29.0 L13.4 12.0 L18.6 12.0 L22.4 29.0 L28.0 29.0 '
        f'L23.0 9.4 L9.0 9.4 Z"/>',
        # 塔身橫樑
        f'<rect x="10.2" y="22.0" width="11.6" height="1.5" fill="{d}" opacity="0.6"/>',
        f'<rect x="11.6" y="16.6" width="8.8" height="1.4" fill="{d}" opacity="0.6"/>',
        # 展望層（通天閣特徵的方形展望台）
        f'<rect x="8.6" y="6.0" width="14.8" height="4.0" rx="1.0" fill="{lt}"/>',
        f'<rect x="10.6" y="7.2" width="10.8" height="1.6" fill="{d}" opacity="0.45"/>',
        # 頂部天線
        f'<rect x="15.2" y="1.4" width="1.6" height="4.8" fill="{d}"/>',
        # 電波閃電（右上）
        f'<path fill="#ffdd44" d="M25.6 1.2 L21.6 7.4 L24.2 7.4 L22.6 12.0 L28.2 5.2 L25.2 5.2 Z"/>',
    ])
ICONS[28] = svg(command_facility())

def ration():                                                                 # 34 戦闘糧食（おにぎり）
    return ''.join([
        '<path fill="#ffffff" d="M16 4.4 Q18.0 4.4 19.2 6.6 L27.4 22.0 Q28.6 24.4 26.0 24.4 '
        'L6.0 24.4 Q3.4 24.4 4.6 22.0 L12.8 6.6 Q14.0 4.4 16 4.4 Z"/>',
        '<rect x="10.4" y="18.2" width="11.2" height="6.2" fill="#5c6070"/>',
        '<path fill="#e8e8e8" d="M16 6.6 L20.6 15.4 L11.4 15.4 Z" opacity="0.5"/>',
        '<circle cx="13.0" cy="11.6" r="1.0" fill="#d8d8d8"/>',
    ])
ICONS[34] = svg(ration())

def supplies():
    """補給物資：油桶"""
    main = "#5fc29c"; d = shade(main, 0.6); lt = light(main, 0.32)
    return ''.join([
        f'<rect x="8.0" y="4.6" width="16.0" height="22.8" rx="2.6" fill="{main}"/>',
        f'<ellipse cx="16" cy="5.2" rx="8.0" ry="2.5" fill="{lt}"/>',
        f'<rect x="8.0" y="10.4" width="16.0" height="2.1" fill="{d}"/>',
        f'<rect x="8.0" y="19.6" width="16.0" height="2.1" fill="{d}"/>',
        f'<rect x="10.4" y="6.0" width="2.4" height="20.4" rx="1.2" fill="{lt}" opacity="0.5"/>',
    ])
ICONS[35] = svg(supplies())

def transport_material():
    """輸送機材：捆紮貨箱堆（實機對應待確認，暫用通用輸送物資意象）"""
    main = "#44aa88"; d = shade(main, 0.6); lt = light(main, 0.3)
    return ''.join([
        f'<rect x="3.0" y="15.4" width="12.4" height="12.2" rx="1.8" fill="{main}"/>',
        f'<rect x="16.6" y="15.4" width="12.4" height="12.2" rx="1.8" fill="{lt}"/>',
        f'<rect x="9.8" y="4.4" width="12.4" height="10.0" rx="1.8" fill="{main}"/>',
        # 捆紮帶（十字）
        f'<rect x="8.4" y="4.4" width="1.8" height="10.0" fill="{d}" opacity="0.55" transform="translate(5.6 0)"/>',
        f'<rect x="9.8" y="8.4" width="12.4" height="1.8" fill="{d}" opacity="0.55"/>',
        f'<rect x="3.0" y="20.4" width="12.4" height="1.8" fill="{d}" opacity="0.5"/>',
        f'<rect x="16.6" y="20.4" width="12.4" height="1.8" fill="{d}" opacity="0.5"/>',
    ])
ICONS[41] = svg(transport_material())

def barrage_balloon():                                                        # 55 阻塞気球
    main = "#9b9b9b"; d = shade(main, 0.6); lt = light(main, 0.35)
    return ''.join([
        f'<ellipse cx="16" cy="12.4" rx="9.6" ry="8.2" fill="{main}"/>',
        f'<ellipse cx="13.0" cy="10.0" rx="3.4" ry="2.6" fill="{lt}" opacity="0.6"/>',
        f'<path fill="{d}" d="M23.4 8.4 L28.6 5.4 L28.6 19.4 L23.4 16.4 Z"/>',
        f'<path fill="none" stroke="{d}" stroke-width="1.3" d="M16 20.6 L16 29.4"/>',
        f'<path fill="none" stroke="{d}" stroke-width="1.0" d="M11.6 19.4 L15.4 26.0 M20.4 19.4 L16.6 26.0"/>',
        f'<rect x="12.6" y="28.6" width="6.8" height="2.4" rx="1.2" fill="{d}"/>',
    ])
ICONS[55] = svg(barrage_balloon())

# ══ 0 / 99 佔位 ════════════════════════════════════════════════
ICONS[0] = svg('<circle cx="16" cy="16" r="11.4" fill="none" stroke="#808080" stroke-width="2.2" '
               'stroke-dasharray="3.2 3.0"/>')
ICONS[99] = svg('<circle cx="16" cy="16" r="12.4" fill="#4a4f57" stroke="#ff8000" stroke-width="2.0"/>'
                f'<text x="16" y="22.4" font-size="17" font-weight="700" fill="#ffeecc" '
                f'text-anchor="middle" font-family="{FONT}">?</text>')

# ══ 資源 8 顆 ══════════════════════════════════════════════════
RES = {}
def barrel_stack(main):                                                        # 燃料：油桶堆
    d = shade(main, 0.6); lt = light(main, 0.3)
    return svg(''.join([
        f'<rect x="6.0" y="9.4" width="12.0" height="18.2" rx="2.0" fill="{main}"/>',
        f'<ellipse cx="12.0" cy="9.8" rx="6.0" ry="2.0" fill="{lt}"/>',
        f'<rect x="6.0" y="14.0" width="12.0" height="1.7" fill="{d}"/>',
        f'<rect x="6.0" y="21.4" width="12.0" height="1.7" fill="{d}"/>',
        f'<rect x="16.4" y="13.0" width="10.4" height="14.6" rx="1.8" fill="{lt}"/>',
        f'<ellipse cx="21.6" cy="13.4" rx="5.2" ry="1.8" fill="{light(main,0.5)}"/>',
        f'<rect x="16.4" y="17.4" width="10.4" height="1.5" fill="{d}" opacity="0.6"/>',
        f'<rect x="16.4" y="23.0" width="10.4" height="1.5" fill="{d}" opacity="0.6"/>',
    ]))
RES['fuel'] = barrel_stack("#3fae5f")

def ammo_crate():                                                              # 彈藥：彈箱＋炮彈
    main = "#a8763e"; d = shade(main, 0.6); lt = light(main, 0.3)
    return svg(''.join([
        f'<path fill="#c9a23d" d="M9.0 6.0 Q9.0 2.6 11.4 2.6 Q13.8 2.6 13.8 6.0 L13.8 14.0 L9.0 14.0 Z"/>',
        f'<path fill="#c9a23d" d="M18.2 6.0 Q18.2 2.6 20.6 2.6 Q23.0 2.6 23.0 6.0 L23.0 14.0 L18.2 14.0 Z"/>',
        f'<rect x="9.0" y="11.0" width="4.8" height="3.0" fill="{shade("#c9a23d",0.65)}"/>',
        f'<rect x="18.2" y="11.0" width="4.8" height="3.0" fill="{shade("#c9a23d",0.65)}"/>',
        f'<rect x="3.6" y="13.6" width="24.8" height="14.4" rx="2.0" fill="{main}"/>',
        f'<rect x="3.6" y="13.6" width="24.8" height="3.8" rx="1.6" fill="{lt}"/>',
        f'<rect x="13.6" y="17.4" width="4.8" height="10.6" fill="{d}" opacity="0.5"/>',
    ]))
RES['ammo'] = ammo_crate()

def steel_ingots():                                                            # 鋼材：鋼錠堆
    main = "#8a97a8"; d = shade(main, 0.6); lt = light(main, 0.3)
    def ingot(x, y, w, h):
        return (f'<path fill="{main}" d="M{x+1.8} {y} L{x+w-1.8} {y} L{x+w} {y+h} L{x} {y+h} Z"/>'
                f'<path fill="{lt}" d="M{x+1.8} {y} L{x+w-1.8} {y} L{x+w-2.6} {y+1.6} L{x+2.6} {y+1.6} Z"/>')
    return svg(''.join([
        ingot(5.0, 18.4, 10.6, 9.0), ingot(16.4, 18.4, 10.6, 9.0),
        ingot(10.6, 8.6, 10.6, 9.0),
        f'<path fill="{d}" opacity="0.35" d="M10.6 17.6 L21.2 17.6 L21.2 18.4 L10.6 18.4 Z"/>',
    ]))
RES['steel'] = steel_ingots()

def bauxite():                                                                 # 鋁土：礦石
    main = "#c98a3d"; d = shade(main, 0.6); lt = light(main, 0.32)
    return svg(''.join([
        f'<path fill="{main}" d="M8.4 14.0 L14.0 9.0 L20.6 12.4 L19.0 20.4 L10.4 21.4 Z"/>',
        f'<path fill="{lt}" d="M14.0 9.0 L20.6 12.4 L15.4 14.4 Z"/>',
        f'<path fill="{d}" d="M17.0 18.0 L24.6 15.4 L28.4 20.4 L25.0 26.4 L18.4 25.4 Z"/>',
        f'<path fill="{lt}" opacity="0.5" d="M24.6 15.4 L28.4 20.4 L22.4 20.0 Z"/>',
        f'<path fill="{main}" d="M4.4 20.4 L11.4 19.0 L14.4 24.0 L10.0 28.4 L4.6 26.4 Z"/>',
        f'<path fill="{lt}" opacity="0.45" d="M11.4 19.0 L14.4 24.0 L9.4 23.4 Z"/>',
    ]))
RES['bauxite'] = bauxite()

def instant_construction():
    """高速建造材：torch lamp（二戰造船廠的加熱噴燈，電焊/氬焊普及前的趕工利器）
       罐身 #b26e10＋#e3e43b、噴口帶火焰。"""
    body = "#b26e10"; accent = "#e3e43b"; d = shade(body, 0.62); lt = light(body, 0.25)
    return svg(''.join([
        # 燃料罐（黃銅罐身）
        f'<rect x="5.0" y="13.0" width="14.4" height="15.4" rx="2.6" fill="{body}"/>',
        f'<ellipse cx="12.2" cy="13.4" rx="7.2" ry="2.2" fill="{lt}"/>',
        # 罐身黃色標帶
        f'<rect x="5.0" y="18.0" width="14.4" height="3.6" fill="{accent}"/>',
        f'<rect x="5.0" y="24.6" width="14.4" height="1.6" fill="{d}" opacity="0.5"/>',
        # 加壓幫浦把手（罐頂側）
        f'<rect x="2.0" y="15.6" width="3.6" height="1.9" rx="0.95" fill="{d}"/>',
        # 燃燒管（斜向上接噴口）
        f'<rect x="17.0" y="9.2" width="7.2" height="2.4" rx="1.2" fill="{d}" transform="rotate(-24 17.0 10.4)"/>',
        f'<rect x="14.6" y="10.0" width="4.4" height="4.0" rx="1.2" fill="{lt}"/>',
        # 噴口
        f'<path fill="{d}" d="M22.4 5.0 L25.6 3.4 L26.8 6.0 L23.6 7.6 Z"/>',
        # 火焰（外橘內黃）
        f'<path fill="#ff8c1a" d="M25.4 4.6 Q31.4 3.2 30.2 -0.6 Q29.6 3.0 26.0 2.0 Q28.8 4.2 25.4 4.6 Z" transform="translate(0.6 2.2)"/>',
        f'<path fill="{accent}" d="M25.8 5.0 Q29.6 4.2 28.8 1.8 Q28.4 4.0 26.2 3.4 Q27.9 4.8 25.8 5.0 Z" transform="translate(0.6 2.2)"/>',
    ]))
RES['torch'] = instant_construction()

def instant_repair():
    """高速修復材（女神の桶）：無提把，桶身 #94c140＋水面"""
    main = "#94c140"; d = shade(main, 0.6); lt = light(main, 0.28)
    return svg(''.join([
        f'<path fill="{main}" d="M5.6 8.6 L26.4 8.6 L24.2 26.6 Q24.0 28.6 22.0 28.6 L10.0 28.6 '
        f'Q8.0 28.6 7.8 26.6 Z"/>',
        # 桶板直紋
        f'<rect x="11.4" y="9.0" width="2.0" height="19.2" fill="{d}" opacity="0.35"/>',
        f'<rect x="18.6" y="9.0" width="2.0" height="19.2" fill="{d}" opacity="0.35"/>',
        # 桶箍
        f'<path fill="{d}" opacity="0.5" d="M6.6 16.4 L25.4 16.4 L25.2 18.4 L6.8 18.4 Z"/>',
        # 水面
        f'<ellipse cx="16" cy="8.8" rx="10.4" ry="2.8" fill="#7cc9ea"/>',
        f'<ellipse cx="16" cy="8.6" rx="7.4" ry="1.7" fill="#b3e2f5"/>',
    ]))
RES['drum'] = instant_repair()

def development_material():
    """開發資材：#63b3ae 齒輪，上置兩顆造船用 Solid Rivets（金・銀各一，「八」字型排列）"""
    import math
    main = "#63b3ae"; d = shade(main, 0.6); lt = light(main, 0.28)
    p = []
    # 齒輪（12 齒）
    cx = cy = 17.4; r_out = 12.4; r_in = 9.2
    teeth = []
    n = 12
    for i in range(n):
        a0 = math.radians(i * 360 / n - 8)
        a1 = math.radians(i * 360 / n + 8)
        teeth.append(f'<path fill="{main}" d="M{cx+r_in*math.cos(a0):.2f} {cy+r_in*math.sin(a0):.2f} '
                     f'L{cx+r_out*math.cos(a0):.2f} {cy+r_out*math.sin(a0):.2f} '
                     f'L{cx+r_out*math.cos(a1):.2f} {cy+r_out*math.sin(a1):.2f} '
                     f'L{cx+r_in*math.cos(a1):.2f} {cy+r_in*math.sin(a1):.2f} Z"/>')
    p += teeth
    p.append(f'<circle cx="{cx}" cy="{cy}" r="{r_in}" fill="{main}"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="4.4" fill="{d}"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="2.2" fill="{lt}" opacity="0.5"/>')
    # 鉚釘（Solid Rivet：半圓頭＋柱身），「八」字：左撇金、右捺銀
    def rivet(x, y, ang, head, shaft):
        # Solid Rivet：半圓頭＋柱身。ang 為「八」字傾角（左撇／右捺）
        return (f'<g transform="rotate({ang} {x} {y})">'
                f'<rect x="{x-2.1}" y="{y}" width="4.2" height="9.6" rx="0.8" fill="{shaft}"/>'
                f'<path fill="{head}" d="M{x-4.4} {y+0.6} Q{x-4.4} {y-4.8} {x} {y-4.8} '
                f'Q{x+4.4} {y-4.8} {x+4.4} {y+0.6} Z"/>'
                f'<ellipse cx="{x-1.4}" cy="{y-2.4}" rx="1.5" ry="1.1" fill="#ffffff" opacity="0.42"/>'
                f'</g>')
    p.append(rivet(9.6, 9.0, -30, "#f0c040", "#c99a24"))   # 金（左撇）
    p.append(rivet(19.4, 6.4, 30, "#e8edf2", "#aab3be"))   # 銀（右捺）
    return svg(''.join(p))
RES['devmat'] = development_material()

def modding_material():
    """改修資材：六角頭螺絲，整體 45 度。直立畫好再一次旋轉，避免複合 transform 互相干擾。"""
    import math
    main = "#b0b6bd"; d = shade(main, 0.55); lt = light(main, 0.4)
    hx, hy, r = 16.0, 7.4, 6.4                      # 六角頭中心／外接圓
    pts = " ".join(f"{hx + r*math.cos(math.radians(a+90)):.2f},{hy + r*math.sin(math.radians(a+90)):.2f}"
                   for a in range(0, 360, 60))
    sw = 5.0                                         # 桿徑
    y0, y1 = hy + 4.4, 25.0                          # 桿身起訖
    parts = [
        f'<rect x="{hx-sw/2}" y="{y0}" width="{sw}" height="{y1-y0}" fill="{main}"/>',
        ''.join(f'<rect x="{hx-sw/2}" y="{y}" width="{sw}" height="1.5" fill="{d}" opacity="0.5"/>'
                for y in (y0+2.6, y0+5.6, y0+8.6, y0+11.6)),
        f'<path fill="{d}" d="M{hx-sw/2} {y1} L{hx+sw/2} {y1} L{hx} {y1+3.4} Z"/>',
        f'<polygon points="{pts}" fill="{main}" stroke="{d}" stroke-width="1.0" stroke-linejoin="round"/>',
        f'<circle cx="{hx}" cy="{hy}" r="2.6" fill="{lt}" opacity="0.4"/>',
    ]
    return svg(f'<g transform="rotate(45 16 16)">{"".join(parts)}</g>')
RES['screw'] = modding_material()

# ══ 寫檔 ═══════════════════════════════════════════════════════
for k, v in sorted(ICONS.items()):
    open(os.path.join(OUT_EQ, f"{k}.svg"), "w").write(v)
for k, v in RES.items():
    open(os.path.join(OUT_RS, f"{k}.svg"), "w").write(v)

print(f"equipment: {len(ICONS)} / resource: {len(RES)}")
expect = set(range(0, 53)) | set(range(54, 61)) | {99}
missing = expect - set(ICONS)
extra = set(ICONS) - expect
print("missing:", sorted(missing) if missing else "none")
print("extra:", sorted(extra) if extra else "none")
