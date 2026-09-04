import {
    getKcsapiPath,
    serializeAxiosRequestBody,
    serializeAxiosResponseText,
} from './kcsapi';

export interface AxiosResponseLike {
    data: unknown;
    config?: {
        url?: string;
        baseURL?: string;
        data?: unknown;
    };
}

function axiosRequestUrl(config: AxiosResponseLike['config']): string | undefined {
    const url = config?.url;
    if (typeof url !== 'string' || !url) return undefined;
    const base = config?.baseURL;
    if (typeof base === 'string' && base && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        try { return new URL(url, base).href; } catch { return url; }
    }
    return url;
}

export interface AxiosLike {
    interceptors: {
        response: {
            use(onFulfilled: (response: AxiosResponseLike) => unknown): unknown;
        };
    };
}

export function isAxiosLike(value: unknown): value is AxiosLike {
    return typeof (value as AxiosLike | undefined)?.interceptors?.response?.use === 'function';
}

/**
 * 在 axios 回應鏈觀察 kcsapi，不修改、不拒絕、不重放。
 * 讀取與跨 world 傳輸交給呼叫端的 idle queue，避免在 interceptor 同步路徑 materialize 大字串。
 */
export function attachAxiosResponseCapture(
    axios: AxiosLike,
    enqueue: (path: string, reqBody: string, readText: () => string) => void,
    onError?: (path: string | undefined, error: unknown) => void,
): void {
    axios.interceptors.response.use((response) => {
        try {
            const url = axiosRequestUrl(response?.config);
            const path = url ? getKcsapiPath(url) : null;
            if (!path) return response;
            const reqBody = serializeAxiosRequestBody(response.config?.data);
            const payload = response.data;
            enqueue(path, reqBody, () => {
                const text = serializeAxiosResponseText(payload);
                if (text == null) throw new Error('axios response 無法序列化');
                return text;
            });
        } catch (error) {
            onError?.(response?.config?.url, error);
        }
        return response;
    });
}

/** 遊戲把 axios 掛上 window 之後才找得到；出現前不碰原生 fetch／XHR。 */
export function waitForAxios(
    getAxios: () => unknown,
    onFound: (axios: AxiosLike) => void,
    schedule: (callback: () => void, delayMs: number) => void,
    intervalMs = 250,
): void {
    const tick = () => {
        const axios = getAxios();
        if (isAxiosLike(axios)) {
            onFound(axios);
            return;
        }
        schedule(tick, intervalMs);
    };
    tick();
}
