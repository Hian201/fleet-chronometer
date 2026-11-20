// 純函式、零 chrome.* 依賴。

/** 一般物件（原型是 Object.prototype 或 null）。陣列、Date、Map 等一律不算。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * 任一層（陣列與一般物件）是否含 `api_token` 鍵。外部匯入的 opaque 封包內容不解讀，
 * 但憑證不得落地（硬約束 2）。以顯式堆疊走訪，深層巢狀不會撐爆呼叫堆疊。
 */
export function containsApiToken(value: unknown): boolean {
    const stack: unknown[] = [value];
    const visited = new WeakSet<object>();
    while (stack.length) {
        const current = stack.pop();
        if (current === null || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);
        if (Array.isArray(current)) {
            stack.push(...current);
            continue;
        }
        if (!isPlainObject(current)) continue;
        for (const [key, entry] of Object.entries(current)) {
            if (key === 'api_token') return true;
            stack.push(entry);
        }
    }
    return false;
}
