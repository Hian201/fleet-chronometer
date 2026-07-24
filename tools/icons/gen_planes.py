# -*- coding: utf-8 -*-
"""飛機族全 26 顆 — 前左側三維俯視（front-left three-quarter overhead）。

視角：相機 azimuth −45°／elevation 32°（依 samples/九六式二号二型艦上戦闘機.jpg 的參照角度），
      機首落於 8 點鐘、可見左舷。真 3D：立體多面體＋正投影＋畫家演算法＋背面剔除＋逐面光照。
明度：B 案 — FLOOR 0.26、光照範圍 [0.72, 1.00]（上限不超過基準色，超過會發白）。
      深色底可讀性為硬約束：面板背景深色，近黑面會被吸收，故所有輸出色過 clamp_light()。
機體：各依真實機型比例（翼展／機長），含只有概念機的 if 裝備（Ho229・震電改等）。
配色：主色取自 EO 原圖採樣（遊戲慣例）；徽章文字與色依實機確認。

**適用範圍**：僅限「有徽章」的機體。無徽章者（10 瑞雲・21 カ号・33 二式大艇・43 強風・
57 試製震電）機體輪廓是唯一辨識線索，3D 會使輪廓破碎而彼此難分辨——那 5 顆沿用
gen_icons.py 的原始正俯視版（十字剪影，小尺寸可讀性最佳），本檔不產出、部署時不覆蓋。
"""
import math, os, colorsys

FLOOR = 0.26
LIT_LO, LIT_HI = 0.72, 1.00

def _parse(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def _hex(r, g, b):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v*255))) for v in (r, g, b))
def clamp_light(hexc, lo=None):
    lo = FLOOR if lo is None else lo
    r, g, b = _parse(hexc)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return _hex(*colorsys.hls_to_rgb(h, max(l, lo), s))
def tone(hexc, k):
    r, g, b = _parse(hexc)
    return clamp_light(_hex(r*k, g*k, b*k))

def cross(a,b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def dot(a,b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def norm(a):
    m = math.sqrt(dot(a,a)) or 1.0
    return (a[0]/m, a[1]/m, a[2]/m)
def make_cam(az, el):
    az, el = math.radians(az), math.radians(el)
    c = (math.cos(el)*math.sin(az), math.cos(el)*math.cos(az), math.sin(el))
    right = norm((-c[1], c[0], 0.0))
    return c, right, cross(right, (-c[0], -c[1], -c[2]))
def project(p, cam):
    c, right, up = cam
    return (dot(p, right), -dot(p, up), dot(p, c))

def extrude_z(poly, z0, z1):
    n = len(poly)
    v = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    fs = [([i+n for i in range(n)], (0,0,1)), ([n-1-i for i in range(n)], (0,0,-1))]
    for i in range(n):
        j = (i+1) % n
        dx = poly[j][0]-poly[i][0]; dy = poly[j][1]-poly[i][1]
        fs.append(([i, j, j+n, i+n], norm((dy, -dx, 0))))
    return fs, v

def extrude_x(poly, x0, x1):
    n = len(poly)
    v = [(x0, y, z) for y, z in poly] + [(x1, y, z) for y, z in poly]
    fs = [([i+n for i in range(n)], (1,0,0)), ([n-1-i for i in range(n)], (-1,0,0))]
    for i in range(n):
        j = (i+1) % n
        dy = poly[j][0]-poly[i][0]; dz = poly[j][1]-poly[i][1]
        fs.append(([i, j, j+n, i+n], norm((0, dz, -dy))))
    return fs, v

def ring(cx, cy, r, n=14):
    return [(cx + r*math.cos(2*math.pi*i/n), cy + r*math.sin(2*math.pi*i/n)) for i in range(n)]

class Model:
    def __init__(self): self.faces = []
    def add(self, geom, color, off=(0,0,0)):
        fs, vs = geom
        vs = [(v[0]+off[0], v[1]+off[1], v[2]+off[2]) for v in vs]
        for idx, nrm in fs:
            self.faces.append(([vs[i] for i in idx], nrm, color))

    def render(self, cam, fit, light=(-0.5, 0.3, 0.9)):
        L = norm(light); out = []
        for pts, nrm, color in self.faces:
            if dot(norm(nrm), cam[0]) <= 0.015:
                continue
            pr = [project(p, cam) for p in pts]
            k = LIT_LO + (LIT_HI - LIT_LO) * ((dot(norm(nrm), L) + 1) / 2)
            out.append((sum(p[2] for p in pr)/len(pr), pr, tone(color, k)))
        out.sort(key=lambda t: t[0])
        xs = [p[0] for _, pr, _ in out for p in pr]; ys = [p[1] for _, pr, _ in out for p in pr]
        x0,x1,y0,y1 = min(xs),max(xs),min(ys),max(ys)
        fx0,fy0,fx1,fy1 = fit
        s = min((fx1-fx0)/(x1-x0 or 1), (fy1-fy0)/(y1-y0 or 1))
        ox = fx0 + ((fx1-fx0)-(x1-x0)*s)/2 - x0*s
        oy = fy0 + ((fy1-fy0)-(y1-y0)*s)/2 - y0*s
        return ''.join(
            f'<polygon points="{" ".join(f"{p[0]*s+ox:.2f},{p[1]*s+oy:.2f}" for p in pr)}" fill="{c}"/>'
            for _, pr, c in out)

# 零件色：皆中明度，深色底不被吸收
GLASS = "#8fb8d8"; TIRE = "#8a94a0"; STORE = "#7f96a6"; ANT = "#e8d96a"; MISSILE = "#d9b45a"

def plane(body, span, length, nose='radial', blades=3, canopy=(1.4, 5.0),
          engines=1, torpedo=False, radar=False, missiles=False, spats=False,
          floats=0, rotor=False, boat=False, canard=False, wing_only=False,
          pusher=False, tail_h=4.4):
    """通用機體。span/length 為實機值（m）；機長正規化到 21 單位。"""
    m = Model()
    U = 21.0 / length
    L2 = length * U / 2
    S2 = span * U / 2
    fus_c = tone(body, 0.84)
    cowl_c = tone(body, 0.72)
    prop_c = tone(body, 0.70)

    # ── 飛翼（Ho229）：只有翼，無機身尾翼 ──
    if wing_only:
        m.add(extrude_z([(0, L2), (S2, -L2*0.55), (S2*0.72, -L2), (-S2*0.72, -L2), (-S2, -L2*0.55)],
                        -0.5, 0.9), body)
        m.add(extrude_z([(0, L2*0.66), (S2*0.28, L2*0.1), (-S2*0.28, L2*0.1)], 0.9, 1.9), cowl_c)
        for ex in (-S2*0.3, S2*0.3):
            m.add(extrude_z(ring(ex, -L2*0.18, 1.6), 0.9, 2.4), cowl_c)
        m.add(extrude_z(ring(0, L2*0.34, 1.3), 1.9, 2.7), GLASS)
        return m

    # ── 主翼 ──
    if canard:
        m.add(extrude_z([(-S2,-L2*0.30),(-S2*0.9,-L2*0.44),(-S2*0.3,-L2*0.56),(S2*0.3,-L2*0.56),
                         (S2*0.9,-L2*0.44),(S2,-L2*0.30),(S2*0.88,-L2*0.14),(-S2*0.88,-L2*0.14)],
                        -0.4, 0.4), body)                                    # 主翼（後置）
        m.add(extrude_z([(-S2*0.42,L2*0.42),(S2*0.42,L2*0.42),(S2*0.38,L2*0.62),(-S2*0.38,L2*0.62)],
                        -0.3, 0.3), body)                                    # 前翼（鴨翼）
    else:
        wing = [(-S2,0.6),(-S2*0.9,-0.9),(-S2*0.33,-2.4),(S2*0.33,-2.4),(S2*0.9,-0.9),
                (S2,0.6),(S2*0.9,1.9),(S2*0.33,3.6),(-S2*0.33,3.6),(-S2*0.9,1.9)]
        zw = (1.2, 2.0) if boat else (-0.4, 0.4)                            # 飛行艇＝高翼
        m.add(extrude_z(wing, *zw), body)

    # ── 機身／艇身 ──
    if boat:
        m.add(extrude_z([(-2.3,-L2),(2.3,-L2),(2.5,0.0),(2.1,L2-1.4),(0,L2+0.6),(-2.1,L2-1.4),(-2.5,0.0)],
                        -2.6, 2.0), fus_c)
        m.add(extrude_z([(-1.9,-L2*0.5),(1.9,-L2*0.5),(1.6,L2-2.0),(-1.6,L2-2.0)], -3.6, -2.4),
              tone(body, 0.74))                                             # V 字艇底（飛行艇特徵）
    elif not canard:
        m.add(extrude_z([(-1.9,-L2),(1.9,-L2),(2.1,1.5),(1.9,L2-2.2),(-1.9,L2-2.2),(-2.1,1.5)],
                        -1.8, 1.7), fus_c)
    else:
        m.add(extrude_z([(-1.9,-L2),(1.9,-L2),(2.1,0),(1.6,L2),(-1.6,L2),(-2.1,0)], -1.8, 1.7), fus_c)

    # ── 尾翼 ──
    if not canard:
        m.add(extrude_z([(-S2*0.37,-L2),(-S2*0.32,-L2+2.1),(S2*0.32,-L2+2.1),(S2*0.37,-L2),
                         (S2*0.24,-L2-0.4),(-S2*0.24,-L2-0.4)], 0.0, 0.6), body)
        m.add(extrude_z([(-0.35,-L2-0.2),(0.35,-L2-0.2),(0.35,-L2+2.9),(-0.35,-L2+2.9)],
                        0.6, tail_h), body)
    else:
        for ex in (-S2*0.55, S2*0.55):                                       # 震電：翼端垂直安定板
            m.add(extrude_z([(ex-0.35,-L2*0.46),(ex+0.35,-L2*0.46),(ex+0.35,-L2*0.16),(ex-0.35,-L2*0.16)],
                            0.4, 3.4), body)

    # ── 旋翼機（カ号）──
    if rotor:
        m.add(extrude_z([(-0.5,-0.5),(0.5,-0.5),(0.5,0.5),(-0.5,0.5)], 1.7, 6.2), tone(body, 0.8))
        for ang in (0, 60, 120):
            a = math.radians(ang)
            dx, dy = math.cos(a), math.sin(a)
            m.add(extrude_z([(-S2*dx-0.45*dy, -S2*dy+0.45*dx), (S2*dx-0.45*dy, S2*dy+0.45*dx),
                             (S2*dx+0.45*dy, S2*dy-0.45*dx), (-S2*dx+0.45*dy, -S2*dy-0.45*dx)],
                            6.2, 6.6), tone(body, 0.94))
        m.add(extrude_z(ring(0, 0, 1.0), 6.0, 6.9), cowl_c)

    # ── 引擎／機首 ──
    if engines == 1 and not rotor and not canard:
        if nose == 'radial':
            m.add(extrude_z(ring(0, L2-1.1, 2.4), -2.3, 2.2), cowl_c)
        elif nose == 'blunt':
            m.add(extrude_z(ring(0, L2-1.2, 2.9), -2.7, 2.6), cowl_c)
        elif nose == 'inline':
            m.add(extrude_z([(-1.5,L2-2.4),(1.5,L2-2.4),(0.95,L2+0.8),(-0.95,L2+0.8)], -1.5, 1.4), cowl_c)
        elif nose == 'jet':
            m.add(extrude_z(ring(0, L2-1.0, 1.9), -1.9, 1.8), cowl_c)
    elif engines >= 2 and not canard:
        pos = ([-S2*0.42, S2*0.42] if engines == 2 else [-S2*0.62, -S2*0.34, S2*0.34, S2*0.62])
        zc = (0.6, 3.0) if boat else (-1.6, 1.6)
        for ex in pos:
            if nose == 'jet':
                m.add(extrude_z(ring(ex, 1.4, 1.7), -2.0, 1.0), cowl_c)      # 噴射引擎莢艙
            else:
                m.add(extrude_z(ring(ex, 3.2, 1.9), *zc), cowl_c)
                m.add(extrude_z([(ex-0.28,4.9),(ex+0.28,4.9),(ex+0.28,5.3),(ex-0.28,5.3)],
                                *(zc[0]-0.3, zc[1]+0.3)), prop_c)             # 各發螺旋槳
    # 單發螺旋槳
    if engines == 1 and blades and nose not in ('jet',) and not rotor:
        py = L2 + (0.3 if not canard else 0)
        if pusher:                                                            # 震電：推進式（尾部）
            m.add(extrude_z([(-0.3,-L2-0.9),(0.3,-L2-0.9),(0.3,-L2-0.5),(-0.3,-L2-0.5)],
                            -S2*0.4, S2*0.4), prop_c)
        else:
            m.add(extrude_z([(-0.3,py),(0.3,py),(0.3,py+0.55),(-0.3,py+0.55)], -S2*0.42, S2*0.42), prop_c)
            if blades >= 3:
                m.add(extrude_z([(-0.3,py),(0.3,py),(0.3,py+0.55),(-0.3,py+0.55)], -0.3, S2*0.42),
                      tone(body, 0.64))

    # ── 座艙 ──
    if not wing_only:
        cy0, cy1 = canopy
        zc = (2.0, 3.4) if boat else (1.7, 2.9)
        m.add(extrude_z([(-1.2,cy0),(1.2,cy0),(1.2,cy1),(-1.2,cy1)], *zc), GLASS)

    # ── 浮舟（水上機）──
    if floats:
        fl = [(4.6,-0.8),(3.4,-3.0),(0.4,-4.2),(-4.2,-3.6),(-5.0,-1.4),(-4.4,-0.6)]
        xs = [0.0] if floats == 1 else [-S2*0.42, S2*0.42]
        for ex in xs:
            m.add(extrude_x(fl, ex-1.2, ex+1.2), tone(body, 0.90), off=(0, 1.0, 0))
            for sy in (-1.4, 2.6):                                            # 支柱
                m.add(extrude_z([(ex-0.4,sy),(ex+0.4,sy),(ex+0.4,sy+0.7),(ex-0.4,sy+0.7)], -2.6, -0.4),
                      tone(body, 0.78))
        if floats == 1:                                                       # 強風：中央大浮舟＋翼端小浮舟
            for ex in (-S2*0.72, S2*0.72):
                m.add(extrude_x([(1.6,-0.6),(0.6,-2.0),(-1.6,-1.8),(-2.2,-0.6)], ex-0.6, ex+0.6),
                      tone(body, 0.90))

    # ── 固定脚整流罩 ──
    if spats:
        sp = [(1.6,-0.6),(2.6,-2.2),(2.3,-4.4),(0.6,-5.6),(-1.4,-5.0),(-2.4,-3.0),(-1.8,-1.0)]
        for ex in (-S2*0.36, S2*0.36):
            m.add(extrude_x(sp, ex-1.15, ex+1.15), tone(body, 0.90), off=(0, 1.4, 0))
            m.add(extrude_x([(-0.7,-5.2),(0.8,-5.2),(0.8,-6.6),(-0.7,-6.6)], ex-0.6, ex+0.6), TIRE,
                  off=(0, 1.4, 0))

    # ── 掛載 ──
    if torpedo:
        m.add(extrude_z([(-1.0,-2.6),(1.0,-2.6),(1.0,5.6),(-1.0,5.6)], -3.4, -1.7), STORE)
    if missiles:
        for ex in (-S2*0.34, S2*0.34):
            m.add(extrude_z([(ex-0.7,-1.6),(ex+0.7,-1.6),(ex+0.7,3.4),(ex-0.7,3.4)], -2.4, -1.0), MISSILE)
    if radar:
        for yy in (2.4, 4.6):
            m.add(extrude_z([(-S2*0.36,yy),(-2.4,yy),(-2.4,yy+0.55),(-S2*0.36,yy+0.55)], -0.1, 0.5), ANT)
    return m

FONT = "'Hiragino Sans','Noto Sans CJK TC',sans-serif"
def bhex(color, k):
    cx, cy = 23.6, 23.2; r = 6.9; hw = r*0.866; hh = r*0.5
    pts = f"{cx},{cy-r} {cx+hw},{cy-hh} {cx+hw},{cy+hh} {cx},{cy+r} {cx-hw},{cy+hh} {cx-hw},{cy-hh}"
    return (f'<polygon points="{pts}" fill="#000" stroke="{color}" stroke-width="1.3" stroke-linejoin="round"/>'
            f'<text x="{cx}" y="{cy+3.2}" font-size="8.8" font-weight="700" fill="{color}" '
            f'text-anchor="middle" font-family="{FONT}">{k}</text>')
def brect(color, k2):
    cx, cy = 22.6, 24.4
    return (f'<rect x="{cx-7.6}" y="{cy-5.1}" width="15.2" height="10.2" rx="3" fill="#000" '
            f'stroke="{color}" stroke-width="1.3"/>'
            f'<text x="{cx}" y="{cy+2.6}" font-size="7" font-weight="700" fill="{color}" '
            f'text-anchor="middle" letter-spacing="-0.4" font-family="{FONT}">{k2}</text>')
def bbare(color, k):
    return (f'<text x="23.6" y="27.0" font-size="10.5" font-weight="700" fill="{color}" '
            f'text-anchor="middle" font-family="{FONT}">{k}</text>')

CAM = make_cam(-45, 32)
def emit(m, badge='', fit=(0.5, 1.5, 26.5, 24.0)):
    # 機體包進 <g class="a">（徽章在外，不隨正規化縮放——它是固定尺寸的辨識元件）
    return ('<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            '<g class="a">' + m.render(CAM, fit) + '</g>' + badge + '</svg>')

# 主色：EO 原圖採樣（遊戲慣例）
CV = "#00c040"    # 艦載機
LD = "#00b020"    # 陸上機
JT = "#44aa88"    # 噴式
SE = "#80d0aa"    # 水上機
BT = "#88cc99"    # 大型飛行艇
AS = "#7eccd8"    # 對潛（實機確認）
AG = "#65ca76"    # 回転翼機
LT = "#39b74e"    # 陸上機（56–60 新色系，EO 採樣）
NB = "#817aad"    # 夜間系徽章

SPEC = {
  # id: (機體名, body, span(m), length(m), kwargs, badge)
  '6':  ("零戦 A6M",      CV, 11.0,  9.12,  dict(nose='radial', canopy=(1.4,5.6)), bhex('#60c080','戦')),
  '7':  ("彗星 D4Y",      CV, 11.5,  10.22, dict(nose='inline', canopy=(0.6,6.4)), bhex('#f06968','爆')),
  '8':  ("天山 B6N",      CV, 14.89, 10.87, dict(nose='radial', canopy=(0.2,6.8), torpedo=True), bhex('#4080c0','攻')),
  '9':  ("彩雲 C6N",      CV, 12.5,  11.15, dict(nose='radial', canopy=(0.0,7.2)), bhex('#ffdd00','偵')),
  '21': ("カ号 Ka-1",     AG, 12.2,  9.1,   dict(rotor=True, blades=0, canopy=(0.6,4.2), tail_h=3.6), ''),
  '22': ("東海 Q1W",      AS, 16.0,  12.09, dict(nose='radial', engines=2, canopy=(0.4,6.6)), bhex(AS,'哨')),
  '39': ("景雲改 R2Y2",   JT, 14.0,  13.05, dict(nose='jet', blades=0, canopy=(1.6,6.4)), bhex('#d9a70f','噴')),
  '40': ("橘花改 J9Y",    JT, 10.0,  8.125, dict(nose='jet', blades=0, engines=2, canopy=(1.2,4.8)), bhex('#d9a70f','噴')),
  '45': ("F6F-3N",        CV, 13.06, 10.24, dict(nose='radial', canopy=(1.6,5.6), radar=True), brect(NB,'夜戦')),
  '46': ("TBM-3D",        CV, 16.51, 12.42, dict(nose='radial', canopy=(0.4,6.8), torpedo=True, radar=True), brect(NB,'夜攻')),
  '10': ("瑞雲 E16A",     SE, 12.81, 10.83, dict(nose='radial', canopy=(0.6,6.4), floats=2), ''),
  '33': ("二式大艇 H8K",  BT, 38.0,  28.13, dict(nose='radial', engines=4, canopy=(2.0,8.0), boat=True), ''),
  '43': ("強風 N1K",      SE, 12.0,  10.59, dict(nose='radial', canopy=(1.4,5.6), floats=1), ''),
  '50': ("零式水偵 E13A", SE, 14.5,  11.3,  dict(nose='radial', canopy=(0.2,7.0), floats=2), bhex(NB,'夜')),
  '51': ("夜間瑞雲",      SE, 12.81, 10.83, dict(nose='radial', canopy=(0.6,6.4), floats=2), bbare(NB,'夜')),
  '37': ("一式陸攻 G4M",  LD, 24.88, 19.63, dict(nose='radial', engines=2, canopy=(0.0,8.0)), bhex('#3daf0f','陸')),
  '38': ("雷電 J2M",      LD, 10.8,  9.945, dict(nose='blunt', canopy=(1.4,5.4)), bhex('#60c080','局')),
  '44': ("隼 Ki-43",      LD, 10.84, 8.92,  dict(nose='radial', canopy=(1.4,5.4)), bhex('#9ff3aa','陸')),
  '47': ("陸上対潜哨戒機", AS, 17.0, 13.0,  dict(nose='radial', engines=2, canopy=(0.4,6.8)), bhex(AS,'哨')),
  '48': ("キ102乙改",     LD, 15.57, 11.45, dict(nose='radial', engines=2, canopy=(0.6,6.0), missiles=True), bhex('#60c080','襲')),
  '49': ("深山 G5N",      LD, 42.12, 31.02, dict(nose='radial', engines=4, canopy=(1.0,9.0)), brect('#f06968','重爆')),
  '56': ("Me262 A-1a/R1", JT, 12.6,  10.6,  dict(nose='jet', blades=0, engines=2, canopy=(1.4,5.4)), bhex('#60c080','局')),
  '57': ("試製震電 J7W",  LT, 11.11, 9.66,  dict(nose='radial', canard=True, pusher=True, canopy=(2.0,5.6)), ''),
  '58': ("零戦62型改",    LT, 11.0,  9.121, dict(nose='radial', canopy=(1.4,5.6)), brect(NB,'夜爆')),
  '59': ("Ho229",         BT, 16.75, 7.47,  dict(nose='jet', blades=0, wing_only=True), bhex('#bebec3','噴')),
  '60': ("震電改三",      LT, 11.11, 9.66,  dict(nose='jet', blades=0, canard=True, canopy=(2.0,5.6)), bhex('#bebec3','噴')),
}

if __name__ == '__main__':
    os.makedirs("all3d", exist_ok=True)
    made, skipped = [], []
    for k, (nm, body, span, length, kw, bd) in SPEC.items():
        # 無徽章＝機體輪廓是唯一辨識線索，3D 的多面與光照反而使輪廓破碎、彼此難分辨。
        # 這些沿用 gen_icons.py 的原始正俯視版（十字剪影，小尺寸可讀性最佳），此處不產出。
        if bd == '':
            skipped.append(k); continue
        made.append(k)
        open(f"all3d/{k}.svg", "w").write(emit(plane(body, span, length, **kw), bd))
    print("飛機族 3D(有徽章):", len(made), "顆")
    print("沿用原始正俯視(無徽章):", " ".join(sorted(skipped, key=int)))
    nx, ny, _ = project((0, 10, 0), CAM)
    print("機首落點 %.1f 點鐘 | #00c040 最暗面 %s" % (
        ((math.degrees(math.atan2(nx, -ny))+360) % 360)/30, tone("#00c040", LIT_LO)))
