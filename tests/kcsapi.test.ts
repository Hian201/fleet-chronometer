import { describe, expect, it, vi } from 'vitest';
import {
    getKcsapiPath,
    parseKcsapiResponse,
    readFetchRequestBody,
    readRequestBody,
    serializeRequestBody,
} from '../utils/kcsapi';

describe('艦隊 Collection API path 判斷', () => {
    it('正確辨識完整 API URL 與 path', () => {
        expect(getKcsapiPath('https://203.104.209.7/kcsapi/api_port/port')).toBe('api_port/port');
        expect(getKcsapiPath('/kcsapi/api_req_map/start?api_maparea_id=1')).toBe('api_req_map/start');
    });

    it('不將非相關 URL 視為遊戲 API', () => {
        expect(getKcsapiPath('https://example.test/assets/kcsapi/api_port/port')).toBeNull();
        expect(getKcsapiPath('https://example.test/api_port/port')).toBeNull();
    });
});

describe('kcsapi response 還原', () => {
    it('移除 svdata 前綴並取出 api_data', () => {
        expect(parseKcsapiResponse('svdata={"api_result":1,"api_data":{"marker":"data"}}'))
            .toEqual({ marker: 'data' });
    });

    it('沒有 api_data 時保留完整 response 物件', () => {
        expect(parseKcsapiResponse('{"api_result":1,"marker":"fallback"}'))
            .toEqual({ api_result: 1, marker: 'fallback' });
    });
});

describe('fetch request body 擷取', () => {
    it('讀取字串格式的 RequestInit.body', async () => {
        await expect(readFetchRequestBody('https://example.test', { body: 'api_deck_id=1' }))
            .resolves.toBe('api_deck_id=1');
    });

    it('讀取 URLSearchParams 格式的 RequestInit.body', async () => {
        const body = new URLSearchParams({ api_deck_id: '1', api_token: 'secret' });
        await expect(readFetchRequestBody('https://example.test', { body }))
            .resolves.toBe('api_deck_id=1&api_token=secret');
    });

    it('讀取 Request 物件本身的 body 而不消耗原物件', async () => {
        const request = new Request('https://example.test', { method: 'POST', body: 'api_deck_id=1' });
        await expect(readFetchRequestBody(request)).resolves.toBe('api_deck_id=1');
        await expect(request.text()).resolves.toBe('api_deck_id=1');
    });

    it('優先使用 RequestInit.body，而非 Request 本身的 body', async () => {
        const request = new Request('https://example.test', { method: 'POST', body: 'from-request=1' });
        await expect(readFetchRequestBody(request, { body: 'from-init=1' })).resolves.toBe('from-init=1');
    });

    it('未提供 body 時安全回傳空字串', async () => {
        await expect(readFetchRequestBody('https://example.test')).resolves.toBe('');
    });

    it('不支援的 body 類型安全回傳空字串', () => {
        expect(serializeRequestBody(new Blob(['unsupported']))).toBe('');
    });

    it('body 無法讀取時安全回傳空字串', async () => {
        const unreadable = {
            clone: () => ({ text: async () => { throw new Error('無法讀取'); } }),
        } as unknown as Request;
        await expect(readRequestBody(unreadable)).resolves.toBe('');
    });

    it('body 讀取失敗不會影響原始 fetch', async () => {
        const unreadable = {
            clone: vi.fn(() => { throw new Error('無法 clone'); }),
        } as unknown as Request;
        const originalFetch = vi.fn().mockResolvedValue(new Response('ok'));

        const body = readRequestBody(unreadable);
        const response = originalFetch(unreadable);

        await expect(body).resolves.toBe('');
        await expect(response).resolves.toBeInstanceOf(Response);
        expect(originalFetch).toHaveBeenCalledWith(unreadable);
    });
});
