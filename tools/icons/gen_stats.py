# -*- coding: utf-8 -*-
"""艦娘數值圖示（B′ 語意微彩定版）。

遊戲 12 項：耐久／火力／裝甲／雷裝／迴避／對空／搭載／對潛／速力／索敵／射程／運。
專案補齊：命中／爆裝／士氣／夜戰／制空。
檔名即 key，輸出 public/icons/stat/<key>.svg。描邊由 normalize.py 注入。
"""
from __future__ import annotations
import colorsys
import math
import os
import sys

FLOOR = 0.26
INK = "#37302a"
BEIGE = "#8a7d6c"
CUT = "#e4d8c8"
YEL = "#d4b83a"

KEYS = (
    "hp", "fire", "armor", "torp", "evade", "aa", "slot", "asw",
    "speed", "los", "range", "luck", "acc", "bomb", "morale", "night", "air",
)

SEMANTIC = {
    "hp": "#c46a6a", "fire": "#c9a23d", "armor": "#8a97a8", "torp": "#6aa06a",
    "evade": "#7a8ea6", "aa": "#4aaf60", "slot": "#4aaf60", "asw": "#a8763e",
    "speed": "#b8a070", "los": "#6f8fb8", "range": "#9a8060", "luck": "#d08060",
    "acc": "#8b7cc9", "bomb": "#c07050", "morale": "#d4b83a", "night": "#7a84b0",
    "air": "#3fae5f",
}

def _parse(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

def _hex(r, g, b):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v * 255))) for v in (r, g, b))

def clamp_light(c, lo=None):
    lo = FLOOR if lo is None else lo
    r, g, b = _parse(c)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return _hex(*colorsys.hls_to_rgb(h, max(l, lo), s))

def shade(c, f=0.62):
    r, g, b = _parse(c)
    return clamp_light(_hex(r * f, g * f, b * f))

def light(c, f=0.35):
    r, g, b = _parse(c)
    return clamp_light(_hex(r + (1 - r) * f, g + (1 - g) * f, b + (1 - b) * f))

def mix(a, b, t):
    ar, ag, ab = _parse(a)
    br, bg, bb = _parse(b)
    return clamp_light(_hex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t))

def pal(key):
    fill = clamp_light(mix(BEIGE, SEMANTIC[key], 0.62))
    return dict(f=fill, h=light(fill, 0.38), l=shade(fill, 0.62), c=clamp_light(CUT, 0.72))

def thick(x1, y1, x2, y2, t, fill):
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1
    nx, ny = -dy / length * t / 2, dx / length * t / 2
    return (
        f'<path fill="{fill}" d="M{x1 + nx:.2f} {y1 + ny:.2f} L{x2 + nx:.2f} {y2 + ny:.2f} '
        f'L{x2 - nx:.2f} {y2 - ny:.2f} L{x1 - nx:.2f} {y1 - ny:.2f} Z"/>'
    )

def svg(body):
    return (
        '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        '<g class="a">' + body + '</g></svg>'
    )

def _hp(f, h, l, c):
    heart = (
        "M16 26.4 C15.2 25.7 7.4 20.0 6.0 16.0 C4.0 11.2 6.8 6.8 11.0 6.8 "
        "C13.4 6.8 14.8 8.2 16 10.4 C17.2 8.2 18.6 6.8 21.0 6.8 "
        "C25.2 6.8 28.0 11.2 26.0 16.0 C24.6 20.0 16.8 25.7 16 26.4 Z"
    )
    return (
        f'<path fill="{f}" d="{heart}"/>'
        f'<path fill="{h}" d="M11.0 8.2 C9.2 8.2 7.8 10.0 8.0 12.4 '
        f'C8.8 10.6 10.6 9.4 12.8 9.2 C12.2 8.6 11.6 8.2 11.0 8.2 Z"/>'
    )

def _fire(f, h, l, c):
    # 大和 46cm：小砲塔、長三管。
    mid = mix(f, l, 0.22)
    face = mix(f, l, 0.4)
    return "".join([
        f'<ellipse cx="8.4" cy="22.4" rx="6.2" ry="2.6" fill="{mix(f, l, 0.12)}"/>',
        f'<path fill="{f}" d="M3.4 16.0 L5.0 10.2 L12.8 9.0 L16.2 12.0 L14.8 20.2 L4.4 21.0 Z"/>',
        f'<path fill="{face}" d="M16.2 12.0 L17.8 13.2 L16.4 20.8 L14.8 20.2 Z"/>',
        f'<rect x="5.6" y="11.0" width="6.6" height="1.25" rx="0.5" fill="{mix(f, l, 0.28)}"/>',
        thick(15.2, 12.2, 30.6, 14.4, 1.95, h),
        thick(15.8, 15.2, 31.2, 17.4, 2.1, f),
        thick(15.0, 18.2, 30.4, 20.4, 1.95, mid),
        f'<ellipse cx="30.6" cy="14.4" rx="0.72" ry="0.95" fill="{l}"/>',
        f'<ellipse cx="31.2" cy="17.4" rx="0.72" ry="0.95" fill="{l}"/>',
        f'<ellipse cx="30.4" cy="20.4" rx="0.72" ry="0.95" fill="{l}"/>',
    ])

def _armor(f, h, l, c):
    bits = [f'<rect x="5.4" y="5.4" width="21.2" height="21.2" rx="3.4" fill="{f}"/>']
    for x, y in ((11.2, 11.0), (20.8, 11.0), (11.2, 16.0), (20.8, 16.0), (11.2, 21.0), (20.8, 21.0)):
        bits.append(f'<circle cx="{x}" cy="{y}" r="1.85" fill="{l}"/>')
        bits.append(f'<circle cx="{x - 0.35}" cy="{y - 0.4}" r="0.7" fill="{h}" opacity="0.55"/>')
    return "".join(bits)

def _torp(f, h, l, c):
    nose = mix(INK, f, 0.22)
    bits = [
        f'<rect x="4.6" y="12.6" width="20.6" height="6.8" rx="3.4" fill="{f}"/>',
        f'<path fill="{nose}" d="M1.8 16.0 Q1.8 12.4 8.4 12.6 L8.4 19.4 Q1.8 19.6 1.8 16.0 Z"/>',
        f'<rect x="8.2" y="12.6" width="1.2" height="6.8" fill="{nose}" opacity="0.55"/>',
        f'<path fill="{mix(f, l, 0.25)}" d="M21.4 10.2 L24.8 10.2 L24.0 12.8 L21.6 12.8 Z"/>',
        f'<path fill="{mix(f, l, 0.25)}" d="M21.4 21.8 L24.8 21.8 L24.0 19.2 L21.6 19.2 Z"/>',
        f'<g transform="translate(26.6 16) rotate(38)">',
    ]
    for ang in (0, 90, 180, 270):
        bits.append(f'<ellipse cx="0" cy="-3.2" rx="0.78" ry="3.3" fill="{h}" transform="rotate({ang})"/>')
    bits.append(f'<circle r="1.05" fill="{mix(h, f, 0.25)}"/></g>')
    return "".join(bits)

def _evade(f, h, l, c):
    return "".join([
        f'<circle cx="22.0" cy="7.2" r="3.6" fill="{f}"/>',
        f'<path fill="{f}" d="M18.2 10.2 L24.2 12.0 L22.6 18.4 L16.8 16.6 Z"/>',
        f'<path fill="{f}" d="M23.0 12.2 L29.4 9.0 L30.2 11.4 L24.2 14.6 Z"/>',
        f'<path fill="{f}" d="M17.4 12.4 L10.6 15.8 L12.0 18.0 L18.6 14.4 Z"/>',
        f'<path fill="{f}" d="M17.6 16.4 L15.0 22.8 L8.6 27.0 L11.8 28.2 L19.2 23.0 L20.8 17.2 Z"/>',
        f'<path fill="{f}" d="M20.6 16.8 L25.6 18.8 L29.6 26.6 L25.8 27.8 L22.0 20.6 Z"/>',
    ])

def _aa(f, h, l, c):
    # 雙管絕對座標朝左上，避免 rotate 轉進基座。
    return "".join([
        f'<path fill="{mix(f, l, 0.15)}" d="M5.0 30.4 L27.2 30.4 L24.6 25.4 L7.6 25.4 Z"/>',
        f'<path fill="{f}" d="M10.2 25.6 L21.8 25.6 L20.6 20.8 L11.4 20.8 Z"/>',
        f'<path fill="{f}" d="M14.4 11.4 Q13.4 10.8 13.0 13.4 L12.4 21.2 L24.4 20.4 '
        f'L25.2 14.2 Q24.2 10.4 19.6 10.8 Z"/>',
        thick(3.4, 3.6, 16.8, 14.4, 2.35, f),
        thick(4.6, 7.8, 17.6, 18.2, 2.35, f),
        thick(2.4, 2.8, 6.2, 5.8, 4.2, h),
        thick(3.6, 7.0, 7.4, 10.0, 4.2, h),
    ])

def _slot(f, h, l, c):
    inner = (
        f'<rect x="10.2" y="3.55" width="11.6" height="1.45" rx="0.7" fill="{f}"/>'
        f'<path fill="{f}" d="M13.6 5.2 Q13.2 2.2 16 2.0 Q18.8 2.2 18.4 5.2 L18.2 7.6 L13.8 7.6 Z"/>'
        f'<path fill="{f}" d="M13.6 7.2 L18.4 7.2 L18.2 24.6 Q16 29.4 13.8 24.6 Z"/>'
        f'<ellipse cx="16" cy="13.6" rx="14.8" ry="3.9" fill="{f}"/>'
        f'<ellipse cx="16" cy="25.0" rx="6.4" ry="2.25" fill="{f}"/>'
        f'<path fill="{f}" d="M16 26.2 L16 30.4 L19.0 27.2 Z"/>'
    )
    return f'<g transform="rotate(-40 16 16)">{inner}</g>'

def _asw(f, h, l, c):
    def keg(x, y, w=10.6, ht=16.4):
        hx1, hx2, hy = x + 2.3, x + w - 2.3, y + 0.6
        return (
            f'<rect x="{x}" y="{y}" width="{w}" height="{ht}" rx="3.2" fill="{f}"/>'
            f'<path fill="{f}" d="M{hx1} {hy} C{hx1} {y - 4.2} {hx2} {y - 4.2} {hx2} {hy} '
            f'L{hx2 - 1.6} {hy} C{hx2 - 1.6} {y - 2.2} {hx1 + 1.6} {y - 2.2} {hx1 + 1.6} {hy} Z"/>'
        )
    return keg(4.2, 11.2) + keg(16.8, 9.0)

def _speed(f, h, l, c):
    def chevron(x):
        return (
            f'<path fill="{f}" d="M{x:.1f} 6.2 L{x + 9.4:.1f} 16.0 L{x:.1f} 25.8 '
            f'L{x + 3.2:.1f} 25.8 L{x + 12.6:.1f} 16.0 L{x + 3.2:.1f} 6.2 Z"/>'
        )
    return chevron(2.2) + chevron(10.0) + chevron(17.8)

def _los(f, h, l, c):
    yel = clamp_light(YEL)
    return (
        f'<circle cx="16" cy="16" r="12.6" fill="none" stroke="{f}" stroke-width="2.6"/>'
        f'<path fill="none" stroke="{yel}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" '
        f'd="M5.4 17.6 L9.6 17.6 L11.6 11.4 L14.4 22.6 L17.2 8.8 L19.8 20.4 L21.8 17.6 L26.6 17.6"/>'
    )

def _range(f, h, l, c):
    # 離水平 30°：SVG 由朝上轉 60°。彈體為主、平行粗箭較小。
    body = mix(c, f, 0.04)
    tip = mix(INK, f, 0.2)
    band = clamp_light("#efe6d4")
    base = mix(f, l, 0.35)
    return (
        f'<g transform="translate(11.4 10.6) rotate(60) scale(0.66) translate(-16 -16)">'
        f'<path fill="{body}" d="M11.0 12.0 Q11.0 5.0 16 1.8 Q21.0 5.0 21.0 12.0 L21.0 25.6 '
        f'Q21.0 27.0 19.6 27.0 L12.4 27.0 Q11.0 27.0 11.0 25.6 Z"/>'
        f'<path fill="{tip}" d="M11.6 9.2 Q12.2 4.6 16 1.8 Q19.8 4.6 20.4 9.2 Z"/>'
        f'<rect x="11.0" y="20.4" width="10.0" height="2.4" fill="{band}"/>'
        f'<rect x="11.0" y="25.0" width="10.0" height="2.0" rx="0.6" fill="{base}"/>'
        f'</g>'
        f'<g transform="translate(5.2 6.4) rotate(60 16 16)">'
        f'<rect x="14.75" y="14.4" width="2.5" height="11.4" rx="0.25" fill="{f}"/>'
        f'<path fill="{f}" d="M12.4 15.6 L16 8.6 L19.6 15.6 Z"/>'
        f'</g>'
    )

def _luck(f, h, l, c):
    bits = [
        f'<path fill="{f}" fill-rule="evenodd" d="'
        "M16 16 m-12.0 0 a12.0 12.0 0 1 0 24.0 0 a12.0 12.0 0 1 0 -24.0 0 "
        'M16 16 m-5.6 0 a5.6 5.6 0 1 0 11.2 0 a5.6 5.6 0 1 0 -11.2 0"/>'
    ]
    for ang in (0, 90, 180, 270):
        bits.append(
            f'<g transform="rotate({ang} 16 16)">'
            f'<rect x="13.4" y="3.6" width="5.2" height="6.4" rx="1.3" fill="{c}"/>'
            f'</g>'
        )
    return "".join(bits)

def _acc(f, h, l, c):
    return (
        f'<path fill="{f}" fill-rule="evenodd" d="M16 16 m-11.4 0 a11.4 11.4 0 1 0 22.8 0 a11.4 11.4 0 1 0 -22.8 0 '
        f'M16 16 m-8.2 0 a8.2 8.2 0 1 0 16.4 0 a8.2 8.2 0 1 0 -16.4 0"/>'
        f'<circle cx="16" cy="16" r="2.3" fill="{f}"/>'
        f'<rect x="14.7" y="3.4" width="2.6" height="6.2" rx="0.8" fill="{f}"/>'
        f'<rect x="14.7" y="22.4" width="2.6" height="6.2" rx="0.8" fill="{f}"/>'
        f'<rect x="3.4" y="14.7" width="6.2" height="2.6" rx="0.8" fill="{f}"/>'
        f'<rect x="22.4" y="14.7" width="6.2" height="2.6" rx="0.8" fill="{f}"/>'
    )

def _bomb(f, h, l, c):
    return (
        f'<g transform="rotate(28 16 16)">'
        f'<path fill="{f}" d="M16 6.2 L19.6 10.4 L19.6 22.4 Q19.6 27.4 16 27.4 Q12.4 27.4 12.4 22.4 L12.4 10.4 Z"/>'
        f'<path fill="{f}" d="M11.0 8.2 L16 4.2 L21.0 8.2 L18.4 10.6 L16 8.8 L13.6 10.6 Z"/>'
        f'<path fill="{f}" d="M12.4 10.4 L9.4 7.2 L11.2 6.2 L13.6 9.4 Z"/>'
        f'<path fill="{f}" d="M19.6 10.4 L22.6 7.2 L20.8 6.2 L18.4 9.4 Z"/>'
        f'<ellipse cx="16" cy="24.6" rx="2.0" ry="1.5" fill="{l}"/>'
        f'</g>'
    )

def _morale(f, h, l, c):
    return (
        f'<path fill="{f}" d="M6.4 16.8 L16 7.0 L25.6 16.8 L21.6 16.8 L16 11.2 L10.4 16.8 Z"/>'
        f'<path fill="{f}" d="M6.4 24.6 L16 14.8 L25.6 24.6 L21.6 24.6 L16 19.0 L10.4 24.6 Z"/>'
    )

def _night(f, h, l, c):
    yel = clamp_light(YEL)
    return (
        f'<path fill="{yel}" d="M18.6 6.2 A10.8 10.8 0 1 0 18.6 25.8 A8.4 8.4 0 1 1 18.6 6.2 Z"/>'
        f'<circle cx="23.6" cy="9.2" r="1.15" fill="{yel}"/>'
    )

def _air(f, h, l, c):
    hinomaru = "#c46a6a"
    cowling = mix(INK, f, 0.28)
    return "".join([
        f'<ellipse cx="16" cy="15.0" rx="15.2" ry="4.35" fill="{f}"/>',
        f'<path fill="{f}" d="M13.8 7.0 Q13.6 4.8 16 4.6 Q18.4 4.8 18.2 7.0 '
        f'L17.8 23.2 Q16 28.8 14.2 23.2 Z"/>',
        f'<ellipse cx="16" cy="6.2" rx="3.5" ry="3.7" fill="{cowling}"/>',
        f'<circle cx="16" cy="4.4" r="1.25" fill="{h}"/>',
        f'<rect x="10.6" y="3.35" width="10.8" height="1.15" rx="0.55" fill="{mix(INK, f, 0.45)}"/>',
        f'<ellipse cx="16" cy="24.2" rx="6.4" ry="2.2" fill="{f}"/>',
        f'<path fill="{f}" d="M16 25.2 L16 30.6 L19.2 27.0 Z"/>',
        f'<rect x="14.6" y="9.0" width="2.8" height="7.8" rx="1.0" fill="{c}" opacity="0.9"/>',
        f'<circle cx="7.0" cy="15.0" r="2.25" fill="{hinomaru}"/>',
        f'<circle cx="25.0" cy="15.0" r="2.25" fill="{hinomaru}"/>',
    ])

SHAPES = {
    "hp": _hp, "fire": _fire, "armor": _armor, "torp": _torp, "evade": _evade,
    "aa": _aa, "slot": _slot, "asw": _asw, "speed": _speed, "los": _los,
    "range": _range, "luck": _luck, "acc": _acc, "bomb": _bomb, "morale": _morale,
    "night": _night, "air": _air,
}

def icon_svg(key: str) -> str:
    p = pal(key)
    hi = mix(p["f"], p["h"], 0.55)
    lo = mix(p["f"], p["l"], 0.45)
    return svg(SHAPES[key](p["f"], hi, lo, p["c"]))

if __name__ == "__main__":
    d = sys.argv[1]
    os.makedirs(d, exist_ok=True)
    for k in KEYS:
        open(os.path.join(d, f"{k}.svg"), "w").write(icon_svg(k))
    print("數值圖示:", " ".join(KEYS))
