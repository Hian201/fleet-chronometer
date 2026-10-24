"""地理底圖共用：讀 Natural Earth 陸地、Mercator 投影到遊戲 1200×720 畫面、矩形裁切與簡化。

georef.json 每張圖給畫面中心 (600, 360) 的經緯度 `center: [經, 緯]`、比例 `scale`（每度經度幾 px）、
北方旋轉角 `rot`（度，逆時針為正：北朝左＝90、北朝右上＝-45）。座標系與 utils/map-spots.ts 的
節點座標相同（遊戲 1200×720 畫面）。投影用 Mercator（等角），不另外拉伸。

遊戲有不少海域把地圖橫擺（北朝左），故一定要支援旋轉。

中心點不好判讀、或美術比例失真的海域，改給控制點 `points: [[經, 緯, x, y], …]`（至少 2 點），
以最小平方法求 Mercator → 畫面的相似變換（比例＋旋轉＋平移，島形不變形）。控制點不共線且
需要各向異性拉伸時才加 `affine: true`（至少 3 點、不可近乎共線，否則會產生極端剪切）。
"""
import json
import math
from pathlib import Path

W, H = 1200, 720
HERE = Path(__file__).resolve().parent
CACHE = HERE / '.cache'
NE_FILES = ('ne_10m_land.geojson', 'ne_10m_minor_islands.geojson')
NE_REEFS = 'ne_10m_reefs.geojson'
NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'


def merc_y(lat: float) -> float:
    lat = max(-85.0, min(85.0, lat))
    return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def load_georef() -> dict:
    return json.loads((HERE / 'georef.json').read_text(encoding='utf-8'))


def load_rings() -> list[list[tuple[float, float]]]:
    """回傳所有陸地多邊形的環（經度, 緯度）。外環與內環（湖）都收，畫的時候用 evenodd。"""
    rings: list[list[tuple[float, float]]] = []
    for name in NE_FILES:
        path = CACHE / name
        if not path.exists():
            raise SystemExit(f'缺少 {path}；先下載：curl -L -o {path} {NE_URL}{name}')
        data = json.loads(path.read_text(encoding='utf-8'))
        for feature in data['features']:
            geom = feature['geometry']
            polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            for poly in polys:
                for ring in poly:
                    rings.append([(float(p[0]), float(p[1])) for p in ring])
    return rings


def load_reefs() -> list[list[tuple[float, float]]]:
    """珊瑚礁線（環礁的礁盤輪廓）；陸地層只有零星小島，環礁要靠這層才畫得出來。"""
    path = CACHE / NE_REEFS
    if not path.exists():
        raise SystemExit(f'缺少 {path}；先下載：curl -L -o {path} {NE_URL}{NE_REEFS}')
    data = json.loads(path.read_text(encoding='utf-8'))
    lines: list[list[tuple[float, float]]] = []
    for feature in data['features']:
        geom = feature['geometry']
        parts = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
        for part in parts:
            lines.append([(float(p[0]), float(p[1])) for p in part])
    return lines


def map_lines(ref: dict, lines, margin: float = 8.0, tolerance: float = 0.6):
    """折線版的投影＋裁切：離開畫面（含 margin）就斷開，只留畫面內的片段。"""
    project = projector(ref)
    x0, y0, x1, y1 = -margin, -margin, W + margin, H + margin
    out = []
    west, east, _, _ = geo_bounds(ref)
    for line in lines:
        lons = [p[0] for p in line]
        shift = next((k for k in (0, -360, 360) if max(lons) + k >= west and min(lons) + k <= east), 0)
        seg: list[tuple[float, float]] = []
        for lon, lat in line:
            x, y = project(lon + shift, lat)
            if x0 <= x <= x1 and y0 <= y <= y1:
                seg.append((x, y))
            else:
                if len(seg) >= 2:
                    out.append(simplify(seg, tolerance))
                seg = []
        if len(seg) >= 2:
            out.append(simplify(seg, tolerance))
    return out


def svg_polyline(lines) -> str:
    parts = []
    for pts in lines:
        coords: list[tuple[int, int]] = []
        for x, y in pts:
            p = (round(x), round(y))
            if not coords or coords[-1] != p:
                coords.append(p)
        if len(coords) >= 2:
            parts.append('M' + ' '.join(f'{x} {y}' for x, y in coords))
    return ''.join(parts)


def solve3(m: list[list[float]], v: list[float]) -> list[float]:
    """3×3 線性方程（高斯消去）。"""
    a = [row[:] + [v[i]] for i, row in enumerate(m)]
    for c in range(3):
        pivot = max(range(c, 3), key=lambda r: abs(a[r][c]))
        a[c], a[pivot] = a[pivot], a[c]
        for r in range(3):
            if r != c:
                f = a[r][c] / a[c][c]
                a[r] = [x - f * y for x, y in zip(a[r], a[c])]
    return [a[i][3] / a[i][i] for i in range(3)]


def affine_projector(points):
    """控制點最小平方：x = a·lon + b·Y + c，y 同理（Y 為 Mercator）。"""
    rows = [(lon, merc_y(lat), x, y) for lon, lat, x, y in points]
    ata = [[0.0] * 3 for _ in range(3)]
    atx = [0.0] * 3
    aty = [0.0] * 3
    for lon, my, x, y in rows:
        vec = (lon, my, 1.0)
        for i in range(3):
            for j in range(3):
                ata[i][j] += vec[i] * vec[j]
            atx[i] += vec[i] * x
            aty[i] += vec[i] * y
    cx = solve3(ata, atx)
    cy = solve3(ata, aty)

    def project(lon: float, lat: float) -> tuple[float, float]:
        my = merc_y(lat)
        return cx[0] * lon + cx[1] * my + cx[2], cy[0] * lon + cy[1] * my + cy[2]
    return project


def similarity_projector(points):
    """控制點最小平方的相似變換：w = a·z + b（z = 經 + i·Mercator 緯，w = x − i·y）。"""
    zs = [complex(lon, merc_y(lat)) for lon, lat, _, _ in points]
    ws = [complex(x, -y) for _, _, x, y in points]
    zm = sum(zs) / len(zs)
    wm = sum(ws) / len(ws)
    num = sum((w - wm) * (z - zm).conjugate() for z, w in zip(zs, ws))
    den = sum(abs(z - zm) ** 2 for z in zs)
    a = num / den
    b = wm - a * zm

    def project(lon: float, lat: float) -> tuple[float, float]:
        w = a * complex(lon, merc_y(lat)) + b
        return w.real, -w.imag
    return project


def unwrap_points(points):
    """控制點跨換日線時（例：東經 177.55° 與西經 176.6°），經度以第一點為準展開成連續值。"""
    lon0 = points[0][0]
    out = []
    for lon, lat, x, y in points:
        while lon - lon0 > 180:
            lon -= 360
        while lon - lon0 < -180:
            lon += 360
        out.append([lon, lat, x, y])
    return out


def projector(ref: dict):
    if 'points' in ref:
        pts = unwrap_points(ref['points'])
        return affine_projector(pts) if ref.get('affine') else similarity_projector(pts)
    lon0, lat0 = ref['center']
    scale = ref['scale']
    theta = math.radians(ref.get('rot', 0))
    y0 = merc_y(lat0)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    def project(lon: float, lat: float) -> tuple[float, float]:
        # 不逐點換算 ±180：跨接縫的大陸環會被拉成包住整個畫面的多邊形。換日線兩側的平移由
        # map_rings／map_lines 對整個環一次處理（NE 的環本身已在換日線切開）。
        east = (lon - lon0) * scale
        north = (merc_y(lat) - y0) * scale
        return W / 2 + east * cos_t - north * sin_t, H / 2 - (east * sin_t + north * cos_t)
    return project


def geo_bounds(ref: dict) -> tuple[float, float, float, float]:
    """畫面四角對應的經緯度外框（西, 東, 南, 北），供預先篩掉不相干的陸地環。"""
    if 'points' in ref:
        # 控制點模式：以控制點外框加大一倍作為篩選範圍
        pts = unwrap_points(ref['points'])
        lons = [p[0] for p in pts]
        lats = [p[1] for p in pts]
        dl, dt = max(lons) - min(lons), max(lats) - min(lats)
        return min(lons) - dl, max(lons) + dl, min(lats) - dt, max(lats) + dt
    lon0, lat0 = ref['center']
    scale = ref['scale']
    theta = math.radians(ref.get('rot', 0))
    y0 = merc_y(lat0)
    lons, lats = [], []
    for x, y in ((0, 0), (W, 0), (0, H), (W, H)):
        ex, ny = x - W / 2, H / 2 - y
        east = ex * math.cos(theta) + ny * math.sin(theta)
        north = -ex * math.sin(theta) + ny * math.cos(theta)
        lons.append(lon0 + east / scale)
        lats.append(inv_merc_y(y0 + north / scale))
    return min(lons), max(lons), min(lats), max(lats)


def inv_merc_y(y: float) -> float:
    return math.degrees(2 * math.atan(math.exp(math.radians(y))) - math.pi / 2)


def clip_ring(points: list[tuple[float, float]], x0: float, y0: float, x1: float, y1: float):
    """Sutherland–Hodgman：把多邊形環裁到矩形內。"""
    def clip(pts, inside, intersect):
        out = []
        if not pts:
            return out
        prev = pts[-1]
        for cur in pts:
            if inside(cur):
                if not inside(prev):
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(intersect(prev, cur))
            prev = cur
        return out

    def at_x(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def at_y(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = points
    pts = clip(pts, lambda p: p[0] >= x0, at_x(x0))
    pts = clip(pts, lambda p: p[0] <= x1, at_x(x1))
    pts = clip(pts, lambda p: p[1] >= y0, at_y(y0))
    pts = clip(pts, lambda p: p[1] <= y1, at_y(y1))
    return pts


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Ramer–Douglas–Peucker（非遞迴）。"""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        ax, ay = points[start]
        bx, by = points[end]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-9
        best, index = 0.0, -1
        for i in range(start + 1, end):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, index = d, i
        if index >= 0 and best > tolerance:
            keep[index] = True
            stack.append((start, index))
            stack.append((index, end))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(pts: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """閉合環首尾同點時 RDP 量不到距離，故在離起點最遠處切成兩段各自簡化。"""
    x0, y0 = pts[0]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
    if far == 0:
        return pts
    first = simplify(pts[:far + 1], tolerance)
    second = simplify(pts[far:] + [pts[0]], tolerance)
    return first[:-1] + second[:-1]


def map_rings(ref: dict, rings, margin: float = 8.0, tolerance: float = 0.8):
    """投影、裁切（畫面外留 margin）、簡化後的環；面積太小（< 2px²）的碎島略過。

    外框不與範圍相交的環直接略過；包住整個畫面的大陸環由矩形裁切自然變成畫面框。
    """
    project = projector(ref)
    west, east, south, north = geo_bounds(ref)
    pad_lon = (east - west) * 0.05
    pad_lat = (north - south) * 0.05
    out = []
    for ring in rings:
        lons = [p[0] for p in ring]
        lats = [p[1] for p in ring]
        if max(lats) < south - pad_lat or min(lats) > north + pad_lat:
            continue
        # 跨換日線：畫面範圍可能超出 ±180，整個環以 0／±360 平移後再比對
        shifts = [k for k in (0, -360, 360) if max(lons) + k >= west - pad_lon and min(lons) + k <= east + pad_lon]
        if not shifts:
            continue
        pts = [project(lon + shifts[0], lat) for lon, lat in ring]
        pts = clip_ring(pts, -margin, -margin, W + margin, H + margin)
        if len(pts) < 3:
            continue
        pts = simplify_ring(pts, tolerance)
        if len(pts) < 3 or abs(area(pts)) < 2.0:
            continue
        out.append(pts)
    return out


def area(pts) -> float:
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def svg_path(rings) -> str:
    """陸地 path。用 fill-rule nonzero：GeoJSON 外環與內環（湖）方向相反，投影只會整體翻轉方向，
    湖仍是洞；陸地層與小島層重疊的同一座島不會像 evenodd 那樣互相抵消。完全相同的環只留一份。"""
    parts = []
    seen: set[str] = set()
    for pts in rings:
        coords: list[tuple[int, int]] = []
        for x, y in pts:
            p = (round(x), round(y))
            if not coords or coords[-1] != p:
                coords.append(p)
        if len(coords) >= 3:
            d = 'M' + ' '.join(f'{x} {y}' for x, y in coords) + 'Z'
            if d not in seen:
                seen.add(d)
                parts.append(d)
    return ''.join(parts)
