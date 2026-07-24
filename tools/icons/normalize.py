# -*- coding: utf-8 -*-
"""尺寸正規化 ＋ 描邊注入 — 圖示產出的最後一步（必跑）。

【描邊】遊戲原圖的所有圖示都有描邊（貼紙風格）。除了風格一致，描邊還有功能性理由：
面板圖示以 <img src> 載入，SVG 是獨立文件、吃不到外部 CSS，故無法靠主題 CSS 改色；
描邊讓圖示「自足」——在亮底或暗底都有輪廓可讀，是未來亮暗主題切換的前提。
做法：feMorphology 對整組的合成 alpha 做 dilate，再以描邊色 flood 後墊在原圖下方，
得到單一外輪廓（非逐面線框——已用 3D 飛機驗證）。描邊色＝該圖示主色的暗階，
由渲染結果自動取樣，故無需逐顆指定。


問題：各顆的畫布佔用率原本沒有統一標準（實測 16px 下高度 4.8px–15.2px，差 3 倍），
      在編成欄的裝備 chip 並排時高度明顯不一。
做法：把 <g class="a">（本體，不含徽章）單獨渲染、量測其實際不透明範圍，
      再注入 transform 使 max(寬,高) = TARGET 並置中。
      —— 用「較長邊」而非固定高度：寬型（飛機/魚雷）填滿寬度、長型（螺絲）填滿高度，
         強制等高會把寬型壓扁變形。
      —— 徽章在 <g class="a"> 外，不參與縮放（固定尺寸才維持小圖可讀）。
用法：python3 normalize.py <icons_dir>...
"""
import os, re, sys, subprocess, tempfile, struct, zlib

TARGET = 27.0        # 較長邊的目標佔用（32 格 viewBox；留邊距給描邊）
OUTLINE_R = 0.85     # 描邊寬度（user units）。過粗會填平細節（如羊角分叉凹口）、
                     # 過細在 16px 下看不見——0.85 是實測的平衡點。
CENTER = (16.0, 16.0)

# 量測用背景：qlmanage 渲染的底是白色，而白色圖示（如 34 戦闘糧食＝おにぎり）會完全
# 偵測不到 → bbox 嚴重低估 → 縮放暴衝、圖示撐爆畫布。故墊一層無圖示使用的洋紅底。
PROBE_BG = "#ff00ff"
# 量測用畫布：必須比 0–32 大。若用 viewBox="0 0 32 32" 量測，畫到畫布外的部分會先被裁掉，
# 量測器看不到溢出、算出「不用縮放」，該圖示就永遠是被切掉的狀態
# （實例：12 三式弾的爆散線延伸到 y=−1.77，曾因此漏網）。
PROBE_VB = (-10.0, -10.0, 52.0)      # (x0, y0, size)：涵蓋 −10 ~ 42

def render_png(svg_text, size=192):
    d = tempfile.mkdtemp()
    p = os.path.join(d, "t.svg")
    open(p, "w").write(svg_text)
    subprocess.run(["/usr/bin/qlmanage", "-t", "-s", str(size), "-o", d, p],
                   capture_output=True)
    out = os.path.join(d, "t.svg.png")
    return out if os.path.exists(out) else None

def png_pixels(path):
    data = open(path, "rb").read()
    pos, w, h, idat = 8, 0, 0, b""
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        if typ == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", data[pos+8:pos+18])
        elif typ == b"IDAT":
            idat += data[pos+8:pos+8+ln]
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0:1, 2:3, 4:2, 6:4}[ct]
    stride = w*ch
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i+stride]); i += stride
        for x in range(stride):
            a = line[x-ch] if x >= ch else 0
            b = prev[x]
            c = prev[x-ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a+b)//2) & 255
            elif f == 4:
                pp = a+b-c
                pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(bytes(line)); prev = line
    return w, h, ch, rows

def bbox_and_color(path):
    """回傳 (bbox, 主色)。主色＝出現最多的非背景色，用來推導描邊色。"""
    w, h, ch, rows = png_pixels(path)
    bg = rows[0][0:ch]
    x0, y0, x1, y1 = 10**9, 10**9, -1, -1
    counts = {}
    for y in range(h):
        r = rows[y]
        for x in range(w):
            px = r[x*ch:(x+1)*ch]
            if sum(abs(px[k]-bg[k]) for k in range(ch)) <= 30:
                continue
            if x < x0: x0 = x
            if x > x1: x1 = x
            if y < y0: y0 = y
            if y > y1: y1 = y
            key = tuple(px[:3])
            counts[key] = counts.get(key, 0) + 1
    if x1 < 0: return None, None
    vx, vy, vs = PROBE_VB
    S = h/vs                      # 每單位像素數（量測畫布為 vs×vs）
    # 主色：排除近黑（徽章底）與近白（高光），取剩餘最多者
    def ok(c):
        mx, mn = max(c)/255, min(c)/255
        l = (mx+mn)/2
        return 0.12 < l < 0.92
    cand = [(n, c) for c, n in counts.items() if ok(c)]
    main = max(cand)[1] if cand else (128, 128, 128)
    return (vx + x0/S, vy + y0/S, vx + (x1+1)/S, vy + (y1+1)/S), main

# 描邊色：全圖示統一的中性深墨色，不隨圖示主色變化。
# 早期版本用「主色的暗階」，對紅色系圖示必然生出暗紅——暗紅是最搶眼的顏色之一，
# 當輪廓用會刺眼、喧賓奪主。描邊的角色是「墨線」而非「彩色光暈」，故用單一中性色。
INK = "#37302a"      # 暖中性深墨（略帶暖調，呼應面板的黃銅色系與遊戲的暖色調）

def outline_color(rgb):
    return INK

def normalize(path):
    s = open(path).read()
    m = re.search(r'<g class="a">(.*)</g>', s, re.S)
    if not m: return None
    art = m.group(1)
    vx, vy, vs = PROBE_VB
    png = render_png(f'<svg viewBox="{vx} {vy} {vs} {vs}" xmlns="http://www.w3.org/2000/svg">'
                     f'<rect x="{vx}" y="{vy}" width="{vs}" height="{vs}" fill="{PROBE_BG}"/>'
                     f'{art}</svg>')
    if not png: return None
    b, main = bbox_and_color(png)
    if not b: return None
    x0, y0, x1, y1 = b
    w, h = x1-x0, y1-y0
    if max(w, h) < 0.5: return None
    k = TARGET / max(w, h)
    cx, cy = (x0+x1)/2, (y0+y1)/2
    tx, ty = CENTER[0] - cx*k, CENTER[1] - cy*k
    oc = INK        # 全圖示統一（見上方說明）

    # <svg …>【filter】<g filter><g class="a" transform>ART</g>【徽章等其餘內容】</g></svg>
    head_end = s.index('>') + 1
    body = s[head_end:s.rindex('</svg>')]
    body = body.replace('<g class="a">',
                        f'<g class="a" transform="translate({tx:.3f} {ty:.3f}) scale({k:.4f})">', 1)
    filt = (f'<filter id="ol" x="-16%" y="-16%" width="132%" height="132%" '
            f'color-interpolation-filters="sRGB">'
            f'<feMorphology in="SourceAlpha" operator="dilate" radius="{OUTLINE_R}" result="d"/>'
            f'<feFlood flood-color="{oc}" result="c"/>'
            f'<feComposite in="c" in2="d" operator="in" result="r"/>'
            f'<feMerge><feMergeNode in="r"/><feMergeNode in="SourceGraphic"/></feMerge>'
            f'</filter>')
    out = s[:head_end] + filt + f'<g filter="url(#ol)">' + body + '</g></svg>'
    open(path, "w").write(out)
    return round(w,1), round(h,1), round(k,3), oc

if __name__ == "__main__":
    n = 0
    for d in sys.argv[1:]:
        for f in sorted(os.listdir(d)):
            if not f.endswith(".svg"): continue
            r = normalize(os.path.join(d, f))
            if r: n += 1
    print(f"正規化＋描邊 {n} 顆 → 較長邊 {TARGET} 單位、描邊 r={OUTLINE_R}")
