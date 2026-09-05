// KC3Kai battleplayer 相容的 PNG alpha 藏字（純函式，無 DOM）。
//
// 預設參數對齊 battleplayer 內建的 Peter Eigenschink steganography.js v1.0.1
// （t=3、threshold=1、codeUnitSize=16）。battleplayer 的 Upload image 走同一套 decode，
// 故 encode 必須寫出它能讀的 alpha。公式與容量：400²×3/16＝30000 字；更長的 JSON
// 把畫布依邊長比例放大，與 KC3Kai `exportBattleImg` 同一條 scale。
// inspired by steganography.js v1.0.1, MIT

const T = 3;
const THRESHOLD = 1;
const CODE_UNIT_SIZE = 16;
const PRIME = 11; // nextPrime(2^t)
const ALPHA_BASE = 255 - PRIME + 1;
const DONE_ALPHAS = 16;

export const REPLAY_PNG_BASE = 400;

export function hidingCapacity(width: number, height = width): number {
    return (T * width * height / CODE_UNIT_SIZE) >> 0;
}

/** JSON 太長時放大畫布；上限 8 倍，再長就無法藏進一張圖。 */
export function replayPngScale(charCount: number, base = REPLAY_PNG_BASE): number {
    let scale = 1;
    while (hidingCapacity(base * scale) < charCount + DONE_ALPHAS && scale < 8) scale += 1;
    return scale;
}

function bundlesOf(message: string): number[] {
    const bundlesPerChar = CODE_UNIT_SIZE / T >> 0;
    const overlapping = CODE_UNIT_SIZE % T;
    const modMessage: number[] = [];
    let oldDec = 0;
    for (let i = 0; i <= message.length; i += 1) {
        const dec = message.charCodeAt(i) || 0;
        const curOverlapping = (overlapping * i) % T;
        if (curOverlapping > 0 && oldDec) {
            let mask = Math.pow(2, T - curOverlapping) - 1;
            const oldMask = Math.pow(2, CODE_UNIT_SIZE) * (1 - Math.pow(2, -curOverlapping));
            const left = (dec & mask) << curOverlapping;
            const right = (oldDec & oldMask) >> (CODE_UNIT_SIZE - curOverlapping);
            modMessage.push(left + right);
            if (i < message.length) {
                mask = Math.pow(2, 2 * T - curOverlapping) * (1 - Math.pow(2, -T));
                for (let j = 1; j < bundlesPerChar; j += 1) {
                    const decM = dec & mask;
                    modMessage.push(decM >> (((j - 1) * T) + (T - curOverlapping)));
                    mask <<= T;
                }
                if ((overlapping * (i + 1)) % T === 0) {
                    mask = Math.pow(2, CODE_UNIT_SIZE) * (1 - Math.pow(2, -T));
                    modMessage.push((dec & mask) >> (CODE_UNIT_SIZE - T));
                } else if ((((overlapping * (i + 1)) % T) + (T - curOverlapping)) <= T) {
                    modMessage.push((dec & mask) >> (((bundlesPerChar - 1) * T) + (T - curOverlapping)));
                }
            }
        } else if (i < message.length) {
            let mask = Math.pow(2, T) - 1;
            for (let j = 0; j < bundlesPerChar; j += 1) {
                modMessage.push((dec & mask) >> (j * T));
                mask <<= T;
            }
        }
        oldDec = dec;
    }
    return modMessage;
}

/** 把訊息寫進 ImageData 的 alpha；呼叫端須先畫成不透明底，未寫到的像素保持 255。 */
export function encodeIntoImageData(image: ImageData, message: string): void {
    const data = image.data;
    const modMessage = bundlesOf(message);
    if ((modMessage.length + DONE_ALPHAS) * 4 > data.length) {
        throw new Error('steganography: 畫布藏不下這份重播');
    }
    for (let offset = 0; offset < modMessage.length; offset += THRESHOLD) {
        data[offset * 4 + 3] = ALPHA_BASE + modMessage[offset];
    }
}

export function decodeFromImageData(image: ImageData): string {
    const data = image.data;
    const modMessage: number[] = [];
    for (let i = 3; i < data.length; i += 4) {
        let done = true;
        for (let j = 0; j < DONE_ALPHAS && done; j += 1) {
            done = done && data[i + j * 4] === 255;
        }
        if (done) break;
        modMessage.push(data[i] - ALPHA_BASE);
    }
    let message = '';
    let charCode = 0;
    let bitCount = 0;
    const mask = Math.pow(2, CODE_UNIT_SIZE) - 1;
    for (const bundle of modMessage) {
        charCode += bundle << bitCount;
        bitCount += T;
        if (bitCount >= CODE_UNIT_SIZE) {
            message += String.fromCharCode(charCode & mask);
            bitCount %= CODE_UNIT_SIZE;
            charCode = bundle >> (T - bitCount);
        }
    }
    if (charCode !== 0) message += String.fromCharCode(charCode & mask);
    return message;
}
