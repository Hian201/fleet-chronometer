/** bridge 交給 background 的 kcsapi runtime message。 */
export interface KcApiRuntimeMessage {
    type: 'kc:api';
    captureId: string;
    ts: number;
    path: string;
    req: Record<string, string>;
    // 保持原始 response text，避免在遊戲 renderer 中跨 context 複製解析後的大型巢狀物件。
    apiText: string;
}

export interface KcApiRuntimeMessageInput {
    path: string;
    req: Record<string, string>;
    apiText: string;
}

export interface RuntimeMessageFactory {
    createUuid: () => string;
    now: () => number;
}

export interface RuntimeMessageSender {
    send: (message: KcApiRuntimeMessage) => Promise<unknown>;
    retryDelay: () => Promise<void>;
}

/** 為已完成清理的封包建立一次固定的傳輸 envelope。 */
export function createKcApiRuntimeMessage(
    input: KcApiRuntimeMessageInput,
    { createUuid, now }: RuntimeMessageFactory,
): KcApiRuntimeMessage {
    return {
        type: 'kc:api',
        captureId: createUuid(),
        ts: now(),
        path: input.path,
        req: input.req,
        apiText: input.apiText,
    };
}

/**
 * 只在第一次傳送失敗後等待並重試一次。
 * 同一個 message 物件會直接重用，避免 retry 改變 captureId、時間或封包內容。
 */
export async function sendKcApiRuntimeMessageWithRetry(
    message: KcApiRuntimeMessage,
    { send, retryDelay }: RuntimeMessageSender,
): Promise<void> {
    try {
        await send(message);
    } catch {
        await retryDelay();
        await send(message);
    }
}
