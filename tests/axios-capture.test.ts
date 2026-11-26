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
        expect(reqBody).toBe('');
        expect(readText()).toBe(response.data);
        // 字串回應直接帶出長度，供佇列判斷是否可不等 idle
        expect(enqueue.mock.calls[0][3]).toBe((response.data as string).length);
    });

    it.each([
        'api_token=secret&api_deck_id=1&api_token=other&api_verno=1&%61pi_token=encoded',
        new URLSearchParams({ api_token: 'secret', api_deck_id: '1', api_verno: '1' }),
        { api_token: 'secret', api_deck_id: 1, api_verno: '1' },
        (() => {
            const data = new FormData();
            data.append('api_token', 'secret');
            data.append('api_token', 'other');
            data.append('api_deck_id', '1');
            data.append('api_verno', '1');
            return data;
        })(),
    ])('入列前移除憑證，保留操作參數與原請求內容（%#）', (data) => {
        const mock = mockAxios();
        const enqueue = vi.fn();
        attachAxiosResponseCapture(mock.axios, enqueue);
        const original = serializeAxiosRequestBody(data);
        const response: AxiosResponseLike = {
            data: 'svdata={"api_data":{}}',
            config: { url: '/kcsapi/api_port/port', data },
        };

        expect(mock.handler(response)).toBe(response);
        expect(enqueue.mock.calls[0][1]).toBe('api_deck_id=1');
        expect(response.config?.data).toBe(data);
        expect(serializeAxiosRequestBody(data)).toBe(original);
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

describe('attachAxiosResponseCapture：地圖資源', () => {
    const INFO = { spots: [{ no: 1, x: 10, y: 20 }], labels: [] };

    it('_info*.json 交出 map／part 與文字，不經 kcsapi 佇列，回應原封交還', () => {
        const mock = mockAxios();
        const enqueue = vi.fn();
        const onMap = vi.fn();
        attachAxiosResponseCapture(mock.axios, enqueue, undefined, onMap);
        const config = { url: 'https://w00g.kancolle-server.com/kcs2/resources/map/062/01_info18.json?version=5' };
        const response: AxiosResponseLike = { data: INFO, config };
        expect(mock.handler(response)).toBe(response);
        expect(response.data).toBe(INFO);
        expect(response.config).toBe(config);
        expect(enqueue).not.toHaveBeenCalled();
        expect(onMap).toHaveBeenCalledTimes(1);
        const [resource, readText] = onMap.mock.calls[0];
        expect(resource).toEqual({ map: '62-1', part: 18 });
        expect(JSON.parse(readText())).toEqual(INFO);
    });

    it('字串回應原樣交出；基本檔與 baseURL + 相對 url 都認得', () => {
        const mock = mockAxios();
        const onMap = vi.fn();
        attachAxiosResponseCapture(mock.axios, vi.fn(), undefined, onMap);
        mock.handler({
            data: '{"spots":[]}',
            config: { baseURL: 'https://w00g.kancolle-server.com/', url: 'kcs2/resources/map/001/01_info.json' },
        });
        expect(onMap.mock.calls[0][0]).toEqual({ map: '1-1', part: null });
        expect(onMap.mock.calls[0][1]()).toBe('{"spots":[]}');
    });

    it('沒有 baseURL 的相對 url 依遊戲頁網址補全（遊戲 path_root 預設為空字串）', () => {
        vi.stubGlobal('location', { href: 'https://w08r.kancolle-server.com/kcs2/index.php?api_root=/kcsapi' });
        try {
            const mock = mockAxios();
            const enqueue = vi.fn();
            const onMap = vi.fn();
            attachAxiosResponseCapture(mock.axios, enqueue, undefined, onMap);
            mock.handler({ data: INFO, config: { url: 'resources/map/001/01_info.json' } });
            expect(onMap.mock.calls[0][0]).toEqual({ map: '1-1', part: null });
            mock.handler({ data: 'svdata={}', config: { url: '/kcsapi/api_port/port' } });
            expect(enqueue.mock.calls[0][0]).toBe('api_port/port');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it.each([
        'https://w00g.kancolle-server.com/kcs2/resources/map/062/01_image.json',
        'https://w00g.kancolle-server.com/kcs2/resources/map/062/01_image.png',
        'https://w00g.kancolle-server.com/kcs2/resources/map/062/01.png',
        'https://w00g.kancolle-server.com/kcs2/img/foo.png',
    ])('其他網址不送（%s）', (url) => {
        const mock = mockAxios();
        const enqueue = vi.fn();
        const onMap = vi.fn();
        attachAxiosResponseCapture(mock.axios, enqueue, undefined, onMap);
        mock.handler({ data: '{}', config: { url } });
        expect(onMap).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('kcsapi 照舊入列，不交給地圖資源回呼', () => {
        const mock = mockAxios();
        const enqueue = vi.fn();
        const onMap = vi.fn();
        attachAxiosResponseCapture(mock.axios, enqueue, undefined, onMap);
        mock.handler({ data: 'svdata={}', config: { url: '/kcsapi/api_port/port' } });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(onMap).not.toHaveBeenCalled();
    });

    it('回呼失敗仍回傳原 response', () => {
        const mock = mockAxios();
        const onError = vi.fn();
        attachAxiosResponseCapture(mock.axios, vi.fn(), onError, () => { throw new Error('send'); });
        const response: AxiosResponseLike = { data: INFO, config: { url: '/kcs2/resources/map/062/01_info.json' } };
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
