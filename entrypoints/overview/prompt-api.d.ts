// Chrome 內建 AI「Prompt API」（Gemini Nano）的環境型別宣告。
// 此 API 尚未進入 TypeScript 標準 lib（截至本專案 TS 版本），且規格仍在演進中，
// 故手動宣告目前實際會用到的最小介面。
// 只在 overview 分頁使用（llm.ts）：官方文件明載「只在 top-level window 及其
// same-origin iframe 可用，Web Worker 不可用」——故不適用於 background service worker，
// 不影響 CLAUDE.md 設計原則 4（state.ts 核心零瀏覽器依賴）。
interface LanguageModelSession {
    prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
    promptStreaming(input: string, options?: { signal?: AbortSignal }): AsyncIterable<string>;
    destroy(): void;
}
interface LanguageModelCreateOptions {
    temperature?: number;
    topK?: number;
    initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
    signal?: AbortSignal;
    monitor?(m: EventTarget): void;
}
// availability() 回傳值目前已知至少含 'unavailable' 與 'downloading'；'available'／
// 'downloadable' 為官方範例常見值，未在文件逐一列舉，故型別保留 string 讓呼叫端
// 用字串比對而非窮舉 union（避免文件未列全的狀態被型別系統誤判為不可能）。
// 宣告為固定存在（不加 | undefined）：呼叫端一律先用 `typeof LanguageModel !== 'undefined'`
// 做執行期特徵偵測（瀏覽器未支援時該識別字根本不存在，typeof 不會拋錯，是標準寫法），
// 而非依賴 TypeScript 型別本身表達「可能不存在」——這是新興 Web API 型別宣告的慣例
// （如同 declare const chrome: ... 的模式），可避免呼叫處到處要多一層 `!` 或 null 檢查。
declare const LanguageModel: {
    availability(options?: { expectedInputs?: { type: string; languages?: string[] }[]; expectedOutputs?: { type: string; languages?: string[] }[] }): Promise<string>;
    create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};
