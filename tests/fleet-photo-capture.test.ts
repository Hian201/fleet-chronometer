import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetPhotoCapture, type FleetPhotoPort } from '../utils/fleet-photo-capture';
import { PHOTO_REGIONS } from '../utils/fleet-photo';
import type { GameFrameReply, GameFrameRequest } from '../utils/game-page';

function frame(tabId: number) {
    let onMessage!: (reply: GameFrameReply) => void;
    let onDisconnect!: () => void;
    const postMessage = vi.fn<(message: GameFrameRequest) => void>();
    const port: FleetPhotoPort = {
        sender: { tab: { id: tabId } }, postMessage,
        onMessage: { addListener: fn => { onMessage = fn; } },
        onDisconnect: { addListener: fn => { onDisconnect = fn; } },
    };
    return { port, postMessage, reply: (reply: GameFrameReply) => onMessage(reply), disconnect: () => onDisconnect() };
}

afterEach(() => vi.useRealTimers());

describe('編成寫真來源分頁', () => {
    it('多分頁未選來源時不發送任何擷取請求', async () => {
        const capture = new FleetPhotoCapture();
        const a = frame(1), b = frame(2);
        capture.connect(a.port); capture.connect(b.port);
        expect(await capture.capture(PHOTO_REGIONS.ship)).toEqual({ error: 'choose-source' });
        expect(a.postMessage).not.toHaveBeenCalled(); expect(b.postMessage).not.toHaveBeenCalled();
    });
    it('只發給所選分頁的框，並拒絕其他分頁搶答相同 reqId', async () => {
        const capture = new FleetPhotoCapture();
        const a = frame(1), b = frame(2), sibling = frame(2);
        [a, b, sibling].forEach(f => capture.connect(f.port));
        const result = capture.capture(PHOTO_REGIONS.ship, 2);
        expect(a.postMessage).not.toHaveBeenCalled();
        const reqId = b.postMessage.mock.calls[0][0].reqId;
        a.reply({ kind: 'capture-result', reqId, dataUrl: 'wrong-tab' });
        sibling.reply({ kind: 'capture-result', reqId, dataUrl: 'wrong-frame' });
        b.reply({ kind: 'capture-result', reqId, dataUrl: 'selected-tab' });
        expect(await result).toEqual({ dataUrl: 'selected-tab' });
    });
    it('唯一分頁自動選取，同分頁多框仍能找到有畫布的框', async () => {
        const capture = new FleetPhotoCapture();
        const a = frame(1), b = frame(1);
        capture.connect(a.port); capture.connect(b.port);
        expect(capture.tabIds()).toEqual([1]);
        const result = capture.capture(PHOTO_REGIONS.lbas);
        a.reply({ kind: 'capture-result', reqId: a.postMessage.mock.calls[0][0].reqId, error: 'no-canvas' });
        b.reply({ kind: 'capture-result', reqId: b.postMessage.mock.calls[0][0].reqId, dataUrl: 'base' });
        expect(await result).toEqual({ dataUrl: 'base' });
    });
    it('所選分頁斷線後不改拍另一個分頁', async () => {
        const capture = new FleetPhotoCapture();
        const a = frame(1), b = frame(2);
        capture.connect(a.port); capture.connect(b.port); a.disconnect();
        expect(await capture.capture(PHOTO_REGIONS.ship, 1)).toEqual({ error: 'no-game' });
        expect(b.postMessage).not.toHaveBeenCalled();
    });
    it('無回應有 timeout，遲到回應不會污染下一筆', async () => {
        vi.useFakeTimers();
        const capture = new FleetPhotoCapture(), a = frame(1);
        capture.connect(a.port);
        const first = capture.capture(PHOTO_REGIONS.ship);
        const reqId = a.postMessage.mock.calls[0][0].reqId;
        await vi.advanceTimersByTimeAsync(4000);
        expect(await first).toEqual({ error: 'timeout' });
        const second = capture.capture(PHOTO_REGIONS.ship);
        a.reply({ kind: 'capture-result', reqId, dataUrl: 'late' });
        a.reply({ kind: 'capture-result', reqId: a.postMessage.mock.calls[1][0].reqId, dataUrl: 'new' });
        expect(await second).toEqual({ dataUrl: 'new' });
    });
});
