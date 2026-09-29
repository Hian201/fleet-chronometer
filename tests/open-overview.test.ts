import { describe, expect, it } from 'vitest';
import { openOverviewAt, type OverviewTabsApi } from '../utils/open-overview';

const BASE = 'chrome-extension://abc/overview.html';

function fakeApi(tabs: { id?: number; url?: string; windowId?: number }[]) {
    const calls: unknown[][] = [];
    const api: OverviewTabsApi = {
        runtime: { getURL: () => BASE },
        tabs: {
            query: async () => tabs,
            create: async props => { calls.push(['create', props]); },
            update: async (id, props) => { calls.push(['update', id, props]); },
        },
        windows: { update: async (id, props) => { calls.push(['focus', id, props]); } },
    };
    return { api, calls };
}

describe('openOverviewAt', () => {
    it('已有情報總括分頁時改寫它的 hash、切過去並聚焦視窗，不另開新分頁', async () => {
        const { api, calls } = fakeApi([
            { id: 1, url: 'https://example.com/', windowId: 9 },
            { id: 2, url: `${BASE}#/sortie-log`, windowId: 7 },
        ]);
        await openOverviewAt(api, '/quest-flow?no=1047&tab=progress');
        expect(calls).toEqual([
            ['update', 2, { url: `${BASE}#/quest-flow?no=1047&tab=progress`, active: true }],
            ['focus', 7, { focused: true }],
        ]);
    });

    it('沒有 hash 的情報總括分頁也算既有分頁', async () => {
        const { api, calls } = fakeApi([{ id: 3, url: BASE, windowId: 1 }]);
        await openOverviewAt(api, '/quest-flow');
        expect(calls[0]).toEqual(['update', 3, { url: `${BASE}#/quest-flow`, active: true }]);
    });

    it('沒有情報總括分頁時另開新分頁；同名前綴的其他頁面不算', async () => {
        const { api, calls } = fakeApi([{ id: 4, url: `${BASE}.bak`, windowId: 1 }]);
        await openOverviewAt(api, '/quest-flow?no=1');
        expect(calls).toEqual([['create', { url: `${BASE}#/quest-flow?no=1` }]]);
    });
});
