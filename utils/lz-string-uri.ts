// LZ-String 的 URI 安全壓縮／解壓——與 KC3Kai battleplayer 內建的
// reader/lz-string.js 1.4.4 同一套演算法（compressToEncodedURIComponent）。
// 播放器只認這個輸出；不可改用 gzip／其他字典編碼。
//
// 來源：Pieroxy lz-string 1.4.4，WTFPL。只保留 URI 安全這對函式。

const KEY_STR_URI_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';

const baseReverseDic: Record<string, Record<string, number>> = {};

function getBaseValue(alphabet: string, character: string): number {
    let map = baseReverseDic[alphabet];
    if (!map) {
        map = {};
        for (let i = 0; i < alphabet.length; i++) map[alphabet.charAt(i)] = i;
        baseReverseDic[alphabet] = map;
    }
    return map[character];
}

function compress(
    uncompressed: string,
    bitsPerChar: number,
    getCharFromInt: (a: number) => string,
): string {
    const context_dictionary: Record<string, number> = {};
    const context_dictionaryToCreate: Record<string, boolean> = {};
    let context_c = '';
    let context_wc = '';
    let context_w = '';
    let context_enlargeIn = 2;
    let context_dictSize = 3;
    let context_numBits = 2;
    const context_data: string[] = [];
    let context_data_val = 0;
    let context_data_position = 0;

    const writeBit = (bit: number) => {
        context_data_val = (context_data_val << 1) | bit;
        if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
        } else {
            context_data_position++;
        }
    };
    const writeBits = (value: number, n: number) => {
        for (let i = 0; i < n; i++) {
            writeBit(value & 1);
            value >>= 1;
        }
    };
    const writeW = () => {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
            if (context_w.charCodeAt(0) < 256) {
                writeBits(0, context_numBits);
                writeBits(context_w.charCodeAt(0), 8);
            } else {
                writeBits(1, context_numBits);
                writeBits(context_w.charCodeAt(0), 16);
            }
            context_enlargeIn--;
            if (context_enlargeIn === 0) {
                context_enlargeIn = 2 ** context_numBits;
                context_numBits++;
            }
            delete context_dictionaryToCreate[context_w];
        } else {
            writeBits(context_dictionary[context_w], context_numBits);
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
            context_enlargeIn = 2 ** context_numBits;
            context_numBits++;
        }
    };

    for (let ii = 0; ii < uncompressed.length; ii++) {
        context_c = uncompressed.charAt(ii);
        if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
            context_dictionary[context_c] = context_dictSize++;
            context_dictionaryToCreate[context_c] = true;
        }
        context_wc = context_w + context_c;
        if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
            context_w = context_wc;
        } else {
            writeW();
            context_dictionary[context_wc] = context_dictSize++;
            context_w = String(context_c);
        }
    }
    if (context_w !== '') writeW();
    writeBits(2, context_numBits);
    while (true) {
        context_data_val <<= 1;
        if (context_data_position === bitsPerChar - 1) {
            context_data.push(getCharFromInt(context_data_val));
            break;
        }
        context_data_position++;
    }
    return context_data.join('');
}

function decompress(
    length: number,
    resetValue: number,
    getNextValue: (index: number) => number,
): string | null {
    const dictionary: Array<string | number> = [];
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    const result: string[] = [];
    const data = { val: getNextValue(0), position: resetValue, index: 1 };
    const f = String.fromCharCode;

    for (let i = 0; i < 3; i++) dictionary[i] = i;

    const readBits = (n: number): number => {
        let bits = 0;
        let power = 1;
        const maxpower = 2 ** n;
        while (power !== maxpower) {
            const resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
        }
        return bits;
    };

    let next = readBits(2);
    let c: string;
    if (next === 0) c = f(readBits(8));
    else if (next === 1) c = f(readBits(16));
    else return '';
    dictionary[3] = c;
    let w = c;
    result.push(c);

    while (true) {
        if (data.index > length) return '';
        const code = readBits(numBits);
        let entry: string;
        if (code === 0) {
            dictionary[dictSize++] = f(readBits(8));
            c = String(dictSize - 1);
            enlargeIn--;
        } else if (code === 1) {
            dictionary[dictSize++] = f(readBits(16));
            c = String(dictSize - 1);
            enlargeIn--;
        } else if (code === 2) {
            return result.join('');
        } else {
            c = String(code);
        }
        if (enlargeIn === 0) {
            enlargeIn = 2 ** numBits;
            numBits++;
        }
        const dictEntry = dictionary[Number(c)];
        if (dictEntry) {
            entry = String(dictEntry);
        } else if (Number(c) === dictSize) {
            entry = w + w.charAt(0);
        } else {
            return null;
        }
        result.push(entry);
        dictionary[dictSize++] = w + entry.charAt(0);
        enlargeIn--;
        w = entry;
        if (enlargeIn === 0) {
            enlargeIn = 2 ** numBits;
            numBits++;
        }
    }
}

/** 壓縮成 battleplayer `#fromLZString=` 可直接接上的字串（已是 URI 安全字元）。 */
export function compressToEncodedURIComponent(input: string): string {
    if (input == null) return '';
    return compress(input, 6, a => KEY_STR_URI_SAFE.charAt(a));
}

/** 對 `compressToEncodedURIComponent` 的逆運算；給測試與自行驗證用。 */
export function decompressFromEncodedURIComponent(input: string): string | null {
    if (input == null) return '';
    if (input === '') return null;
    const normalized = input.replace(/ /g, '+');
    return decompress(normalized.length, 32, index =>
        getBaseValue(KEY_STR_URI_SAFE, normalized.charAt(index)));
}

/**
 * 離線 viewer.html 內嵌用的壓縮函式（與上面同一套 1.4.4 URI 安全輸出）。
 * 必須是瀏覽器可直接執行的完整函式宣告，不可依賴模組或型別。
 */
export const LZ_STRING_URI_BROWSER_SRC = `function compressToEncodedURIComponent(input) {
  if (input == null) return "";
  var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
  var context_dictionary = {}, context_dictionaryToCreate = {};
  var context_c = "", context_wc = "", context_w = "";
  var context_enlargeIn = 2, context_dictSize = 3, context_numBits = 2;
  var context_data = [], context_data_val = 0, context_data_position = 0;
  var bitsPerChar = 6;
  function writeBit(bit) {
    context_data_val = (context_data_val << 1) | bit;
    if (context_data_position === bitsPerChar - 1) {
      context_data_position = 0;
      context_data.push(keyStrUriSafe.charAt(context_data_val));
      context_data_val = 0;
    } else context_data_position++;
  }
  function writeBits(value, n) {
    for (var i = 0; i < n; i++) { writeBit(value & 1); value >>= 1; }
  }
  function writeW() {
    if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
      if (context_w.charCodeAt(0) < 256) { writeBits(0, context_numBits); writeBits(context_w.charCodeAt(0), 8); }
      else { writeBits(1, context_numBits); writeBits(context_w.charCodeAt(0), 16); }
      context_enlargeIn--;
      if (context_enlargeIn === 0) { context_enlargeIn = Math.pow(2, context_numBits); context_numBits++; }
      delete context_dictionaryToCreate[context_w];
    } else writeBits(context_dictionary[context_w], context_numBits);
    context_enlargeIn--;
    if (context_enlargeIn === 0) { context_enlargeIn = Math.pow(2, context_numBits); context_numBits++; }
  }
  for (var ii = 0; ii < input.length; ii++) {
    context_c = input.charAt(ii);
    if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
      context_dictionary[context_c] = context_dictSize++;
      context_dictionaryToCreate[context_c] = true;
    }
    context_wc = context_w + context_c;
    if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) context_w = context_wc;
    else {
      writeW();
      context_dictionary[context_wc] = context_dictSize++;
      context_w = String(context_c);
    }
  }
  if (context_w !== "") writeW();
  writeBits(2, context_numBits);
  while (true) {
    context_data_val <<= 1;
    if (context_data_position === bitsPerChar - 1) { context_data.push(keyStrUriSafe.charAt(context_data_val)); break; }
    context_data_position++;
  }
  return context_data.join("");
}`;
