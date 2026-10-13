import { create } from 'zustand';
import type { SongResult } from '../types';

// src/stores/useLxAuditionStore.ts
// 自定义音源版块的「试听列表」：在这个版块里点播过的歌自动进列表（最新在前、按 id 去重）。
// 独立持久化在 renderer 的 localStorage，不碰 Folia 的播放队列 / 曲库。

const STORAGE_KEY = 'lx-source:audition:v1';
const MAX_ITEMS = 200;

const load = (): SongResult[] => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as { songs?: unknown };
        return Array.isArray(parsed?.songs) ? (parsed.songs as SongResult[]) : [];
    } catch {
        return [];
    }
};

const persist = (songs: SongResult[]) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ songs }));
    } catch {
        // 隐私模式 / 配额不足：放弃持久化，不影响当前会话。
    }
};

export type LxAuditionState = {
    songs: SongResult[];
    /** 记一首试听：按 id 去重后置顶，超出上限丢弃最旧的。 */
    add: (song: SongResult) => void;
    remove: (songId: SongResult['id']) => void;
    clear: () => void;
};

export const useLxAuditionStore = create<LxAuditionState>((set, get) => {
    const commit = (songs: SongResult[]) => {
        persist(songs);
        set({ songs });
    };

    return {
        songs: load(),

        add: (song) => {
            const next = [song, ...get().songs.filter(item => item.id !== song.id)].slice(0, MAX_ITEMS);
            commit(next);
        },

        remove: (songId) => {
            commit(get().songs.filter(item => item.id !== songId));
        },

        clear: () => commit([]),
    };
});
