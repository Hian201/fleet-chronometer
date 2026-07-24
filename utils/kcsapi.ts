const KCSAPI_PREFIX = '/kcsapi/';

/**
 * 將 kcsapi 原始 response text 還原成下游合約所需的 api_data。
 * response 的 `svdata=` 前綴與 api_data 外層只在此傳輸邊界處理；失敗由呼叫端決定如何記錄。
 */
export function parseKcsapiResponse(text: string): unknown {
    const data = JSON.parse(text.replace(/^svdata=/, ''));
    return data.api_data ?? data;
}

/** 從完整 URL 或 path 取出已去除 /kcsapi/ 前綴的 API path。 */
export function getKcsapiPath(urlOrPath: string): string | null {
    try {
        const pathname = new URL(urlOrPath, 'https://kcsapi.invalid').pathname;
        if (!pathname.startsWith(KCSAPI_PREFIX)) return null;
        return pathname.slice(KCSAPI_PREFIX.length) || null;
    } catch {
        return null;
    }
}

/** 僅序列化 bridge 能安全解析的表單 body 類型。 */
export function serializeRequestBody(body: BodyInit | null | undefined): string {
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    return '';
}

/** 讀取 Request clone，任何無法讀取的 body 都安全降級為空字串。 */
export async function readRequestBody(request: Pick<Request, 'clone'>): Promise<string> {
    try {
        return await request.clone().text();
    } catch {
        return '';
    }
}

/**
 * 取得 fetch request body。
 *
 * RequestInit.body 一旦明確提供便優先使用；否則僅從 Request 的 clone 非同步讀取，
 * 不會消耗原始 Request。
 */
export async function readFetchRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
        return serializeRequestBody(init.body);
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
        return readRequestBody(input);
    }
    return '';
}
