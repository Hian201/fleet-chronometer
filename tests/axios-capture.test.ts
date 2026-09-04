import { describe, expect, it, vi } from 'vitest';
import {
    attachAxiosResponseCapture,
    isAxiosLike,
    waitForAxios,
    type AxiosLike,
    type AxiosResponseLike,
} from '../utils/axios-capture';
import {
    parseKcsapiResponse,
    serializeAxiosRequestBody,
    serializeAxiosResponseText,
} from '../utils/kcsapi';

function mockAxios(): { axios: AxiosLike; handler: (response: AxiosResponseLike) => unknown } {
    let handler: ((response: AxiosResponseLike) => unknown) | undefined;
    const axios: AxiosLike = {
        interceptors: {
            response: {
                use(onFulfilled) {
                    handler = onFulfilled;
                    return 0;
                },
            },
        },
    };
    return {
        axios,
        get handler() {
            if (!handler) throw new Error('interceptor 尚未註冊');
            return handler;
        },
    };
}

describe('axios 請求／回應序列化', () => {
    it('表單字串與 URLSearchParams 原樣或等價輸出', () => {
        expect(serializeAxiosRequestBody('api_deck_id=1')).toBe('api_deck_id=1');
        expect(serializeAxiosRequestBody(new URLSearchParams({ api_deck_id: '1' })))
            .toBe('api_deck_id=1');
        expect(serializeAxiosRequestBody({ api_deck_id: 1, api_mission_id: '2' }))
            .toBe('api_deck_id=1&api_mission_id=2');
    });

    it('巢狀物件與空值不猜成表單欄位', () => {
        expect(serializeAxiosRequestBody({ api_id: '1', nested: { a: 1 } })).toBe('api_id=1');
        expect(serializeAxiosRequestBody(null)).toBe('');
        expect(serializeAxiosRequestBody(undefined)).toBe('');
    });

    it('字串回應原樣交給 parseKcsapiResponse', () => {
        const text = 'svdata={"api_result":1,"api_data":{"n":9}}';
        expect(serializeAxiosResponseText(text)).toBe(text);
        expect(parseKcsapiResponse(text)).toEqual({ n: 9 });
    });

    it('已 parse 的物件補 svdata 前綴後仍能取出 api_data', () => {
        const text = serializeAxiosResponseText({ api_result: 1, api_data: { api_max_num: 9 } });
        expect(text).toBe('svdata={"api_result":1,"api_data":{"api_max_num":9}}');
        expect(parseKcsapiResponse(text!)).toEqual({ api_max_num: 9 });
    });

    it('無法序列化的型別回 null', () => {
        expect(serializeAxiosResponseText(1)).toBeNull();
        expect(serializeAxiosResponseText(undefined)).toBeNull();
    });
});

describe('attachAxiosResponseCapture', () => {
    it('只入列 kcsapi，且不改動回應物件', () => {
        const mock = mockAxios();
        const enqueue = vi.fn();
        attachAxiosResponseCapture(mock.axios, enqueue);
        const response: AxiosResponseLike = {
            data: 'svdata={"api_result":1,"api_data":{}}',
            config: {
                url: 'https://w00g.kancolle-server.com/kcsapi/api_port/port',
                data: 'api_verno=1',
            },
        };
        expect(mock.handler(response)).toBe(response);
        expect(enqueue).toHaveBeenCalledTimes(1);
        const [path, reqBody, readText] = enqueue.mock.calls[0];
        expect(path).toBe('api_port/port');
        expect(reqBody).toBe('api_verno=1');
        expect(readText()).toBe(response.data);
    });

    it('非 kcsapi 不入列', () => {
        const mock = mockAxios();
        const enqueue = vi.fn();
        attachAxiosResponseCapture(mock.axios, enqueue);
        mock.handler({
            data: 'ok',
            config: { url: 'https://w00g.kancolle-server.com/kcs2/img/foo.png' },
        });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('baseURL + 相對 url 仍能辨識 kcsapi', () => {
        const mock = mockAxios();
        const enqueue = vi.fn();
        attachAxiosResponseCapture(mock.axios, enqueue);
        mock.handler({
            data: 'svdata={}',
            config: {
                baseURL: 'https://w00g.kancolle-server.com/',
                url: 'kcsapi/api_get_member/ndock',
            },
        });
        expect(enqueue.mock.calls[0][0]).toBe('api_get_member/ndock');
    });

    it('enqueue 失敗仍回傳原 response，不讓遊戲請求失敗', () => {
        const mock = mockAxios();
        const onError = vi.fn();
        attachAxiosResponseCapture(mock.axios, () => { throw new Error('queue'); }, onError);
        const response: AxiosResponseLike = {
            data: 'svdata={}',
            config: { url: '/kcsapi/api_port/port' },
        };
        expect(mock.handler(response)).toBe(response);
        expect(onError).toHaveBeenCalled();
    });
});

describe('waitForAxios', () => {
    it('辨識有 response interceptor 的物件', () => {
        expect(isAxiosLike(undefined)).toBe(false);
        expect(isAxiosLike({})).toBe(false);
        expect(isAxiosLike(mockAxios().axios)).toBe(true);
    });

    it('axios 尚未掛上時繼續排程，出現後只 attach 一次', () => {
        let axios: AxiosLike | undefined;
        const scheduled: Array<() => void> = [];
        const onFound = vi.fn();
        waitForAxios(
            () => axios,
            onFound,
            (callback) => { scheduled.push(callback); },
            10,
        );
        expect(onFound).not.toHaveBeenCalled();
        expect(scheduled).toHaveLength(1);
        axios = mockAxios().axios;
        scheduled[0]();
        expect(onFound).toHaveBeenCalledTimes(1);
        expect(onFound).toHaveBeenCalledWith(axios);
        expect(scheduled).toHaveLength(1);
    });
});
