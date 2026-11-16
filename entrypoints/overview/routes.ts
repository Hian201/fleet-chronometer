// 情報總括的 hash 路由（#/<sectionId>?key=value）。純字串處理；normalizeHash 才碰 location／history。
//
// 分區合併後舊網址不能壞：分區用 redirects 宣告「舊分區 id → 新分區的 hash 參數」，
// 例：工廠分區 { 'build-log': 'sub=build' }，#/build-log 就轉成 #/factory?sub=build。
export interface RouteSection {
    id: string;
    redirects?: Readonly<Record<string, string>>;
}

export interface Route {
    /** 實際要顯示的分區 id（未知 hash 退回第一個分區） */
    id: string;
    /** 需要改寫成的標準 hash（含 #）；已是標準或未知 hash 時為 null */
    canonical: string | null;
}

export function resolveRoute(hash: string, sections: readonly RouteSection[]): Route {
    const raw = hash.replace(/^#\/?/, '');
    const index = raw.indexOf('?');
    const id = index < 0 ? raw : raw.slice(0, index);
    if (sections.some(section => section.id === id)) return { id, canonical: null };
    for (const section of sections) {
        const redirect = section.redirects?.[id];
        if (redirect === undefined) continue;
        // 舊網址自帶的參數保留；redirect 的參數優先（它指定的是子頁）
        const params = new URLSearchParams(index < 0 ? '' : raw.slice(index + 1));
        for (const [key, value] of new URLSearchParams(redirect)) params.set(key, value);
        return { id: section.id, canonical: `#/${section.id}?${params}` };
    }
    return { id: sections[0].id, canonical: null };
}

/** 舊 hash 改寫成標準 hash（replaceState，不產生歷史紀錄、不觸發 hashchange）。回傳目前要顯示的分區 id。 */
export function normalizeHash(sections: readonly RouteSection[]): string {
    const route = resolveRoute(location.hash, sections);
    if (route.canonical) history.replaceState(null, '', `${location.pathname}${location.search}${route.canonical}`);
    return route.id;
}
