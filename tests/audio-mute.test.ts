import { describe, expect, it, vi } from 'vitest';
import { installAudioMute, type AudioMuteHost } from '../utils/audio-mute';

// 假的 WebAudio：只保留 hook 需要的形狀——destination 必須是**原型上的 getter**
// （真實瀏覽器就是這樣定義的），因為 hook 靠沿原型鏈找 getter 取得真正的輸出節點。
class FakeGainNode {
    gain = { value: 1 };
    connectedTo: unknown = null;
    connect(destination: unknown) { this.connectedTo = destination; return destination; }
}

class FakeDestination {
    maxChannelCount = 6;
}

class FakeAudioContext {
    realDestination = new FakeDestination();
    created: FakeGainNode[] = [];
    get destination(): unknown { return this.realDestination; }
    createGain(): FakeGainNode {
        const gain = new FakeGainNode();
        this.created.push(gain);
        return gain;
    }
}

function makeHost(overrides: Partial<AudioMuteHost> = {}): AudioMuteHost & { AudioContext: any } {
    return {
        AudioContext: FakeAudioContext as any,
        ...overrides,
    } as AudioMuteHost & { AudioContext: any };
}

describe('installAudioMute：WebAudio 路徑', () => {
    it('把 destination 換成串在真正輸出前面的 master gain', () => {
        const host = makeHost();
        installAudioMute(host);
        const ctx = new host.AudioContext() as FakeAudioContext;

        const gain = ctx.created[0];
        expect(ctx.destination).toBe(gain);
        expect(gain.connectedTo).toBe(ctx.realDestination);
    });

    it('setMuted 切換所有已建立 context 的增益', () => {
        const host = makeHost();
        const handle = installAudioMute(host);
        const a = new host.AudioContext() as FakeAudioContext;
        const b = new host.AudioContext() as FakeAudioContext;

        handle.setMuted(true);
        expect(a.created[0].gain.value).toBe(0);
        expect(b.created[0].gain.value).toBe(0);

        handle.setMuted(false);
        expect(a.created[0].gain.value).toBe(1);
        expect(b.created[0].gain.value).toBe(1);
        expect(handle.contextCount()).toBe(2);
    });

    // 遊戲分頁重新載入時，靜音狀態由 background 推下來；此時建立的 context 必須一開始就是靜的。
    it('初始為靜音時，之後建立的 context 直接靜音', () => {
        const host = makeHost();
        installAudioMute(host, true);
        const ctx = new host.AudioContext() as FakeAudioContext;
        expect(ctx.created[0].gain.value).toBe(0);
    });

    it('保留 instanceof 與原型鏈（遊戲看不出被包過）', () => {
        const host = makeHost();
        installAudioMute(host);
        const ctx = new host.AudioContext();
        expect(ctx).toBeInstanceOf(FakeAudioContext);
    });

    // 少數音訊庫會讀 destination.maxChannelCount；GainNode 沒有這個欄位，拿到 undefined
    // 可能讓遊戲初始化失敗——靜音功能絕不可以弄壞遊戲。
    it('把 maxChannelCount 轉回真正的 destination', () => {
        const host = makeHost();
        installAudioMute(host);
        const ctx = new host.AudioContext() as FakeAudioContext;
        expect((ctx.destination as any).maxChannelCount).toBe(6);
    });

    it('接管失敗時維持原狀，不讓例外冒進遊戲程式碼', () => {
        class BrokenContext extends FakeAudioContext {
            override createGain(): FakeGainNode { throw new Error('no audio'); }
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const host = makeHost({ AudioContext: BrokenContext as any });
        const handle = installAudioMute(host);

        const ctx = new host.AudioContext() as FakeAudioContext;
        expect(ctx.destination).toBe(ctx.realDestination);
        expect(handle.contextCount()).toBe(0);
        expect(() => handle.setMuted(true)).not.toThrow();
        warn.mockRestore();
    });
});

describe('installAudioMute：media 元素路徑', () => {
    // 艦これ Flight-IIA 用 WebAudio 還是 <audio> 本專案沒有樣本可考，故兩條路徑都接。
    it('setMuted 同步既有的 audio／video 元素', () => {
        const media = [{ muted: false }, { muted: false }];
        const host = makeHost({
            document: { querySelectorAll: () => media } as any,
        });
        const handle = installAudioMute(host);

        handle.setMuted(true);
        expect(media.every(m => m.muted)).toBe(true);
        handle.setMuted(false);
        expect(media.every(m => m.muted)).toBe(false);
    });

    it('靜音期間新播放的元素會在 play() 時補上 muted', () => {
        const played: unknown[] = [];
        const proto: Record<string, any> = { play(this: unknown) { played.push(this); return 'ok'; } };
        const host = makeHost({ HTMLMediaElement: { prototype: proto } });
        const handle = installAudioMute(host);

        const element = Object.assign(Object.create(proto), { muted: false });
        handle.setMuted(true);
        expect(element.play()).toBe('ok');
        expect(element.muted).toBe(true);
        expect(played).toEqual([element]);

        // 關閉靜音後不去動元素既有的設定（可能是遊戲自己設的）
        const other = Object.assign(Object.create(proto), { muted: true });
        handle.setMuted(false);
        other.play();
        expect(other.muted).toBe(true);
    });

    it('全域靜音期間遊戲嘗試解除 muted 仍保持靜音，解除後還原原值', () => {
        let value = false;
        const proto: Record<string, any> = {};
        Object.defineProperty(proto, 'muted', {
            configurable: true,
            get() { return value; },
            set(next: boolean) { value = next; },
        });
        const host = makeHost({ HTMLMediaElement: { prototype: proto } });
        const handle = installAudioMute(host);
        const element = Object.create(proto) as { muted: boolean };

        handle.setMuted(true);
        element.muted = false;
        expect(element.muted).toBe(true);

        handle.setMuted(false);
        expect(element.muted).toBe(false);
    });
});
