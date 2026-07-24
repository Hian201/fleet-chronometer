#!/usr/bin/env python3
"""utils/ship-debut-data.ts 產生器（同 tools/icons 慣例：產出物勿手改，改這裡再重跑）。

輸入：
  samples/ship-debut-dates.json  ── 人工維護的來源（原文艦名 → {original,tw,en,date}）
  samples/start2-master.json     ── 去識別化的遊戲 master 子集（api_mst_ship/api_mst_shipupgrade）

輸出：
  utils/ship-debut-data.ts       ── 以「基礎形態 master id」為鍵的 { id: 'YYYY-MM-DD' }

為何以基礎形態 master id 為鍵（而非艦名）：
  · 執行期手上直接有 api_ship_id，反解到基礎形態後即可 O(1) 查表，不必做任何字串比對。
  · 艦名有拼法差異（'Samuel B. Roberts' vs master 的 'Samuel B.Roberts'、'Kirov' vs 'Киров'、
    '島根丸' vs 'しまね丸'），把這些別名在「產生階段」一次解掉，執行期就不必帶別名表。
  · master id 是遊戲常數、跨玩家與改版都穩定。

改造形態 → 基礎形態的反解（兩段，順序重要）：
  1. api_mst_shipupgrade 的 api_original_ship_id ── 直接標出基礎形態，**主要解法**。
  2. api_aftershipid 反向圖 ── 備援。單用它只有 94% 覆蓋率：部分改二（例 鈴谷改二 503）
     不在 aftershipid 鏈上，只有 shipupgrade 查得到（鈴谷改二 → api_original_ship_id 124 ＝鈴谷）。
     反向走法必須是「帶 visited 的圖搜尋」而非單鏈——可逆轉換改裝（同名不同艦種、可來回
     改裝）會互指成環，例 Glorious改 戦艦(740) ⇄ 正規空母(741)；單鏈會困在環裡繞不出去。
     走完取「無前身」的根，多根時取図鑑番号最小者。兩段合用覆蓋率 100%。

此解析邏輯與 utils/state.ts 的 GameState.baseShipId() 必須保持一致（產生期與執行期同語意）。
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEBUT_SRC = ROOT / 'samples' / 'ship-debut-dates.json'
MASTER_SRC = ROOT / 'samples' / 'start2-master.json'
OUT = ROOT / 'utils' / 'ship-debut-data.ts'

# 來源檔艦名 → master api_name 的拼法差異。只在此處集中處理。
ALIASES = {
    'Samuel B. Roberts': 'Samuel B.Roberts',
    'Giuseppe Garibaldi': 'G.Garibaldi',
    'C. Cappellini': 'C.Cappellini',
    'Kirov': 'Киров',
    '島根丸': 'しまね丸',
}


def build_base_resolver(master):
    """回傳 to_base(master_id) -> 基礎形態 master_id。"""
    original = {}
    for row in master.get('api_mst_shipupgrade', []):
        ship_id, base_id = row.get('api_id'), row.get('api_original_ship_id')
        if ship_id and base_id:
            original.setdefault(ship_id, base_id)

    by_id = {s['api_id']: s for s in master['api_mst_ship']}
    # 存「所有」前身（非只留第一個），才能在可逆轉換造成的環中繞出去。
    prev = {}
    for ship in master['api_mst_ship']:
        raw = ship.get('api_aftershipid', '0')
        # api_aftershipid 是「字串」（真封包實證），'0' 代表無後續改造。
        after = int(raw) if raw and raw != '0' else 0
        if after:
            prev.setdefault(after, []).append(ship['api_id'])

    def to_base(ship_id):
        if ship_id in original:
            return original[ship_id]
        seen, stack, roots = {ship_id}, [ship_id], []
        while stack:
            cur = stack.pop()
            preds = prev.get(cur)
            if not preds:
                roots.append(cur)
                continue
            for p in preds:
                if p in seen:
                    continue
                seen.add(p)
                stack.append(p)
        if not roots:
            return ship_id
        return min(roots, key=lambda r: (by_id.get(r, {}).get('api_sortno') or 10 ** 9, r))

    return to_base


def main():
    debut = json.loads(DEBUT_SRC.read_text(encoding='utf-8'))
    master = json.loads(MASTER_SRC.read_text(encoding='utf-8'))
    ships = master['api_mst_ship']
    to_base = build_base_resolver(master)

    # 同名多形態時偏好「最原始」那個（図鑑番号最小）：例如 'Glorious' 有戦艦(1022,No.612)
    # 與正規空母(1027,No.617) 兩筆，來源檔的一筆日期應掛到 1022。即使挑錯，to_base() 也會
    # 把它收斂到同一基礎形態，此處排序只是讓對應更直觀。
    name_to_id = {}
    for ship in sorted(ships, key=lambda s: (s.get('api_sortno') or 10 ** 9, s['api_id'])):
        name_to_id.setdefault(ship.get('api_name', ''), ship['api_id'])

    by_base, unresolved = {}, []
    for name, entry in debut.items():
        # 底線開頭的鍵保留給來源檔的註記（如 _note），不是艦名。
        if name.startswith('_'):
            continue
        master_name = ALIASES.get(name, name)
        ship_id = name_to_id.get(master_name)
        if not ship_id:
            unresolved.append(name)
            continue
        base = to_base(ship_id)
        date = entry['date']
        # 同一基礎形態被多個來源條目命中時取最早日期（＝真正的初次登場）。
        if base not in by_base or date < by_base[base]:
            by_base[base] = date

    if unresolved:
        raise SystemExit(f'以下來源艦名對不到 master，請補 ALIASES 或修正來源：{unresolved}')

    id_to_name = {s['api_id']: s.get('api_name', '') for s in ships}
    lines = [f"    {base}: '{date}',"
             f"   // {id_to_name.get(base, '?')}"
             for base, date in sorted(by_base.items())]

    OUT.write_text(f"""// 艦娘「官方初次登場日」參照資料（date1）。純資料模組、無 chrome.*（設計原則 4）。
//
// **本檔由 tools/ship-debut/generate.py 產生，請勿手改**——要改資料請改
// samples/ship-debut-dates.json（人工維護的來源，含 tw/en 譯名）後重跑產生器。
//
// 鍵＝「基礎形態」的 api_ship_id（master id）。查詢時先把手上艦的 api_ship_id 反解到基礎
// 形態（見 GameState.baseShipId），再查本表——改造形態（改／改二／改三）因此自動沿用基礎
// 形態的登場日，不需要為每個形態各存一筆。
//
// 用途：鎮守府情報總括「艦娘全覽」顯示官方實裝日，並作為「打撈上任日（date2）」手動填寫
// 的下限（玩家填的入手日不得早於該艦官方登場日，見 utils/db.ts ShipObtainedRow）。
// 遊戲 API 不提供這個日期，故為外部參照資料；來源見 THIRD-PARTY-NOTICES.md。
export const SHIP_DEBUT: Record<number, string> = {{
{chr(10).join(lines)}
}};

/** 查基礎形態 master id 的官方登場日（'YYYY-MM-DD'）；未收錄回 null。 */
export function debutDateOf(baseMst: number): string | null {{
    return SHIP_DEBUT[baseMst] ?? null;
}}
""", encoding='utf-8')

    print(f'來源 {len(debut)} 筆 → 基礎形態 {len(by_base)} 筆，已寫入 {OUT.relative_to(ROOT)}')

    forms = [s for s in ships if s.get('api_sortno', 0)]
    hit = sum(1 for s in forms if to_base(s['api_id']) in by_base)
    print(f'覆蓋率自檢：有図鑑番号的 {len(forms)} 個形態中 {hit} 個查得到（{hit * 100 // len(forms)}%）')


if __name__ == '__main__':
    main()
