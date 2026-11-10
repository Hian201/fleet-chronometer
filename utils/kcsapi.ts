const KCSAPI_PREFIX = '/kcsapi/';

/** 伺服器回報請求未成功（外層 `api_result` 不是 1）的回應。 */
export class KcsapiResultError extends Error {
    constructor(readonly result: unknown) {
        super(`api_result=${String(result)}`);
        this.name = 'KcsapiResultError';
    }
}

/**
 * 將 kcsapi 原始 response text 還原成下游合約所需的 api_data。
 * response 的 `svdata=` 前綴與 api_data 外層只在此傳輸邊界處理；失敗由呼叫端決定如何記錄。
 *
 * 外層 `api_result` 不是 1 時丟出 `KcsapiResultError`：這種回應沒有 api_data，而依請求內容推算
 * 的狀態更新會把被伺服器拒絕的動作當成已發生；連線不穩時遊戲重試成功，同一動作還會套用兩次。
 * 只能在這裡判斷，api_data 內部有同名欄位（基地空襲的 `api_airsearch.api_result`）。
 * 欄位位置與「不是 1 就整筆不處理」依 ElectronicObserver
 * `ElectronicObserver/Observer/APIObserver.cs`（LoadResponse）與 KC3Kai
 * `src/library/objects/Request.js`（validateData）；各錯誤碼的意義未驗證，不加以區分。
 */
export function parseKcsapiResponse(text: string): unknown {
    const data = JSON.parse(text.replace(/^svdata=/, ''));
    if (Number(data?.api_result) !== 1) throw new KcsapiResultError(data?.api_result);
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

/**
 * axios `config.data` → bridge 用的 `application/x-www-form-urlencoded` 字串。
 * 無法安全表示的型別（檔案、巢狀物件）略過該欄，不猜。
 */
export function serializeAxiosRequestBody(data: unknown): string {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    if (data instanceof URLSearchParams) return data.toString();
    if (typeof FormData !== 'undefined' && data instanceof FormData) {
        const params = new URLSearchParams();
        data.forEach((value, key) => {
            if (typeof value === 'string') params.append(key, value);
        });
        return params.toString();
    }
    if (typeof data === 'object' && !Array.isArray(data)) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            if (value == null || typeof value === 'object') continue;
            params.append(key, String(value));
        }
        return params.toString();
    }
    return '';
}

/**
 * axios `response.data` → 與 XHR `responseText` 同形的 `svdata=` 文字，供 `parseKcsapiResponse`。
 * 字串原樣通過（遊戲預設就是 `svdata=...`）；已 parse 的物件再包一層前綴。
 */
export function serializeAxiosResponseText(data: unknown): string | null {
    if (typeof data === 'string') return data;
    if (data != null && typeof data === 'object') {
        try {
            return `svdata=${JSON.stringify(data)}`;
        } catch {
            return null;
        }
    }
    return null;
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

// 請求表單中不得離開遊戲頁的欄位。MAIN world 觀察器、bridge 與 background 各自移除一次
// （三道防線互不信任上游），共用這份清單以免其中一道漏改。
export const SENSITIVE_REQUEST_KEYS = ['api_token', 'api_verno'] as const;
