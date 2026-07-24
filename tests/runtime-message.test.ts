import { describe, expect, it, vi } from 'vitest';
import {
    createKcApiRuntimeMessage,
    sendKcApiRuntimeMessageWithRetry,
} from '../utils/runtime-message';

describe('kcsapi runtime message', () => {
    it('第一次送出失敗後以完全相同的 envelope 重試一次', async () => {
        const createUuid = vi.fn(() => 'capture-1');
        const now = vi.fn(() => 1_726_000_000_000);
        const apiText = 'svdata={"api_result":1}';
        const req = { api_deck_id: '1' };
        const message = createKcApiRuntimeMessage(
            { path: 'api_req_map/start', req, apiText },
            { createUuid, now },
        );
        const send = vi.fn()
            .mockRejectedValueOnce(new Error('service worker 尚未就緒'))
            .mockResolvedValueOnce(undefined);
        const retryDelay = vi.fn().mockResolvedValue(undefined);

        await expect(sendKcApiRuntimeMessageWithRetry(message, { send, retryDelay })).resolves.toBeUndefined();

        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0][0]).toBe(send.mock.calls[1][0]);
        expect(send.mock.calls[0][0]).toMatchObject({
            type: 'kc:api',
            captureId: 'capture-1',
            ts: 1_726_000_000_000,
            path: 'api_req_map/start',
            req: { api_deck_id: '1' },
            apiText: 'svdata={"api_result":1}',
        });
        expect(createUuid).toHaveBeenCalledTimes(1);
        expect(now).toHaveBeenCalledTimes(1);
        expect(retryDelay).toHaveBeenCalledTimes(1);
    });

    it('不同 page message 各自取得新的 captureId', () => {
        const createUuid = vi.fn()
            .mockReturnValueOnce('capture-1')
            .mockReturnValueOnce('capture-2');
        const now = vi.fn(() => 1_726_000_000_000);
        const dependencies = { createUuid, now };

        const first = createKcApiRuntimeMessage(
            { path: 'api_port/port', req: {}, apiText: 'svdata={}' },
            dependencies,
        );
        const second = createKcApiRuntimeMessage(
            { path: 'api_get_member/mission', req: {}, apiText: 'svdata={}' },
            dependencies,
        );

        expect(first.captureId).toBe('capture-1');
        expect(second.captureId).toBe('capture-2');
        expect(createUuid).toHaveBeenCalledTimes(2);
    });

    it('第一次送出成功時不等待 retry delay', async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const retryDelay = vi.fn().mockResolvedValue(undefined);
        const message = createKcApiRuntimeMessage(
            { path: 'api_port/port', req: {}, apiText: 'svdata={}' },
            { createUuid: () => 'capture-1', now: () => 1 },
        );

        await sendKcApiRuntimeMessageWithRetry(message, { send, retryDelay });

        expect(send).toHaveBeenCalledTimes(1);
        expect(retryDelay).not.toHaveBeenCalled();
    });

    it('完成清理後的 runtime message 不含 token 與 api_verno', () => {
        const req = Object.fromEntries(new URLSearchParams(
            'api_deck_id=1&api_token=secret&api_verno=1',
        ));
        delete req.api_token;
        delete req.api_verno;

        const message = createKcApiRuntimeMessage(
            { path: 'api_req_map/start', req, apiText: 'svdata={}' },
            { createUuid: () => 'capture-1', now: () => 1 },
        );

        expect(message).toEqual({
            type: 'kc:api',
            captureId: 'capture-1',
            ts: 1,
            path: 'api_req_map/start',
            req: { api_deck_id: '1' },
            apiText: 'svdata={}',
        });
    });
});
