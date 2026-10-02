import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountFleetPhoto, type PhotoTarget } from '../entrypoints/panel/fleet-photo';
import { MSG_FLEET_PHOTO_CAPTURE, MSG_FLEET_PHOTO_SOURCES, type FleetPhotoCaptureReply } from '../utils/game-page';
import type { GameState } from '../utils/state';
import { setLang, t } from '../utils/ui-i18n';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { vi.unstubAllGlobals(); setLang('zh-TW'); });

async function setup() {
    const { document, window } = parseHTML('<html><body><div id="tray"></div></body></html>');
    vi.stubGlobal('HTMLInputElement', window.HTMLInputElement);
    let resolveCapture!: (reply: FleetPhotoCaptureReply) => void;
    const sendMessage = vi.fn(message => message.type === MSG_FLEET_PHOTO_SOURCES
        ? Promise.resolve([{ tabId: 1, title: 'A' }, { tabId: 2, title: 'B' }])
        : new Promise<FleetPhotoCaptureReply>(resolve => { resolveCapture = resolve; }));
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    let target: PhotoTarget = { kind: 'fleet', deck: 0 };
    const ships = [{ id: 1, mst: 1, name: 'A', lv: 1, gears: [{ mst: 9, level: 0 }], exGear: null }];
    const state = { fleets: () => [{ ships }, { ships }], combinedFlag: 0 } as unknown as GameState;
    const root = document.getElementById('tray')! as unknown as HTMLElement;
    const panel = mountFleetPhoto({ root, state, target: () => target, cn: () => 1, onOpenChange: () => {} });
    panel.setOpen(true);
    await flush();
    return { panel, root, ships, sendMessage, resolve: (reply: FleetPhotoCaptureReply) => resolveCapture(reply),
        changeTarget: (next: PhotoTarget) => { target = next; panel.refresh(); }, window };
}

describe('拍攝期間的編成核對', () => {
    it.each(['ship', 'gear'])('拍攝中換船／裝備（%s）捨棄結果且不前進', async kind => {
        const x = await setup();
        x.panel.shoot();
        if (kind === 'ship') x.ships[0].id = 2;
        else x.ships[0].gears[0].mst = 10;
        x.resolve({ dataUrl: 'data:image/png;base64,AAAA' }); await flush();
        expect(x.root.querySelector('img')).toBeNull();
        expect(x.root.querySelector('.ph-count')!.textContent).toBe('0/1');
        expect(x.root.querySelector('.ph-hint')!.textContent).toBe(t('photo.err.changed'));
        expect(x.root.querySelector('.ph-cell')!.classList.contains('next')).toBe(true);
    });
    it('編成不變才保存照片', async () => {
        const x = await setup(); x.panel.shoot();
        x.resolve({ dataUrl: 'data:image/png;base64,AAAA' }); await flush();
        expect(x.root.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
        expect(x.root.querySelector('.ph-count')!.textContent).toBe('1/1');
    });
    it('切換艦隊再切回，也不能接受先前拍攝的結果', async () => {
        const x = await setup(); x.panel.shoot();
        x.changeTarget({ kind: 'fleet', deck: 1 }); x.changeTarget({ kind: 'fleet', deck: 0 });
        x.resolve({ dataUrl: 'data:image/png;base64,AAAA' }); await flush();
        expect(x.root.querySelector('img')).toBeNull();
    });
    it('拍攝中變更來源時捨棄結果', async () => {
        const x = await setup(); x.panel.shoot();
        const select = x.root.querySelector('[data-opt="source"]')! as unknown as HTMLSelectElement;
        select.querySelectorAll('option').forEach(option => { option.selected = option.value === '2'; });
        select.dispatchEvent(new x.window.Event('change', { bubbles: true }));
        x.resolve({ dataUrl: 'data:image/png;base64,AAAA' }); await flush();
        expect(x.root.querySelector('img')).toBeNull();
    });
    it('未選來源的提示會展開含來源清單的設定', async () => {
        const x = await setup(); x.panel.shoot();
        x.resolve({ error: 'choose-source' }); await flush();
        expect(x.root.querySelector('details')!.hasAttribute('open')).toBe(true);
        expect(x.root.querySelector('.ph-hint')!.textContent).toBe(t('photo.err.choose-source'));
        expect(x.root.querySelectorAll('[data-opt="source"] option')).toHaveLength(3);
    });
    it('使用者選的分頁 id 隨擷取請求送出', async () => {
        const x = await setup();
        const select = x.root.querySelector('[data-opt="source"]')! as unknown as HTMLSelectElement;
        select.querySelectorAll('option').forEach(option => { option.selected = option.value === '2'; }); select.dispatchEvent(new x.window.Event('change', { bubbles: true }));
        x.panel.shoot();
        expect(x.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: MSG_FLEET_PHOTO_CAPTURE, tabId: 2 }));
        x.resolve({ error: 'blank' }); await flush();
    });
});
