import { create } from 'zustand';
import type { ProviderCollection } from '../../types/onlineMusic';
import type { UnifiedSong } from '../../types';
import { getActiveLuoxueSourceId, getBrowsePlatform, setActiveLuoxueSourceId, setBrowsePlatform as applyBrowsePlatform } from '../provider/activeSource';
import { getLuoxueBoards, getLuoxueCollectionTracks, getLuoxueHotSearch, getLuoxueSongListTags, getLuoxueSongLists, getLuoxueSuggest, searchLuoxueSongLists, searchLuoxueSongs, type LuoxueSongListTagGroup } from '../services/luoxueCatalog';

// src/luoxue/store/useLuoxueSectionStore.ts
// 洛雪版块的页面状态：六个二级面板（搜索 / 排行榜 / 歌单 / 我的列表 / 下载 / 音源 / 设置）、各自的加载状态与当前打开的集合。
// 只在这里发起请求（经 services），组件只读这里的状态。

export type LuoxuePanelId = 'search' | 'boards' | 'songlists' | 'mylist' | 'download' | 'source' | 'settings';
export type LuoxueLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const PAGE_SIZE = 30;

/** 搜索的类别：单曲 / 歌单。两个类别各自记一份结果与分页进度，来回切换互不覆盖。 */
export type LuoxueSearchKind = 'song' | 'songlist';

/** 打开集合详情的是哪个面板：三块详情各自记一份，切面板时互不影响（见 openCollections）。 */
export type LuoxueCollectionOwner = 'boards' | 'songlists' | 'search';

/** 搜索历史的 localStorage 键与上限（去重、最新的在最前）。 */
const SEARCH_HISTORY_KEY = 'luoxue_search_history';
const SEARCH_HISTORY_LIMIT = 20;

const readSearchHistory = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
        const parsed = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
};

const writeSearchHistory = (list: string[]): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list));
    } catch {
        // 存储被禁用时历史只在内存里生效，不影响搜索本身。
    }
};

/** 联想请求的序号：打字很快时后发的请求可能先回来，只让最后一次的结果落到状态里。 */
let suggestRequestId = 0;

export type LuoxueOpenCollection = {
    collection: ProviderCollection;
    status: LuoxueLoadStatus;
    tracks: UnifiedSong[];
    hasMore: boolean;
    offset: number;
};

type LuoxueSectionState = {
    panel: LuoxuePanelId;
    setPanel: (panel: LuoxuePanelId) => void;

    query: string;
    setQuery: (query: string) => void;
    searchStatus: LuoxueLoadStatus;
    searchResults: UnifiedSong[];
    searchHasMore: boolean;
    searchOffset: number;
    searchError: string | null;
    /** 单曲 / 歌单类别；切换时按当前关键词重搜一次（两个类别的结果各留一份）。 */
    searchKind: LuoxueSearchKind;
    setSearchKind: (kind: LuoxueSearchKind) => void;
    /** 「歌单」类别的结果与分页进度。 */
    searchCollections: ProviderCollection[];
    searchCollectionsStatus: LuoxueLoadStatus;
    searchCollectionsHasMore: boolean;
    searchCollectionsOffset: number;
    searchCollectionsError: string | null;
    runSongListSearch: (query?: string, options?: { append?: boolean }) => Promise<void>;
    hotKeywords: string[];
    hotStatus: LuoxueLoadStatus;
    runSearch: (query?: string, options?: { append?: boolean }) => Promise<void>;
    loadHotKeywords: () => Promise<void>;

    /** 搜索历史（最新在前、去重、最多 20 条；存 localStorage）。 */
    searchHistory: string[];
    pushSearchHistory: (keyword: string) => void;
    removeSearchHistory: (keyword: string) => void;
    clearSearchHistory: () => void;

    /** 输入时的联想词；只保留最新一次请求的结果。 */
    suggestKeywords: string[];
    suggestStatus: LuoxueLoadStatus;
    runSuggest: (keyword: string) => Promise<void>;
    clearSuggest: () => void;

    boards: ProviderCollection[];
    boardsStatus: LuoxueLoadStatus;
    loadBoards: () => Promise<void>;

    songlistTagGroups: LuoxueSongListTagGroup[];
    activeTagId: string;
    setActiveTagId: (tagId: string) => void;
    songlists: ProviderCollection[];
    songlistsStatus: LuoxueLoadStatus;
    songlistsHasMore: boolean;
    songlistsOffset: number;
    loadSongListTags: () => Promise<void>;
    loadSongLists: (options?: { append?: boolean }) => Promise<void>;

    /**
     * 两个面板（排行榜 / 歌单）各自打开着的集合详情。
     *
     * 以前是一块共享状态，切面板时要清掉——不然从歌单切到排行榜会看到上一个歌单的曲目。现在每块面板
     * 记自己的一份：切走再切回来，打开着的榜单 / 歌单还在原处（切面板保留状态），也不会串台。
     */
    openCollections: Record<LuoxueCollectionOwner, LuoxueOpenCollection | null>;
    openCollectionTracks: (owner: LuoxueCollectionOwner, collection: ProviderCollection) => Promise<void>;
    loadMoreCollectionTracks: (owner: LuoxueCollectionOwner) => Promise<void>;
    closeCollection: (owner: LuoxueCollectionOwner) => void;

    /** 浏览用的内置平台（搜索 / 排行榜 / 歌单都按它走，与当前音源脚本无关）。 */
    browsePlatform: string;
    /** 切浏览平台：清掉所有已加载的目录数据并重新加载（镜像 activeSource 小 store）。 */
    setBrowsePlatform: (id: string) => void;

    /** 当前音源脚本 id（来自 activeSource 小 store，这里镜像一份供组件订阅）。 */
    activeSourceId: string;
    selectSource: (id: string) => void;
    /** 切换音源后清掉所有已加载的目录数据，避免展示上一个音源的内容。 */
    handleSourceChanged: () => void;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const useLuoxueSectionStore = create<LuoxueSectionState>((set, get) => ({
    panel: 'search',
    // 切面板不再动别的状态：两块集合详情已按面板各记一份，面板本身也保持挂载（见 LuoxueSection），
    // 切走再切回来时打开着的榜单 / 歌单、分类标签、搜索结果都还在原处。
    setPanel: panel => {
        if (get().panel === panel) return;
        set({ panel });
    },

    query: '',
    setQuery: query => set({ query }),
    searchStatus: 'idle',
    searchResults: [],
    searchHasMore: false,
    searchOffset: 0,
    searchError: null,
    hotKeywords: [],
    hotStatus: 'idle',
    runSearch: async (query, options) => {
        // 「歌单」类别走另一条路：结果进 searchCollections，与单曲结果各存一份，互不覆盖。
        if (get().searchKind === 'songlist') {
            await get().runSongListSearch(query, options);
            return;
        }
        const keyword = (query ?? get().query).trim();
        if (!keyword) return;
        const append = Boolean(options?.append);
        const offset = append ? get().searchOffset : 0;
        // 翻页不记历史，只有真正发起一次新搜索才记。
        if (!append) get().pushSearchHistory(keyword);
        set({ query: keyword, searchStatus: 'loading', ...(append ? {} : { searchResults: [], searchOffset: 0, searchError: null }) });
        try {
            const page = await searchLuoxueSongs(keyword, { limit: PAGE_SIZE, offset });
            set(state => ({
                searchStatus: 'ready',
                searchResults: append ? [...state.searchResults, ...page.items] : page.items,
                searchOffset: offset + page.items.length,
                searchHasMore: page.hasMore,
                searchError: null,
            }));
        } catch (error) {
            set({ searchStatus: 'error', searchError: errorText(error) });
        }
    },
    searchKind: 'song',
    setSearchKind: kind => {
        if (get().searchKind === kind) return;
        set({ searchKind: kind });
        // 两类结果各留一份，切回来还在原处；已有现成关键词时顺手按新类别搜一次，免得停在空屏上等着再按回车。
        const keyword = get().query.trim();
        if (keyword) void get().runSearch(keyword);
    },
    searchCollections: [],
    searchCollectionsStatus: 'idle',
    searchCollectionsHasMore: false,
    searchCollectionsOffset: 0,
    searchCollectionsError: null,
    runSongListSearch: async (query, options) => {
        const keyword = (query ?? get().query).trim();
        if (!keyword) return;
        const append = Boolean(options?.append);
        const offset = append ? get().searchCollectionsOffset : 0;
        if (!append) get().pushSearchHistory(keyword);
        set({ query: keyword, searchCollectionsStatus: 'loading', ...(append ? {} : { searchCollections: [], searchCollectionsOffset: 0, searchCollectionsError: null }) });
        try {
            const page = await searchLuoxueSongLists(keyword, { limit: PAGE_SIZE, offset });
            set(state => ({
                searchCollectionsStatus: 'ready',
                searchCollections: append ? [...state.searchCollections, ...page.collections] : page.collections,
                searchCollectionsOffset: offset + page.collections.length,
                searchCollectionsHasMore: page.hasMore,
                searchCollectionsError: null,
            }));
        } catch (error) {
            set({ searchCollectionsStatus: 'error', searchCollectionsError: errorText(error) });
        }
    },
    loadHotKeywords: async () => {
        if (get().hotStatus === 'loading') return;
        set({ hotStatus: 'loading' });
        try {
            const keywords = await getLuoxueHotSearch();
            set({ hotKeywords: keywords, hotStatus: 'ready' });
        } catch {
            set({ hotKeywords: [], hotStatus: 'error' });
        }
    },

    searchHistory: readSearchHistory(),
    pushSearchHistory: keyword => {
        const text = keyword.trim();
        if (!text) return;
        const next = [text, ...get().searchHistory.filter(item => item !== text)].slice(0, SEARCH_HISTORY_LIMIT);
        writeSearchHistory(next);
        set({ searchHistory: next });
    },
    removeSearchHistory: keyword => {
        const next = get().searchHistory.filter(item => item !== keyword);
        writeSearchHistory(next);
        set({ searchHistory: next });
    },
    clearSearchHistory: () => {
        writeSearchHistory([]);
        set({ searchHistory: [] });
    },

    suggestKeywords: [],
    suggestStatus: 'idle',
    runSuggest: async keyword => {
        const text = keyword.trim();
        if (!text) {
            suggestRequestId += 1;
            set({ suggestKeywords: [], suggestStatus: 'idle' });
            return;
        }
        const requestId = ++suggestRequestId;
        set({ suggestStatus: 'loading' });
        const list = await getLuoxueSuggest(text);
        // 打字很快时晚发起的请求可能先回来：只认最后一次的结果。
        if (requestId !== suggestRequestId) return;
        set({ suggestKeywords: list, suggestStatus: 'ready' });
    },
    clearSuggest: () => {
        suggestRequestId += 1;
        set({ suggestKeywords: [], suggestStatus: 'idle' });
    },

    boards: [],
    boardsStatus: 'idle',
    loadBoards: async () => {
        set({ boardsStatus: 'loading' });
        try {
            const boards = await getLuoxueBoards();
            set({ boards, boardsStatus: 'ready' });
        } catch {
            set({ boards: [], boardsStatus: 'error' });
        }
    },

    songlistTagGroups: [],
    activeTagId: '',
    setActiveTagId: tagId => set({ activeTagId: tagId, songlists: [], songlistsOffset: 0, songlistsHasMore: false }),
    songlists: [],
    songlistsStatus: 'idle',
    songlistsHasMore: false,
    songlistsOffset: 0,
    loadSongListTags: async () => {
        try {
            // 分类是「分组 + 组内标签」两层（详见 luoxueCatalog 的 normalizeLuoxueSongListTagGroups）。
            const groups = await getLuoxueSongListTags();
            set({ songlistTagGroups: groups });
        } catch {
            set({ songlistTagGroups: [] });
        }
    },
    loadSongLists: async (options) => {
        const append = Boolean(options?.append);
        const offset = append ? get().songlistsOffset : 0;
        set({ songlistsStatus: 'loading', ...(append ? {} : { songlists: [], songlistsOffset: 0 }) });
        try {
            const result = await getLuoxueSongLists(get().activeTagId, { limit: PAGE_SIZE, offset });
            set(state => ({
                songlistsStatus: 'ready',
                songlists: append ? [...state.songlists, ...result.collections] : result.collections,
                songlistsOffset: offset + result.collections.length,
                songlistsHasMore: result.hasMore,
            }));
        } catch {
            set({ songlistsStatus: 'error' });
        }
    },

    openCollections: { boards: null, songlists: null, search: null },
    openCollectionTracks: async (owner, collection) => {
        set(state => ({ openCollections: { ...state.openCollections, [owner]: { collection, status: 'loading', tracks: [], hasMore: false, offset: 0 } } }));
        try {
            const page = await getLuoxueCollectionTracks(collection, { limit: PAGE_SIZE, offset: 0 });
            set(state => {
                const current = state.openCollections[owner];
                // 加载期间可能切了别的集合 / 关了详情：只更新仍是这次请求的那一份。
                if (!current || current.collection.id !== collection.id) return {};
                return { openCollections: { ...state.openCollections, [owner]: { ...current, status: 'ready', tracks: page.items, hasMore: page.hasMore, offset: page.items.length } } };
            });
        } catch {
            set(state => {
                const current = state.openCollections[owner];
                if (!current || current.collection.id !== collection.id) return {};
                return { openCollections: { ...state.openCollections, [owner]: { ...current, status: 'error' } } };
            });
        }
    },
    loadMoreCollectionTracks: async (owner) => {
        const current = get().openCollections[owner];
        if (!current || current.status === 'loading' || !current.hasMore) return;
        set(state => ({ openCollections: { ...state.openCollections, [owner]: { ...current, status: 'loading' } } }));
        try {
            const page = await getLuoxueCollectionTracks(current.collection, { limit: PAGE_SIZE, offset: current.offset });
            set(state => {
                const live = state.openCollections[owner];
                if (!live || live.collection.id !== current.collection.id) return {};
                return {
                    openCollections: {
                        ...state.openCollections,
                        [owner]: { ...live, status: 'ready', tracks: [...live.tracks, ...page.items], hasMore: page.hasMore, offset: live.offset + page.items.length },
                    },
                };
            });
        } catch {
            set(state => {
                const live = state.openCollections[owner];
                if (!live) return {};
                return { openCollections: { ...state.openCollections, [owner]: { ...live, status: 'error' } } };
            });
        }
    },
    closeCollection: owner => set(state => ({ openCollections: { ...state.openCollections, [owner]: null } })),

    browsePlatform: getBrowsePlatform(),
    setBrowsePlatform: (id) => {
        applyBrowsePlatform(id);
        get().handleSourceChanged();
    },

    activeSourceId: getActiveLuoxueSourceId(),
    selectSource: (id) => {
        setActiveLuoxueSourceId(id);
        get().handleSourceChanged();
    },
    handleSourceChanged: () => set({
        browsePlatform: getBrowsePlatform(),
        activeSourceId: getActiveLuoxueSourceId(),
        query: '',
        searchResults: [],
        searchStatus: 'idle',
        searchOffset: 0,
        searchHasMore: false,
        searchError: null,
        hotKeywords: [],
        hotStatus: 'idle',
        boards: [],
        boardsStatus: 'idle',
        songlists: [],
        songlistsStatus: 'idle',
        songlistsOffset: 0,
        songlistsHasMore: false,
        songlistTagGroups: [],
        activeTagId: '',
        openCollections: { boards: null, songlists: null, search: null },
        searchCollections: [],
        searchCollectionsStatus: 'idle',
        searchCollectionsOffset: 0,
        searchCollectionsHasMore: false,
        searchCollectionsError: null,
        suggestKeywords: [],
        suggestStatus: 'idle',
    }),
}));

/** 常用的字段选择器：整屏组件用它一次订阅需要的字段，避免每次渲染重建对象。 */
export const selectLuoxueSectionState = (state: LuoxueSectionState) => ({
    panel: state.panel,
    setPanel: state.setPanel,
    query: state.query,
    setQuery: state.setQuery,
    searchStatus: state.searchStatus,
    searchResults: state.searchResults,
    searchHasMore: state.searchHasMore,
    searchError: state.searchError,
    searchKind: state.searchKind,
    setSearchKind: state.setSearchKind,
    searchCollections: state.searchCollections,
    searchCollectionsStatus: state.searchCollectionsStatus,
    searchCollectionsHasMore: state.searchCollectionsHasMore,
    searchCollectionsError: state.searchCollectionsError,
    hotKeywords: state.hotKeywords,
    hotStatus: state.hotStatus,
    runSearch: state.runSearch,
    loadHotKeywords: state.loadHotKeywords,
    searchHistory: state.searchHistory,
    pushSearchHistory: state.pushSearchHistory,
    removeSearchHistory: state.removeSearchHistory,
    clearSearchHistory: state.clearSearchHistory,
    suggestKeywords: state.suggestKeywords,
    suggestStatus: state.suggestStatus,
    runSuggest: state.runSuggest,
    clearSuggest: state.clearSuggest,
    boards: state.boards,
    boardsStatus: state.boardsStatus,
    loadBoards: state.loadBoards,
    songlistTagGroups: state.songlistTagGroups,
    activeTagId: state.activeTagId,
    setActiveTagId: state.setActiveTagId,
    songlists: state.songlists,
    songlistsStatus: state.songlistsStatus,
    songlistsHasMore: state.songlistsHasMore,
    loadSongListTags: state.loadSongListTags,
    loadSongLists: state.loadSongLists,
    openCollections: state.openCollections,
    openCollectionTracks: state.openCollectionTracks,
    loadMoreCollectionTracks: state.loadMoreCollectionTracks,
    closeCollection: state.closeCollection,
    browsePlatform: state.browsePlatform,
    setBrowsePlatform: state.setBrowsePlatform,
    activeSourceId: state.activeSourceId,
    selectSource: state.selectSource,
});
