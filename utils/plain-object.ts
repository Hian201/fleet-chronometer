// 純函式、零 chrome.* 依賴。

/** 一般物件（原型是 Object.prototype 或 null）。陣列、Date、Map 等一律不算。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
