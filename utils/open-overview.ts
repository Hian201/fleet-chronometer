// 從面板開啟情報總括的某個位置。已有情報總括分頁時改寫它的 hash 並切過去：只改 hash 不會
// 重新載入頁面，總括以 hashchange 重繪分區；沒有才另開新分頁。以參數注入瀏覽器 API，方便測試。

export interface OverviewTabsApi {
    runtime: { getURL(path: '/overview.html'): string };
    tabs: {
        query(info: Record<string, never>): Promise<{ id?: number; url?: string; windowId?: number }[]>;
        create(props: { url: string }): Promise<unknown>;
        update(tabId: number, props: { url: string; active: boolean }): Promise<unknown>;
    };
    windows: { update(windowId: number, props: { focused: boolean }): Promise<unknown> };
}

/** hash 不含開頭的 #，例：/quest-flow?no=1047&tab=progress。 */
export async function openOverviewAt(api: OverviewTabsApi, hash: string): Promise<void> {
    const base = api.runtime.getURL('/overview.html');
    const url = `${base}#${hash}`;
    const tabs = await api.tabs.query({});
    const existing = tabs.find(tab => tab.id !== undefined && (tab.url === base || tab.url?.startsWith(`${base}#`)));
    if (existing?.id === undefined) {
        await api.tabs.create({ url });
        return;
    }
    await api.tabs.update(existing.id, { url, active: true });
    if (existing.windowId !== undefined) await api.windows.update(existing.windowId, { focused: true });
}
