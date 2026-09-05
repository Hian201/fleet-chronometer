declare module 'lzma/src/lzma_worker.js' {
    export const LZMA: {
        compress(text: string, mode: number): number[];
        decompress(bytes: number[] | Uint8Array): string;
    };
}
