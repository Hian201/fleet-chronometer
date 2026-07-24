# -*- coding: utf-8 -*-
"""面板 UI 圖示（非裝備）：入渠／建造／遠征的計時列標籤＋頂欄的艦數／裝備數。
入渠＝沿用艦艇修理施設（裝備 id 26）的吊臂造型，語意直接對應。
建造＝造船鎚（#feea74）＋兩顆 Solid Rivets（與開発資材同一語彙）。
遠征＝羅盤（參照 samples/compass.jpg：黃銅錶圈・白錶盤・黑三角刻度・八方位羅經花・紅指北針）。
艦數＝軍艦側影（參照遊戲原圖 samples/ships.png：黃綠 #b3c96f 艦體、深綠細節）。
裝備數＝金銀雙齒輪（參照遊戲原圖 samples/equips.png：金齒輪前、銀齒輪後，
　　　　齒輪幾何沿用開発資材的 12 齒語彙）。
明度規則與裝備族一致（FLOOR 0.26）。
"""
import os, sys, math, colorsys

FLOOR = 0.26
def _parse(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def _hex(r,g,b): return '#%02x%02x%02x' % tuple(max(0,min(255,round(v*255))) for v in (r,g,b))
def clamp_light(c, lo=None):
    lo = FLOOR if lo is None else lo
    r,g,b = _parse(c); h,l,s = colorsys.rgb_to_hls(r,g,b)
    return _hex(*colorsys.hls_to_rgb(h, max(l,lo), s))
def shade(c, f=0.62):
    r,g,b = _parse(c); return clamp_light(_hex(r*f, g*f, b*f))
def light(c, f=0.35):
    r,g,b = _parse(c); return clamp_light(_hex(r+(1-r)*f, g+(1-g)*f, b+(1-b)*f))

def svg(body):
    return ('<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            '<g class="a">' + body + '</g></svg>')

OUT = {}

# ── 入渠：艦艇修理施設的吊臂（與裝備 id 26 同一造型語彙）──
def dock():
    main = "#b29f81"; d = shade(main, 0.66); lt = light(main, 0.3)
    return svg(''.join([
        f'<rect x="2.4" y="19.0" width="27.2" height="8.4" rx="1.6" fill="{main}"/>',
        f'<path fill="{d}" opacity="0.5" d="M2.4 24.0 L29.6 24.0 L29.6 27.4 L2.4 27.4 Z"/>',
        f'<rect x="6.0" y="4.6" width="3.0" height="14.4" fill="{lt}"/>',
        f'<rect x="6.0" y="4.6" width="16.4" height="2.8" rx="1.0" fill="{lt}"/>',
        f'<rect x="20.0" y="6.4" width="1.8" height="7.0" fill="{d}"/>',
        f'<rect x="17.2" y="13.0" width="7.4" height="5.2" rx="1.4" fill="{d}"/>',
        f'<circle cx="7.5" cy="21.0" r="1.4" fill="{d}"/>',
    ]))
OUT['dock'] = dock()

# ── 建造：造船鎚（構圖概念參照遊戲原圖 samples/ship_build.png）──
def build():
    """遊戲原圖的鎚頭剖面：左端打擊面「漏斗狀」外擴、往右收成細頸，再到眼部、右端羊角回勾。
    描邊由 normalize.py 統一注入（全圖示一致），此處只定義塊面與亮暗階。"""
    head = "#feea74"; hl = light(head, 0.42); hd = shade(head, 0.72)
    wood = "#f2c85a"; wl = light(wood, 0.3); wd = shade(wood, 0.7)
    p = ['<g transform="rotate(-14 16 16)">']

    # 粗木柄
    p.append(f'<path fill="{wood}" d="M13.4 10.4 L19.0 10.4 L18.3 28.6 '
             f'Q18.3 29.9 16.9 29.9 L15.5 29.9 Q14.1 29.9 14.1 28.6 Z"/>')
    p.append(f'<path fill="{wl}" opacity="0.5" d="M14.0 11.6 L15.6 11.6 L15.2 28.4 L14.3 28.4 Z"/>')
    p.append(f'<path fill="{wd}" opacity="0.5" d="M14.1 27.4 L18.4 27.4 L18.3 28.6 '
             f'Q18.3 29.9 16.9 29.9 L15.5 29.9 Q14.1 29.9 14.1 28.6 Z"/>')

    # 鎚頭：漏斗狀打擊面（左端寬）→ 細頸 → 眼部 → 羊角回勾
    p.append(f'<path fill="{head}" d="'
             'M2.9 5.2 Q2.9 3.0 5.1 3.0 L7.3 3.0 Q8.9 3.0 9.2 4.2 '      # 打擊面上緣（漏斗外擴端）
             'L11.4 5.6 L14.3 5.5 '                                       # 漏斗收窄 → 細頸（仍細於打擊面）
             'L14.9 3.2 L18.9 3.2 '                                       # 眼部（再度加寬）
             'C23.6 2.6 27.9 5.6 29.3 11.3 '                              # 羊角外緣
             'L26.1 11.7 '
             'C25.7 8.9 23.7 7.3 20.8 7.1 '                               # 羊角內緣（回勾）
             'L20.4 12.9 L14.9 13.0 '                                     # 眼部下緣
             'L14.3 10.5 L11.4 10.4 '                                     # 細頸下緣
             'L9.2 11.8 Q8.9 13.2 7.3 13.2 L5.1 13.2 Q2.9 13.2 2.9 11.0 Z"/>')  # 打擊面下緣
    # 打擊面亮階（漏斗的外擴端）
    p.append(f'<path fill="{hl}" d="M2.9 5.2 Q2.9 3.0 5.1 3.0 L6.4 3.0 L6.4 13.2 '
             f'L5.1 13.2 Q2.9 13.2 2.9 11.0 Z"/>')
    # 眼部／羊角上緣亮階
    p.append(f'<path fill="{hl}" opacity="0.5" d="M14.9 3.2 L18.9 3.2 C23.0 2.7 26.8 5.0 28.6 9.6 '
             f'L27.1 10.2 C25.4 6.4 22.2 4.5 18.7 4.8 L14.9 4.8 Z"/>')
    # 眼部暗階（柄穿過處）
    p.append(f'<rect x="14.8" y="4.0" width="5.2" height="8.6" rx="1.2" fill="{hd}" opacity="0.4"/>')
    p.append('</g>')

    # 圓頭釘兩根：平行、左下、彼此不重疊（釘尖朝左下，與遊戲原圖同向）
    def nail(x, y, hc, sc, ang=38):
        return (f'<g transform="rotate({ang} {x} {y})">'
                f'<path fill="{sc}" d="M{x-1.0} {y+1.4} L{x+1.0} {y+1.4} L{x+0.3} {y+8.2} '
                f'L{x-0.3} {y+8.2} Z"/>'
                f'<ellipse cx="{x}" cy="{y}" rx="2.7" ry="1.8" fill="{hc}"/>'
                f'<ellipse cx="{x-0.8}" cy="{y-0.5}" rx="0.8" ry="0.45" fill="#ffffff" opacity="0.45"/>'
                f'</g>')
    p.append(nail(7.6, 17.4, "#f0c040", "#d9a72e"))    # 金（上）
    p.append(nail(11.8, 22.4, "#dbe2ea", "#aab4c0"))   # 銀（下，平行偏移，不重疊）
    return svg(''.join(p))
OUT['build'] = build()

# ── 遠征：羅盤（參照 samples/compass.jpg）──
def compass():
    bezel = "#c98f4a"; bez_d = shade(bezel, 0.68); bez_l = light(bezel, 0.35)
    dial = "#e8e2d2"; tick = "#5a5f68"; rose = "#6b7280"
    red = "#e0483c"
    p = []
    # 黃銅錶圈
    p.append(f'<circle cx="16" cy="16" r="15.0" fill="{bez_l}"/>')
    p.append(f'<circle cx="16" cy="16" r="13.6" fill="{bez_d}"/>')
    # 白錶盤
    p.append(f'<circle cx="16" cy="16" r="12.4" fill="{dial}"/>')
    # 外圈三角刻度（參照原型的黑色三角齒列）
    for i in range(24):
        a = math.radians(i*15 - 90)
        a1 = math.radians(i*15 - 90 + 3.4)
        r0, r1 = 12.3, 9.9
        x0, y0 = 16 + r0*math.cos(a), 16 + r0*math.sin(a)
        x1, y1 = 16 + r0*math.cos(a1), 16 + r0*math.sin(a1)
        x2, y2 = 16 + r1*math.cos(math.radians(i*15 - 90 + 1.7)), 16 + r1*math.sin(math.radians(i*15 - 90 + 1.7))
        p.append(f'<polygon points="{x0:.2f},{y0:.2f} {x1:.2f},{y1:.2f} {x2:.2f},{y2:.2f}" fill="{tick}"/>')
    # 八方位羅經花
    for i in range(8):
        a = math.radians(i*45 - 90)
        ap = math.radians(i*45 - 90 + 22.5); am = math.radians(i*45 - 90 - 22.5)
        R, r = 9.2, 2.9
        x0, y0 = 16 + R*math.cos(a), 16 + R*math.sin(a)
        x1, y1 = 16 + r*math.cos(ap), 16 + r*math.sin(ap)
        x2, y2 = 16 + r*math.cos(am), 16 + r*math.sin(am)
        p.append(f'<polygon points="{x0:.2f},{y0:.2f} {x1:.2f},{y1:.2f} {x2:.2f},{y2:.2f}" '
                 f'fill="{rose}" opacity="{0.95 if i%2==0 else 0.5}"/>')
    # 指針：紅色指北（上）＋深色指南（下）
    p.append(f'<polygon points="16,3.6 18.3,16 13.7,16" fill="{red}"/>')
    p.append(f'<polygon points="16,28.4 13.7,16 18.3,16" fill="{shade(rose,0.8)}"/>')
    # 中心軸帽
    p.append(f'<circle cx="16" cy="16" r="2.5" fill="{bez_l}"/>')
    p.append(f'<circle cx="16" cy="16" r="1.0" fill="{bez_d}"/>')
    return svg(''.join(p))
OUT['exped'] = compass()

# ── 艦數（頂欄）：軍艦側影（配色參照遊戲原圖 samples/ships.png，
#     外框參照 1944 年頃的戰艦側影：飛剪艦首・背負式前砲塔・塔式艦橋・後傾煙囪）──
def ship():
    """艦首朝左。輪廓元素由前而後：飛剪艦首（前緣後掠的曲線）、A 砲塔＋其上背負的
    B 砲塔（各带朝左微揚的砲管）、錐狀塔式艦橋（梯形收頂，非階梯疊塊）、
    後傾單煙囪、後部低矮構造物。艦橋頂控制在 y≈9（不含細桅），避免過高。"""
    main = "#b3c96f"; d = shade(main, 0.5); lt = light(main, 0.3)
    p = []
    # 艦體：甲板帶舷弧（艦首端略高）、飛剪艦首曲線、艦尾方圓
    p.append(f'<path fill="{main}" d="M2.0 17.6 '
             'L29.8 19.0 L29.8 24.2 Q29.8 26.2 27.6 26.2 L7.2 26.2 '
             'C4.4 26.2 2.6 22.4 2.0 17.6 Z"/>')
    # 吃水線（深綠帶；起點內縮避免凸出艦首曲線）
    p.append(f'<path fill="{d}" opacity="0.55" d="M4.2 23.6 L29.8 23.6 L29.8 24.2 '
             'Q29.8 26.2 27.6 26.2 L7.6 26.2 Q5.4 26.2 4.4 24.3 Z"/>')
    # 甲板亮階（沿舷弧）
    p.append(f'<path fill="{lt}" opacity="0.6" d="M2.0 17.6 L29.8 19.0 L29.8 20.2 L2.3 18.9 Z"/>')
    # 砲管先畫（墊在砲塔下層），從砲塔前面板中段伸出、微揚 8 度
    p.append(f'<rect x="2.6" y="15.8" width="6.4" height="1.3" rx="0.6" fill="{d}" '
             'transform="rotate(-8 8.6 16.4)"/>')
    p.append(f'<rect x="7.4" y="12.9" width="5.6" height="1.2" rx="0.55" fill="{d}" '
             'transform="rotate(-8 12.8 13.5)"/>')
    # B 砲塔（背負、較高）：先畫、直落甲板，避免與 A 砲塔間留出鏤空
    p.append(f'<path fill="{main}" d="M11.8 13.4 Q11.8 12.3 12.9 12.3 L15.7 12.3 '
             'Q16.8 12.3 16.8 13.4 L16.8 19.0 L11.8 19.0 Z"/>')
    # A 砲塔（低、疊在 B 前）
    p.append(f'<path fill="{main}" d="M7.6 16.4 Q7.6 15.2 8.8 15.2 L12.4 15.2 '
             'Q13.6 15.2 13.6 16.4 L13.6 19.0 L7.6 19.0 Z"/>')
    # 塔式艦橋：錐狀梯形（大和型的一體式塔橋），頂部測距儀＋細桅
    p.append(f'<path fill="{main}" d="M16.2 19.0 L17.0 10.6 Q17.1 9.8 17.9 9.8 L19.9 9.8 '
             'Q20.7 9.8 20.8 10.6 L21.6 19.0 Z"/>')
    p.append(f'<rect x="17.2" y="8.4" width="3.4" height="1.5" rx="0.5" fill="{lt}"/>')
    p.append(f'<rect x="18.5" y="6.0" width="0.9" height="2.4" fill="{d}"/>')
    # 後傾單煙囪：與艦橋留出間隙；本體同主色、頂部薄帽帶（沿斜頂緣等厚）
    p.append(f'<path fill="{main}" d="M23.0 19.0 L24.1 12.4 L26.5 13.4 L26.8 19.0 Z"/>')
    p.append(f'<path fill="{d}" d="M24.1 12.4 L26.5 13.4 L26.42 14.5 L23.92 13.5 Z"/>')
    # 後部低矮構造物
    p.append(f'<rect x="27.2" y="16.4" width="2.4" height="2.8" rx="0.5" fill="{main}"/>')
    return svg(''.join(p))
OUT['ship'] = ship()

# ── 裝備數（頂欄）：金銀雙齒輪（參照遊戲原圖 samples/equips.png）──
def equip():
    """遊戲原圖：金齒輪（前・大・帶輻條孔）＋銀齒輪（後・小）。
    齒輪幾何沿用開発資材的齒形語彙（等寬梯形齒）。"""
    import math
    def gear(cx, cy, r_out, r_in, n, main, phase=0.0):
        parts = []
        for i in range(n):
            a0 = math.radians(i * 360 / n - 360 / n * 0.22 + phase)
            a1 = math.radians(i * 360 / n + 360 / n * 0.22 + phase)
            parts.append(f'<path fill="{main}" d="M{cx+r_in*math.cos(a0):.2f} {cy+r_in*math.sin(a0):.2f} '
                         f'L{cx+r_out*math.cos(a0):.2f} {cy+r_out*math.sin(a0):.2f} '
                         f'L{cx+r_out*math.cos(a1):.2f} {cy+r_out*math.sin(a1):.2f} '
                         f'L{cx+r_in*math.cos(a1):.2f} {cy+r_in*math.sin(a1):.2f} Z"/>')
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r_in}" fill="{main}"/>')
        return parts
    gold = "#cfa64e"; gd = shade(gold, 0.55); gl = light(gold, 0.32)
    silv = "#b9c0c8"; sd = shade(silv, 0.55)
    p = []
    # 銀齒輪（後・右上・小）：先畫，讓金齒輪疊在前
    p += gear(23.2, 11.4, 7.6, 5.6, 9, silv, phase=20)
    p.append(f'<circle cx="23.2" cy="11.4" r="2.4" fill="{sd}"/>')
    # 金齒輪（前・左下・大）
    p += gear(13.2, 18.4, 11.6, 8.6, 11, gold)
    # 輻條孔（深色圓孔環繞輪轂，呼應原圖的輻條輪）
    for i in range(5):
        a = math.radians(i * 72 - 90)
        p.append(f'<circle cx="{13.2 + 5.6*math.cos(a):.2f}" cy="{18.4 + 5.6*math.sin(a):.2f}" '
                 f'r="1.9" fill="{gd}"/>')
    p.append(f'<circle cx="13.2" cy="18.4" r="3.2" fill="{gd}"/>')
    p.append(f'<circle cx="13.2" cy="18.4" r="1.6" fill="{gl}" opacity="0.6"/>')
    return svg(''.join(p))
OUT['equip'] = equip()

# ── 空襲警報：基地空襲節點的標記 ──
def airraid():
    """回轉警示燈（警報器）＋左右閃光。**不是遊戲原圖的移植**——遊戲沒有這個圖示，
    這是本專案為「出擊紀錄的基地空襲節點」新造的標記，取現實中的空襲警報燈意象。
    16px 下要讀得出來，故只留三個層次：燈罩（紅）＋高光、底座（灰）、兩側閃光（黃）。"""
    dome = "#ff4040"; dl = light(dome, 0.42); base = "#9aa3ad"; bd = shade(base, 0.62)
    flash = "#feea74"
    p = []
    # 兩側閃光（先畫，讓燈罩疊在上面）
    for sign in (-1, 1):
        for i, (dx, dy, w, h) in enumerate(((9.4, 0.0, 5.2, 2.2), (8.2, -5.0, 4.6, 2.2))):
            x = 16 + sign * dx - (w / 2 if sign > 0 else w / 2)
            p.append(f'<rect x="{x - (0 if sign > 0 else 0):.2f}" y="{15.0 + dy:.2f}" '
                     f'width="{w}" height="{h}" rx="1.1" fill="{flash}" '
                     f'transform="rotate({(-18 if i else 0) * sign} 16 16)"/>')
    # 燈罩（半圓）＋高光
    p.append(f'<path fill="{dome}" d="M8.6 20.4 A7.4 7.4 0 0 1 23.4 20.4 Z"/>')
    p.append(f'<path fill="{dl}" opacity="0.55" d="M11.4 19.4 A4.6 4.6 0 0 1 14.6 14.2 '
             'L13.2 19.4 Z"/>')
    # 底座
    p.append(f'<rect x="7.2" y="20.4" width="17.6" height="3.6" rx="1.2" fill="{base}"/>')
    p.append(f'<rect x="10.4" y="24.0" width="11.2" height="3.0" rx="1.0" fill="{bd}"/>')
    return svg(''.join(p))
OUT['airraid'] = airraid()

if __name__ == '__main__':
    d = sys.argv[1]
    os.makedirs(d, exist_ok=True)
    for k, v in OUT.items():
        open(os.path.join(d, f"{k}.svg"), "w").write(v)
    print("UI 圖示:", " ".join(OUT))
