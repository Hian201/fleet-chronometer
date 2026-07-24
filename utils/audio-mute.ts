// 遊戲框內音訊靜音的**純安裝函式**：不碰 chrome.*、不假設全域，
// 所有相依（AudioContext、HTMLMediaElement、document）都從參數傳入，故可用 node 餵假物件測。
//
// 這條路徑優先處理遊戲框內的聲音；背景音樂若由其他無法攔截的路徑播放，background 會再以
// `tabs.update({ muted:true })` 靜音整個遊戲分頁。後者是可靠保底，代價是 DMM 頁面聲音也會靜音。
//
// 手法：把每個 AudioContext 的 `destination` 換成我們自己的 master GainNode（gain 再接到
// 真正的 destination）。遊戲之後所有 `connect(ctx.destination)` 都會經過這顆 gain，
// 設 0 即全靜音、設 1 即完全還原，**不改變遊戲的任何行為或音訊圖結構**。
//
// ⚠️ 未經真封包／實機驗證的部分：艦これ Flight-IIA 究竟用 WebAudio 還是 <audio>／<video>
// 播音，本專案沒有樣本可考（同 CLAUDE.md 的驗證原則）。故兩條路徑都接：WebAudio 走上述
// master gain，media 元素走 `muted` 屬性。任一環節失敗只 console.warn，**絕不讓例外冒進
// 遊戲自己的程式碼**——靜音是便利功能，弄壞遊戲不可接受。

type AnyFn = (...args: any[]) => any;

interface GainLike {
    gain: { value: number };
    connect(destination: unknown): unknown;
}

interface AudioContextLike {
    destination: unknown;
    createGain(): GainLike;
}

interface AudioContextCtor {
    new(...args: any[]): AudioContextLike;
    prototype: AudioContextLike;
}

interface MediaElementLike {
    muted: boolean;
}

/** 安裝目標（真實情況就是 window）。全部 optional：缺哪一項就跳過哪一條路徑。 */
export interface AudioMuteHost {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
    HTMLMediaElement?: { prototype: Record<string, any> };
    document?: {
        documentElement?: Node;
        querySelectorAll(selectors: string): ArrayLike<MediaElementLike>;
    };
    MutationObserver?: new(callback: MutationCallback) => {
        observe(target: Node, options: MutationObserverInit): void;
    };
}

export interface AudioMuteHandle {
    setMuted(muted: boolean): void;
    isMuted(): boolean;
    /** 已接管的 AudioContext 數量（測試與除錯用；也可判斷 hook 有沒有真的被用到）。 */
    contextCount(): number;
}

/** 沿原型鏈找 `destination` 的 getter，取得「真正的」輸出節點（我們之後會在實例上遮蔽它）。 */
function readRealDestination(ctx: AudioContextLike): unknown {
    let proto: any = Object.getPrototypeOf(ctx);
    while (proto) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'destination');
        if (desc?.get) return desc.get.call(ctx);
        if (desc && 'value' in desc) return desc.value;
        proto = Object.getPrototypeOf(proto);
    }
    return ctx.destination;
}

export function installAudioMute(host: AudioMuteHost, initialMuted = false): AudioMuteHandle {
    let muted = initialMuted;
    const gains: GainLike[] = [];

    const applyGain = (gain: GainLike) => {
        try {
            gain.gain.value = muted ? 0 : 1;
        } catch (error) {
            console.warn('[KC-Monitor] 無法套用靜音增益', error);
        }
    };

    // 每個新建的 AudioContext：插一顆 master gain 並遮蔽 destination。
    const attach = (ctx: AudioContextLike) => {
        try {
            const realDestination = readRealDestination(ctx);
            const gain = ctx.createGain();
            gain.connect(realDestination);
            // 少數音訊庫會讀 destination 的 maxChannelCount 等欄位；GainNode 沒有這些，
            // 故把讀取轉回真正的 destination，避免遊戲拿到 undefined 後炸掉。
            for (const key of ['maxChannelCount'] as const) {
                if (realDestination && key in (realDestination as object)) {
                    Object.defineProperty(gain, key, {
                        configurable: true,
                        get: () => (realDestination as any)[key],
                    });
                }
            }
            Object.defineProperty(ctx, 'destination', { configurable: true, get: () => gain });
            gains.push(gain);
            applyGain(gain);
        } catch (error) {
            // 接管失敗就維持原樣：遊戲照常有聲音，只是靜音鈕對 WebAudio 無效。
            console.warn('[KC-Monitor] 無法接管 AudioContext，靜音將只涵蓋 media 元素', error);
        }
    };

    // Proxy 的 construct trap：instanceof 與原型鏈完全不變，遊戲看不出差別。
    const wrap = (Original: AudioContextCtor): AudioContextCtor => new Proxy(Original, {
        construct(target, args, newTarget) {
            const ctx = Reflect.construct(target as any, args, newTarget) as AudioContextLike;
            attach(ctx);
            return ctx as unknown as object;
        },
    }) as AudioContextCtor;

    // Safari／Chromium 相容層可能讓兩個名稱指向同一個建構子。若各自再包一次，會在同一個
    // context 前串兩顆 gain；雖然仍能靜音，卻是沒必要的音訊圖改動。
    const wrappedContexts = new Map<AudioContextCtor, AudioContextCtor>();
    for (const key of ['AudioContext', 'webkitAudioContext'] as const) {
        const Original = host[key];
        if (typeof Original === 'function') {
            try {
                let Wrapped = wrappedContexts.get(Original);
                if (!Wrapped) {
                    Wrapped = wrap(Original);
                    wrappedContexts.set(Original, Wrapped);
                }
                host[key] = Wrapped;
            } catch (error) {
                console.warn('[KC-Monitor] 無法包裝 AudioContext 建構子', error);
            }
        }
    }

    // media 元素路徑：除了現存元素與 play()，還要涵蓋 autoplay（不一定會呼叫 JS 的 play）
    // 與遊戲在播放途中把 muted 寫回 false 的情形。解除靜音時還原元素原先狀態，不搶遊戲
    // 本來就刻意靜音的音效。
    const mediaMutedBefore = new WeakMap<object, boolean>();
    const forcedMedia = new Set<MediaElementLike>();
    const setMediaMuted = (node: MediaElementLike, next: boolean) => {
        try {
            if (next) {
                if (!mediaMutedBefore.has(node as object)) {
                    mediaMutedBefore.set(node as object, !!node.muted);
                }
                forcedMedia.add(node);
                node.muted = true;
            } else if (mediaMutedBefore.has(node as object)) {
                node.muted = mediaMutedBefore.get(node as object)!;
                mediaMutedBefore.delete(node as object);
                forcedMedia.delete(node);
            }
        } catch (error) {
            console.warn('[KC-Monitor] 無法設定 media 元素靜音', error);
        }
    };
    const muteMediaElements = () => {
        const nodes = host.document?.querySelectorAll('audio,video');
        if (!nodes) return;
        for (let i = 0; i < nodes.length; i++) {
            setMediaMuted(nodes[i], muted);
        }
    };
    const restoreMediaElements = () => {
        for (const node of forcedMedia) setMediaMuted(node, false);
    };

    const mediaProto = host.HTMLMediaElement?.prototype;
    // muted 是原型上的 accessor。包住 setter 後，即使遊戲在全域靜音期間自行寫 false，
    // 仍會保持靜音；原始 setter 仍負責所有瀏覽器內部狀態更新。
    if (mediaProto) {
        let proto: any = mediaProto;
        let mutedDescriptor: PropertyDescriptor | undefined;
        while (proto && !mutedDescriptor) {
            mutedDescriptor = Object.getOwnPropertyDescriptor(proto, 'muted');
            proto = Object.getPrototypeOf(proto);
        }
        if (mutedDescriptor?.get && mutedDescriptor.set) {
            try {
                Object.defineProperty(mediaProto, 'muted', {
                    configurable: true,
                    enumerable: !!mutedDescriptor.enumerable,
                    get(this: MediaElementLike) { return mutedDescriptor!.get!.call(this); },
                    set(this: MediaElementLike, value: boolean) {
                        if (muted) {
                            if (!mediaMutedBefore.has(this as object)) {
                                mediaMutedBefore.set(this as object, !!mutedDescriptor!.get!.call(this));
                            }
                            forcedMedia.add(this);
                            mutedDescriptor!.set!.call(this, true);
                        } else {
                            mutedDescriptor!.set!.call(this, value);
                        }
                    },
                });
            } catch (error) {
                console.warn('[KC-Monitor] 無法保護 media 靜音狀態', error);
            }
        }
    }
    if (mediaProto && typeof mediaProto.play === 'function') {
        const originalPlay = mediaProto.play as AnyFn;
        mediaProto.play = function patchedPlay(this: MediaElementLike, ...args: any[]) {
            if (muted) setMediaMuted(this, true);
            return originalPlay.apply(this, args);
        };
    }

    // autoplay 元素可在沒有呼叫 prototype.play 的情況下開始播放。只在靜音開啟時掃描，
    // 因此不改變一般遊戲運作；MutationObserver 不可用時，上面兩條路徑仍照常工作。
    const Observer = host.MutationObserver;
    const observedRoot = host.document?.documentElement;
    if (Observer && observedRoot) {
        try {
            new Observer(() => { if (muted) muteMediaElements(); }).observe(observedRoot, {
                childList: true,
                subtree: true,
            });
        } catch (error) {
            console.warn('[KC-Monitor] 無法監看新建 media 元素', error);
        }
    }

    // 若安裝時狀態已是靜音（例如遊戲頁剛重載、background 立刻下送既有偏好），不能等到
    // 下一次播放或 DOM 變動才處理目前已在播的元素。
    if (muted) muteMediaElements();

    return {
        setMuted(next: boolean) {
            muted = next;
            for (const gain of gains) applyGain(gain);
            if (muted) muteMediaElements();
            else restoreMediaElements();
        },
        isMuted: () => muted,
        contextCount: () => gains.length,
    };
}
