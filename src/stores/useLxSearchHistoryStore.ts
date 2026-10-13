import { create } from 'zustand';

// src/stores/useLxSearchHistoryStore.ts
// 自定义音源版块的搜索历史：只落在 renderer 的 localStorage（键带 `lx-source:` 前缀），
// 与 Folia 既有的搜索功能互不相干。最新的在最前，去重，条数封顶。

const STORAGE_KEY = 'lx-source:search-history:v1';
const MAX_ITEMS = 20;

const load = (): string[] => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as { items?: unknown };
        return Array.isArray(parsed?.items) ? parsed.items.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
};

const persist = (items: string[]) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }));
    } catch {
        // 隐私模式 / 配额不足：放弃持久化，不影响当前会话。
    }
};

export type LxSearchHistoryState = {
    items: string[];
    /** 记一条搜索词：去重后置顶。 */
    add: (query: string) => void;
    remove: (query: string) => void;
    clear: () => void;
};

export const useLxSearchHistoryStore = create<LxSearchHistoryState>((set, get) => {
    const commit = (items: string[]) => {
        persist(items);
        set({ items });
    };

    return {
        items: load(),

        add: (query) => {
            const trimmed = query.trim();
            if (!trimmed) return;
            const next = [trimmed, ...get().items.filter(item => item !== trimmed)].slice(0, MAX_ITEMS);
            commit(next);
        },

        remove: (query) => {
            commit(get().items.filter(item => item !== query));
        },

        clear: () => commit([]),
    };
});
