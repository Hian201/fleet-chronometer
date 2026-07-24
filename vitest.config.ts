import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // WXT 建置時提供 `@` → 專案根目錄的別名，但 vitest 不經過 WXT，故這裡補同一條對應；
    // 否則測試一 import 到使用 `@/…` 的 entrypoint 模組（例 overview/lib.ts）就解析失敗。
    resolve: {
        alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    test: {
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.ts'],
    },
});
