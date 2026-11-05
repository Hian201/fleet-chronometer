// 裝備全覽的彙總／篩選／排序核心。
//
// 純函式、無 chrome.* 與 DOM，可獨立編譯用 node 餵真實 `ownedGears()` 輸出驗證
// （AGENTS.md 硬約束 6）。UI 殼在 entrypoints/overview/sections/equipment.ts。
//
// ── 為什麼母集合是「實例」但呈現是「種類」────────────────────────────────
// 遊戲的裝備庫是一顆一顆的實例（各自有改修 ★、熟練度、裝備在誰身上），但玩家問的問題
// 幾乎都是種類層級的：「我有幾個 41cm？改修到幾星？哪幾顆閒著？」。故本檔把實例
// `groupGears()` 成種類（master id）為主鍵的 GearGroup，把「數量／改修分佈／裝備中艦娘」
// 三者做成該種類的摘要，同時**保留 instances 原件**——展開列要顯示 ★ 與持有者，
// 摘要答不了「是哪一顆閒著」。這與 llm.ts 的裝備段落取捨一致（依 mst 彙總、不逐顆列舉），
// 差別只在這裡多留一層可展開的原件。展開列本身再經 `stackInstances()` 把同規格的實例
// 疊起來計數（見該函式說明）——原件保留完整，疊只是呈現層的事。
//
// ── 素質是基礎值 ──────────────────────────────────────────────────────
// GearGroup.stats 直接來自 master（api_mst_slotitem），**未含改修 ★ 加成**。改修加成的
// 公式依裝備類別與戰鬥情境而異，本專案不自行推導未經封包驗證的公式，故只呈現遊戲直接
// 給的數字；UI 必須標示這點，不可讓人誤讀成「這顆 ★10 的實際火力」。
import type { GearHolderView, GearStats, OwnedGearView } from './state';

/** 改修上限。遊戲的 ★ 上限為 10（★max）。 */
export const MAX_IMPROVE = 10;

/** 同一種裝備（master id）的彙總。 */
export interface GearGroup {
    mst: number;
    name: string;
    icon: number;
    catId: number;
    catName: string;
    sortNo: number;
    consumable: boolean;
    /** 基礎素質（未含改修，見檔頭）。 */
    stats: GearStats;
    /** 持有總數。 */
    count: number;
    /** 裝備中（艦或基地航空隊）的顆數。 */
    equipped: number;
    /** 閒置（裝備庫裡沒被使用）的顆數。 */
    idle: number;
    /** 最高改修星數；一顆都沒改修時為 0。 */
    maxLevel: number;
    /** 改修分佈，星數由高到低（例：★10×1 ★6×2 ★0×9）。 */
    levels: { level: number; count: number }[];
    /** 裝備中艦娘／基地，依顆數由多到少。同一艘裝了兩顆即 count=2；ex＝其中裝在補強增設的顆數。 */
    holders: { name: string; sub: string; kind: 'ship' | 'lbas'; count: number; ex: number }[];
    /** 逐顆原件（改修高者在前，同星數時裝備中的在前）。展開列用。 */
    instances: OwnedGearView[];
}

/**
 * 實例 → 種類彙總。同 master id 的實例合成一組。
 *
 * 排序輸出為遊戲的裝備圖鑑順（api_sortno），與遊戲內的裝備一覧同序；sortNo 缺失
 * （master 未載入）時退回 master id，仍是穩定順序。
 */
export function groupGears(gears: OwnedGearView[]): GearGroup[] {
    const byMst = new Map<number, OwnedGearView[]>();
    for (const g of gears) {
        const list = byMst.get(g.mst);
        if (list) list.push(g); else byMst.set(g.mst, [g]);
    }

    const groups: GearGroup[] = [];
    for (const [mst, list] of byMst) {
        const head = list[0];
        const levelCount = new Map<number, number>();
        const holderCount = new Map<string, GearGroup['holders'][number]>();
        let equipped = 0;
        for (const g of list) {
            levelCount.set(g.level, (levelCount.get(g.level) ?? 0) + 1);
            if (!g.holder) continue;
            equipped++;
            // 同名艦（多號機）不合併：key 帶 kind 與 sub 仍可能撞名，但那正是玩家眼中的
            // 「同一艘」——反查欄要回答的是「裝在誰身上」，不是「裝在哪個實例上」。
            const key = `${g.holder.kind}\u0000${g.holder.name}`;
            const ex = g.holder.ex ? 1 : 0;
            const hit = holderCount.get(key);
            if (hit) { hit.count++; hit.ex += ex; }
            else holderCount.set(key, { name: g.holder.name, sub: g.holder.sub, kind: g.holder.kind, count: 1, ex });
        }

        groups.push({
            mst,
            name: head.name,
            icon: head.icon,
            catId: head.catId,
            catName: head.catName,
            sortNo: head.sortNo,
            consumable: head.consumable,
            stats: head.stats,
            count: list.length,
            equipped,
            idle: list.length - equipped,
            maxLevel: list.reduce((max, g) => Math.max(max, g.level), 0),
            levels: [...levelCount.entries()]
                .map(([level, count]) => ({ level, count }))
                .sort((a, b) => b.level - a.level),
            holders: [...holderCount.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
            instances: [...list].sort((a, b) =>
                b.level - a.level || Number(!!b.holder) - Number(!!a.holder) || a.id - b.id),
        });
    }

    return groups.sort((a, b) => (a.sortNo || a.mst) - (b.sortNo || b.mst) || a.mst - b.mst);
}

// ── 展開列：同規格的實例再疊一層 ────────────────────────────────────────

/** 一疊「規格完全相同」的實例。展開列一行一疊，用 ×N 計數而非逐顆列。 */
export interface GearStack {
    level: number;
    alv: number;
    /** null＝閒置。 */
    holder: GearHolderView | null;
    count: number;
    /** 這一疊涵蓋的實例 id（升冪）。要對回單顆時用得上。 */
    ids: number[];
}

/**
 * 把一組實例依「規格」疊起來：**改修★＋熟練度＋持有者**三者全同才算同一疊。
 *
 * 為什麼要疊：`instances` 是逐顆原件，而一種常見裝備動輒二三十顆、且多半是
 * 「★0 且閒置」——逐顆畫會變成一整片一模一樣的方塊，既佔版面又看不出重點。
 * 疊起來之後，展開列讀起來就跟改修分佈欄同一個語感（★0 ×18・★6 明石 ×2）。
 *
 * **持有者要連 ex（補強增設）一起比**：同一艘艦的一般槽與增設槽是兩個不同的位置，
 * 合成一疊會讓「這顆到底在哪一格」變得答不出來。
 *
 * 排序：★高者在前 → 熟練度高者在前 → 裝備中的在閒置之前 → 持有者名。與
 * `groupGears()` 的 instances 排序同一套語感（先看改修高的、再看用在哪）。
 */
export function stackInstances(instances: OwnedGearView[]): GearStack[] {
    const byKey = new Map<string, GearStack>();
    for (const g of instances) {
        const h = g.holder;
        const key = h ? `${g.level}/${g.alv}/${h.kind}/${h.name}/${h.ex ? 'ex' : ''}` : `${g.level}/${g.alv}/idle`;
        const hit = byKey.get(key);
        if (hit) {
            hit.count++;
            hit.ids.push(g.id);
        } else {
            byKey.set(key, { level: g.level, alv: g.alv, holder: h, count: 1, ids: [g.id] });
        }
    }

    return [...byKey.values()]
        .map(stack => ({ ...stack, ids: [...stack.ids].sort((a, b) => a - b) }))
        .sort((a, b) =>
            b.level - a.level
            || b.alv - a.alv
            || Number(!!b.holder) - Number(!!a.holder)
            || (a.holder?.name ?? '').localeCompare(b.holder?.name ?? ''));
}

// ── 篩選 ────────────────────────────────────────────────────────────────

/** 使用狀態。群組層級判定：**有任一顆**符合即保留（見 filterGears 說明）。 */
export type UsageFilter = 'all' | 'equipped' | 'idle';
/** 改修狀態。同上，群組層級判定。 */
export type ImproveFilter = 'all' | 'none' | 'plus' | 'max';
/** 消耗品（洋上補給・戦闘糧食・応急修理要員…）。它們不佔裝備欄上限，故可獨立開關。 */
export type ConsumableFilter = 'all' | 'hide' | 'only';

export interface GearFilter {
    /** 關鍵字：比對裝備名與類別名（大小寫不敏感）。 */
    search: string;
    /** 圖示 id（api_type[3]）多選；空陣列＝不限。UI 上就是那排裝備圖示。 */
    icons: number[];
    usage: UsageFilter;
    improve: ImproveFilter;
    consumable: ConsumableFilter;
}

export const emptyGearFilter = (): GearFilter => ({
    search: '', icons: [], usage: 'all', improve: 'all', consumable: 'all',
});

/**
 * 篩選。usage／improve 皆為**群組層級**判定：「有任一顆符合就保留整組」。
 *
 * 這是刻意的——本表一列＝一種裝備，把組拆開只留符合的實例會讓「數量」欄與實際持有量
 * 不一致（篩「閒置」時 41cm 顯示 ×1 但其實有 3 顆），那比看到整組更難讀。要看是哪一顆
 * 符合，展開列逐顆顯示 ★ 與持有者。
 */
export function filterGears(groups: GearGroup[], filter: GearFilter): GearGroup[] {
    const search = filter.search.trim().toLowerCase();
    const icons = filter.icons.length ? new Set(filter.icons) : null;

    return groups.filter(g => {
        if (icons && !icons.has(g.icon)) return false;
        if (search && !g.name.toLowerCase().includes(search) && !g.catName.toLowerCase().includes(search)) return false;
        if (filter.usage === 'equipped' && g.equipped === 0) return false;
        if (filter.usage === 'idle' && g.idle === 0) return false;
        if (filter.consumable === 'hide' && g.consumable) return false;
        if (filter.consumable === 'only' && !g.consumable) return false;
        if (filter.improve === 'none' && !g.levels.some(l => l.level === 0)) return false;
        if (filter.improve === 'plus' && g.maxLevel <= 0) return false;
        if (filter.improve === 'max' && g.maxLevel < MAX_IMPROVE) return false;
        return true;
    });
}

// ── 排序 ────────────────────────────────────────────────────────────────

/** 素質欄以外的排序鍵；素質欄直接用 GearStats 的欄位名。 */
export type GearSortKey = 'sortNo' | 'name' | 'count' | 'star' | 'equipped' | 'idle' | keyof GearStats;
export type GearSortDir = 'asc' | 'desc';

const STAT_KEYS: (keyof GearStats)[] =
    ['houg', 'houm', 'leng', 'luck', 'houk', 'baku', 'raig', 'saku', 'tais', 'tyku', 'souk'];

function sortValue(group: GearGroup, key: GearSortKey): number | string {
    switch (key) {
        case 'sortNo': return group.sortNo || group.mst;
        case 'name': return group.name;
        case 'count': return group.count;
        case 'star': return group.maxLevel;
        case 'equipped': return group.equipped;
        case 'idle': return group.idle;
        default: return group.stats[key];
    }
}

/**
 * 排序。同值時一律以圖鑑順（sortNo）收尾，讓「火力都是 0」的一大票裝備維持可預期的排列，
 * 而不是隨 Map 的插入順序跳動。
 */
export function sortGears(groups: GearGroup[], key: GearSortKey, dir: GearSortDir): GearGroup[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...groups].sort((a, b) => {
        const va = sortValue(a, key), vb = sortValue(b, key);
        const cmp = typeof va === 'string' && typeof vb === 'string'
            ? va.localeCompare(vb)
            : Number(va) - Number(vb);
        return cmp * sign || (a.sortNo || a.mst) - (b.sortNo || b.mst);
    });
}

// ── 圖示篩選架 ──────────────────────────────────────────────────────────

export interface IconOption {
    /** api_type[3]，即 public/icons/equipment/<icon>.svg 的檔名。 */
    icon: number;
    /** 該圖示底下的持有總件數。 */
    count: number;
    /** 該圖示底下的裝備種類數。 */
    kinds: number;
    /** 顯示名＝該圖示底下**種類數最多**的裝備類別名（圖示與類別非一對一，取代表值）。 */
    label: string;
}

/**
 * 圖示篩選架的選項。**只列實際持有的圖示**——把 60 顆全排出來會讓「我有什麼」這個
 * 第一眼問題淹沒在一整面沒有的東西裡。順序同圖鑑順（各圖示底下最小的 sortNo）。
 */
export function iconOptions(groups: GearGroup[]): IconOption[] {
    const byIcon = new Map<number, { count: number; kinds: number; order: number; cats: Map<string, number> }>();
    for (const g of groups) {
        let hit = byIcon.get(g.icon);
        if (!hit) {
            hit = { count: 0, kinds: 0, order: g.sortNo || g.mst, cats: new Map() };
            byIcon.set(g.icon, hit);
        }
        hit.count += g.count;
        hit.kinds++;
        hit.order = Math.min(hit.order, g.sortNo || g.mst);
        if (g.catName) hit.cats.set(g.catName, (hit.cats.get(g.catName) ?? 0) + 1);
    }

    return [...byIcon.entries()]
        .map(([icon, v]) => ({
            icon,
            count: v.count,
            kinds: v.kinds,
            label: [...v.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
        }))
        .sort((a, b) => (byIcon.get(a.icon)!.order) - (byIcon.get(b.icon)!.order));
}

/** 篩選結果的合計（摘要列用）。 */
export function totalCount(groups: GearGroup[]): { kinds: number; items: number; equipped: number; idle: number } {
    return {
        kinds: groups.length,
        items: groups.reduce((n, g) => n + g.count, 0),
        equipped: groups.reduce((n, g) => n + g.equipped, 0),
        idle: groups.reduce((n, g) => n + g.idle, 0),
    };
}

export { STAT_KEYS };
