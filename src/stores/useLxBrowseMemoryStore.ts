import { create } from 'zustand';
import type { SongResult } from '../types';
import type { OmniCollection } from '../types/onlineMusic';

// src/stores/useLxBrowseMemoryStore.ts
// 记住「在线浏览」的状态：最后选中的平台、每个平台各自的榜单 / 搜索视图，以及榜单视图下最后打开的那个集合。
// 另外维护两份**进程内**状态（不落 localStorage）：
//   1. snapshots —— 每个平台的浏览会话快照（搜索结果 / 打开的歌单 / 曲目…），切标签或切平台再回来时原样恢复，不重复请求；
//   2. pendingOpen —— 「从收藏打开某个歌单」的一次性请求，由在线浏览面板消费。
// 插件式独立持久化，键带 `lx-source:` 前缀，不碰 Folia 既有设置。

const STORAGE_KEY = 'lx-source:browse-memory:v2';
const LEGACY_KEY = 'lx-source:browse-memory:v1';

export type LxBrowseMode = 'boards' | 'search';
/** 版块自身的一级标签（在线浏览 / 试听 / 收藏 / 音源管理 / 下载）。 */
export type LxSurfaceTab = 'browse' | 'audition' | 'favorites' | 'manager' | 'download';

export type LxBrowseMemory = {
    mode: LxBrowseMode;
    collection?: OmniCollection;
};

/** 一个平台的浏览会话快照。仅存进程内：应用退出即丢，符合「最后一次结果」的语义。 */
export type LxBrowseSnapshot = {
    mode: LxBrowseMode;
    query: string;
    searchKind: 'songs' | 'playlists';
    searched: boolean;
    results: SongResult[];
    playlistResults: OmniCollection[];
    boards: OmniCollection[];
    /** 榜单是否已拉过（空数组也可能是拉取结果），用于避免重复请求。 */
    boardsLoaded: boolean;
    tracks: SongResult[];
    hasMore: boolean;
    collection: OmniCollection | null;
};

const EMPTY_SNAPSHOT: LxBrowseSnapshot = {
    mode: 'boards',
    query: '',
    searchKind: 'songs',
    searched: false,
    results: [],
    playlistResults: [],
    boards: [],
    boardsLoaded: false,
    tracks: [],
    hasMore: false,
    collection: null,
};

type PersistedState = {
    byPlatform: Record<string, LxBrowseMemory>;
    lastProviderId: string | null;
    surfaceTab: LxSurfaceTab;
};

const SURFACE_TABS: LxSurfaceTab[] = ['browse', 'audition', 'favorites', 'manager', 'download'];

const toSurfaceTab = (value: unknown): LxSurfaceTab => (
    SURFACE_TABS.includes(value as LxSurfaceTab) ? value as LxSurfaceTab : 'browse'
);

const isCollection = (value: unknown): value is OmniCollection => (
    Boolean(value) && typeof value === 'object' && typeof (value as OmniCollection).id !== 'undefined'
);

const load = (): PersistedState => {
    const fallback: PersistedState = { byPlatform: {}, lastProviderId: null, surfaceTab: 'browse' };
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as { byPlatform?: unknown; lastProviderId?: unknown; surfaceTab?: unknown };
            const value = parsed?.byPlatform;
            const byPlatform: Record<string, LxBrowseMemory> = {};
            if (value && typeof value === 'object') {
                for (const [platform, memory] of Object.entries(value as Record<string, LxBrowseMemory>)) {
                    if (!memory || typeof memory !== 'object') continue;
                    const mode: LxBrowseMode = memory.mode === 'search' ? 'search' : 'boards';
                    byPlatform[platform] = isCollection(memory.collection) ? { mode, collection: memory.collection } : { mode };
                }
            }
            return {
                byPlatform,
                lastProviderId: typeof parsed?.lastProviderId === 'string' ? parsed.lastProviderId : null,
                surfaceTab: toSurfaceTab(parsed?.surfaceTab),
            };
        }
        // v1 只存了集合对象（没有视图），迁移成 { mode: 'boards', collection }。
        const legacy = window.localStorage.getItem(LEGACY_KEY);
        if (legacy) {
            const parsed = JSON.parse(legacy) as { byPlatform?: unknown };
            const value = parsed?.byPlatform;
            const byPlatform: Record<string, LxBrowseMemory> = {};
            if (value && typeof value === 'object') {
                for (const [platform, collection] of Object.entries(value)) {
                    if (isCollection(collection)) byPlatform[platform] = { mode: 'boards', collection };
                }
            }
            return { byPlatform, lastProviderId: null, surfaceTab: 'browse' };
        }
        return fallback;
    } catch {
        return fallback;
    }
};

const persist = (state: PersistedState) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // 隐私模式 / 配额不足：放弃持久化，不影响当前会话。
    }
};

const initial = load();

export type LxBrowseMemoryState = {
    byPlatform: Record<string, LxBrowseMemory>;
    /** 最后选中的平台，用于重新进入版块时复位。 */
    lastProviderId: string | null;
    /** 版块内最后停留的标签。 */
    surfaceTab: LxSurfaceTab;
    /** 进程内：按平台隔离的浏览会话快照。 */
    snapshots: Record<string, LxBrowseSnapshot>;
    /** 进程内：一次性「打开某个歌单」请求（供收藏页跳回浏览页）。 */
    pendingOpen: OmniCollection | null;
    /** 记下最后选中的平台。 */
    rememberProvider: (providerId: string) => void;
    /** 记下某平台当前的视图（榜单 / 搜索）。 */
    rememberMode: (providerId: string, mode: LxBrowseMode) => void;
    /** 记下某平台当前打开的集合（视图保持原样）。 */
    rememberCollection: (providerId: string, collection: OmniCollection) => void;
    /** 忘掉某平台记录的集合（用户主动离开榜单时调用），视图记录保留。 */
    forgetCollection: (providerId: string) => void;
    /** 记下版块内停留的标签。 */
    setSurfaceTab: (tab: LxSurfaceTab) => void;
    /** 读某平台的会话快照；从未浏览过返回 undefined。 */
    getSnapshot: (providerId: string) => LxBrowseSnapshot | undefined;
    /** 增量更新某平台的会话快照（不存在则按空快照合并）。 */
    patchSnapshot: (providerId: string, patch: Partial<LxBrowseSnapshot>) => void;
    /** 丢弃某平台的会话快照。 */
    clearSnapshot: (providerId: string) => void;
    /** 请求在线浏览面板打开某个歌单（收藏页跳转用）。 */
    setPendingOpen: (collection: OmniCollection) => void;
    /** 取出并清空待打开的歌单。 */
    consumePendingOpen: () => OmniCollection | null;
};

export const useLxBrowseMemoryStore = create<LxBrowseMemoryState>((set, get) => {
    const commit = (next: Partial<PersistedState>) => {
        const byPlatform = next.byPlatform ?? get().byPlatform;
        const lastProviderId = next.lastProviderId === undefined ? get().lastProviderId : next.lastProviderId;
        const surfaceTab = next.surfaceTab ?? get().surfaceTab;
        persist({ byPlatform, lastProviderId, surfaceTab });
        set({ byPlatform, lastProviderId, surfaceTab });
    };

    return {
        byPlatform: initial.byPlatform,
        lastProviderId: initial.lastProviderId,
        surfaceTab: initial.surfaceTab,
        snapshots: {},
        pendingOpen: null,

        rememberProvider: (providerId) => {
            if (get().lastProviderId === providerId) return;
            commit({ lastProviderId: providerId });
        },

        rememberMode: (providerId, mode) => {
            const previous = get().byPlatform[providerId];
            if (previous?.mode === mode) return;
            commit({ byPlatform: { ...get().byPlatform, [providerId]: { ...previous, mode } } });
        },

        rememberCollection: (providerId, collection) => {
            const previous = get().byPlatform[providerId];
            commit({ byPlatform: { ...get().byPlatform, [providerId]: { mode: previous?.mode ?? 'boards', collection } } });
        },

        forgetCollection: (providerId) => {
            const previous = get().byPlatform[providerId];
            if (!previous?.collection) return;
            commit({ byPlatform: { ...get().byPlatform, [providerId]: { mode: previous.mode } } });
        },

        setSurfaceTab: (tab) => {
            if (get().surfaceTab === tab) return;
            commit({ surfaceTab: tab });
        },

        getSnapshot: (providerId) => get().snapshots[providerId],

        patchSnapshot: (providerId, patch) => {
            const previous = get().snapshots[providerId] ?? EMPTY_SNAPSHOT;
            set({ snapshots: { ...get().snapshots, [providerId]: { ...previous, ...patch } } });
        },

        clearSnapshot: (providerId) => {
            if (!get().snapshots[providerId]) return;
            const next = { ...get().snapshots };
            delete next[providerId];
            set({ snapshots: next });
        },

        setPendingOpen: (collection) => set({ pendingOpen: collection }),

        consumePendingOpen: () => {
            const value = get().pendingOpen;
            if (value) set({ pendingOpen: null });
            return value;
        },
    };
});
