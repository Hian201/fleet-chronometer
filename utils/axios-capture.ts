import {
    getKcsapiPath,
    SENSITIVE_REQUEST_KEYS,
    serializeAxiosRequestBody,
    serializeAxiosResponseText,
} from './kcsapi';
import { parseMapResourceUrl } from './map-resource';

export interface AxiosResponseLike {
    data: unknown;
    config?: {
        url?: string;
        baseURL?: string;
        data?: unknown;
    };
}

// 相對網址依 baseURL 補全；沒有 baseURL 時依遊戲頁網址補全，與瀏覽器送出請求時的解析相同。
// 遊戲的 path_root 預設為空字串（main.js SettingsModel），地圖資源因此以
// `resources/map/...` 相對 `/kcs2/index.php` 送出，不補全就看不出它在 `/kcs2/` 底下。
function axiosRequestUrl(config: AxiosResponseLike['config']): string | undefined {
    const url = config?.url;
    if (typeof url !== 'string' || !url) return undefined;
    const base = config?.baseURL || globalThis.location?.href;
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

/** 地圖資源回應轉成文字：axios 多半已把 JSON 解析成物件。 */
function serializeMapResourceText(data: unknown): string {
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') return JSON.stringify(data);
    throw new Error('地圖資源回應無法序列化');
}

/**
 * 在 axios 回應鏈觀察 kcsapi，不修改、不拒絕、不重放。
 * 讀取與跨 world 傳輸交給呼叫端的 idle queue，避免在 interceptor 同步路徑 materialize 大字串。
 * 另認遊戲自己以 axios.get 讀的地圖資源 `_info*.json`（utils/map-resource.ts）：只交出 map／part
 * 與延後讀取的文字，不交出完整網址；這條旁路不經 kcsapi 的佇列與擷取健康度。
 */
export function attachAxiosResponseCapture(
    axios: AxiosLike,
    enqueue: (path: string, reqBody: string, readText: () => string, sizeHint?: number) => void,
    onError?: (path: string | undefined, error: unknown) => void,
    onMapResource?: (resource: { map: string; part: number | null }, readText: () => string) => void,
): void {
    axios.interceptors.response.use((response) => {
        try {
            const url = axiosRequestUrl(response?.config);
            const path = url ? getKcsapiPath(url) : null;
            if (!path) {
                const resource = url && onMapResource ? parseMapResourceUrl(url) : null;
                if (resource && onMapResource) {
                    const payload = response.data;
                    onMapResource(resource, () => serializeMapResourceText(payload));
                }
                return response;
            }
            // 頁面訊息不是私密通道；憑證須在進入觀察佇列前移除，且不可修改遊戲的 config.data。
            const req = new URLSearchParams(serializeAxiosRequestBody(response.config?.data));
            for (const key of SENSITIVE_REQUEST_KEYS) req.delete(key);
            const reqBody = req.toString();
            const payload = response.data;
            // 字串回應的長度不需序列化就知道；物件回應大小未知，交給佇列走保守路徑。
            const sizeHint = typeof payload === 'string' ? payload.length : undefined;
            enqueue(path, reqBody, () => {
                const text = serializeAxiosResponseText(payload);
                if (text == null) throw new Error('axios response 無法序列化');
                return text;
            }, sizeHint);
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
