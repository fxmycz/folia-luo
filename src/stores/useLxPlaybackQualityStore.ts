import { create } from 'zustand';
import type { AudioQualityPreference } from '../types/onlineMusic';

// src/stores/useLxPlaybackQualityStore.ts
// 自定义音源版块自己的「在线播放音质」。只在 lx-* provider 解析播放直链时生效，
// 不动 Folia 的全局「默认音质」（未设置时跟随它）。独立持久化在 renderer 的 localStorage。

const STORAGE_KEY = 'lx-source:playback-quality:v1';

const QUALITIES: AudioQualityPreference[] = ['standard', 'high', 'lossless', 'hires'];

const isQuality = (value: unknown): value is AudioQualityPreference => QUALITIES.includes(value as AudioQualityPreference);

const load = (): AudioQualityPreference | null => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return isQuality(raw) ? raw : null;
    } catch {
        return null;
    }
};

export type LxPlaybackQualityState = {
    /** null 表示跟随 Folia 的「默认音质」。 */
    playbackQuality: AudioQualityPreference | null;
    setPlaybackQuality: (quality: AudioQualityPreference | null) => void;
};

export const useLxPlaybackQualityStore = create<LxPlaybackQualityState>((set) => ({
    playbackQuality: load(),
    setPlaybackQuality: (quality) => {
        try {
            if (quality) window.localStorage.setItem(STORAGE_KEY, quality);
            else window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            // 隐私模式 / 配额不足：放弃持久化，不影响当前会话。
        }
        set({ playbackQuality: quality });
    },
}));
