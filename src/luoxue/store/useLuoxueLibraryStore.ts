import { create } from 'zustand';
import type { SongResult } from '../../types';

// src/luoxue/store/useLuoxueLibraryStore.ts
// 洛雪版块自己的「我的列表」：收藏（默认「我的收藏」+ 用户自建列表）、播放历史，以及收藏的歌单快照。只保存洛雪歌曲（节点自带的 lx 附加信息），
// 与 folia 原本的收藏体系互不干扰——这样移植过来的功能有地方落，也不会改动 folia 已有的任何行为。
// 持久化走 localStorage，键独立。

const STORAGE_KEY = 'luoxue_my_list';
const HISTORY_LIMIT = 200;

/**
 * 收藏的「歌单」本身（不是它里面的歌曲）：一份本地快照 —— 元信息 + 收藏那一刻的曲目。
 * 收录后不再跟随上游更新，想同步就用「更新」重新拉一次（见 saveCollection 的 refreshed）。
 */
export type LuoxueSavedCollection = {
    /** 本地 id（与上游集合 id 分开，便于同上游多个快照/改名）。 */
    id: string;
    /** 上游集合 id。 */
    collectionId: string;
    /** 集合所属音源（kw / wy / user_api_xxx…）。 */
    lxSource: string;
    /** 集合类型：歌单或排行榜。 */
    kind: 'songlist' | 'leaderboard';
    name: string;
    coverUrl?: string;
    publisher?: string;
    /** 首次收藏时间。 */
    savedAt: number;
    /** 最近一次更新快照的时间（未更新过时等于 savedAt）。 */
    updatedAt: number;
    /** 收藏那一刻的曲目快照。 */
    songs: SongResult[];
};

/** 收藏 / 更新歌单快照时传入的元信息（曲目另行传）。 */
export type LuoxueSavedCollectionMeta = {
    collectionId: string;
    lxSource: string;
    kind: 'songlist' | 'leaderboard';
    name: string;
    coverUrl?: string;
    publisher?: string;
};

/** saveCollection 的结果：是否更新了已有快照、快照里有多少首。 */
export type LuoxueSaveCollectionResult = { id: string; refreshed: boolean; total: number };

/**
 * 用户自建的收藏列表（收藏单曲用）。默认那份「我的收藏」不在这里，它就是 favorites 本身；
 * 这里只放用户后来新建的列表。
 */
export type LuoxueUserList = {
    id: string;
    name: string;
    songs: SongResult[];
    createdAt: number;
};

type PersistedShape = {
    favorites: SongResult[];
    history: SongResult[];
    lists: LuoxueUserList[];
    collections: LuoxueSavedCollection[];
};

/** 歌曲的唯一键：同音源下按 mediaId 去重（同名不同音源算两首）。 */
export const luoxueSongKey = (song: SongResult): string => {
    const providerId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : '';
    const mediaId = song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id;
    return `${providerId}:${String(mediaId)}`;
};

/**
 * 收藏歌单的唯一键：同音源 + 同类型 + 同上游 id 视为同一个歌单（再收藏即更新快照）。
 * 传入来源信息（`id`）或已收藏条目（`collectionId`）都可以：后者优先。
 */
export const luoxueCollectionKey = (item: { lxSource: string; kind: string; collectionId?: string; id?: string }): string =>
    `${item.lxSource}:${item.kind}:${item.collectionId ?? item.id ?? ''}`;

/** 整批去重（收藏歌单快照时用，快照本身不需要保留原顺序以外的东西）。 */
const dedupeSongs = (songs: SongResult[]): SongResult[] => {
    const seen = new Set<string>();
    const result: SongResult[] = [];
    for (const song of songs) {
        if (!song) continue;
        const key = luoxueSongKey(song);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(song);
    }
    return result;
};

const readPersisted = (): PersistedShape => {
    const empty: PersistedShape = { favorites: [], history: [], lists: [], collections: [] };
    if (typeof window === 'undefined') return empty;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return empty;
        const parsed = JSON.parse(raw) as Partial<PersistedShape>;
        return {
            favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
            history: Array.isArray(parsed.history) ? parsed.history : [],
            // 只保留形状完整的自建列表条目。
            lists: Array.isArray(parsed.lists)
                ? parsed.lists.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.songs))
                : [],
            // 老存档没有收藏的歌单；只保留形状完整的条目。
            collections: Array.isArray(parsed.collections)
                ? parsed.collections.filter(item => (
                    item
                    && typeof item.id === 'string'
                    && typeof item.collectionId === 'string'
                    && typeof item.lxSource === 'string'
                    && (item.kind === 'songlist' || item.kind === 'leaderboard')
                    && Array.isArray(item.songs)
                ))
                : [],
        };
    } catch {
        return empty;
    }
};

const persist = (data: PersistedShape): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        // 存储不可用时只保留内存里的状态
    }
};

let collectionSeq = 0;
const makeCollectionId = (): string => `lxcol_${Date.now().toString(36)}_${(collectionSeq += 1)}`;

let listSeq = 0;
const makeListId = (): string => `lxlist_${Date.now().toString(36)}_${(listSeq += 1)}`;

type LuoxueLibraryState = {
    favorites: SongResult[];
    history: SongResult[];
    /** 用户自建的收藏列表（默认那份「我的收藏」见 favorites）。 */
    lists: LuoxueUserList[];
    /** 收藏的歌单（本地快照，不随上游更新）。 */
    collections: LuoxueSavedCollection[];
    toggleFavorite: (song: SongResult) => boolean;
    isFavorite: (song: SongResult) => boolean;
    removeFavorite: (song: SongResult) => void;
    /** 从「我的收藏」里批量删除（多选删除用）。 */
    removeFavoriteSongs: (keys: string[]) => void;
    clearFavorites: () => void;
    /** 新建一个收藏列表，返回新列表 id（名称为空时给一个默认名）。 */
    createList: (name: string) => string;
    renameList: (id: string, name: string) => void;
    removeList: (id: string) => void;
    /** 把一首歌加进 / 移出某个自建列表；返回操作后是否在该列表里。 */
    toggleSongInList: (id: string, song: SongResult) => boolean;
    /** 从某个自建列表里批量删除（多选删除用）。 */
    removeUserListSongs: (id: string, keys: string[]) => void;
    pushHistory: (song: SongResult) => void;
    clearHistory: () => void;
    /** 从播放历史里删除若干首（按唯一键批量删）。 */
    removeHistorySongs: (keys: string[]) => void;
    /**
     * 收藏一个歌单（保存快照）：同一个上游歌单再次收藏即更新快照（覆盖为本次拉到的曲目）。
     * 曲目会去重；返回本地 id、是否属于更新、快照里的曲目数。
     */
    saveCollection: (meta: LuoxueSavedCollectionMeta, songs: SongResult[]) => LuoxueSaveCollectionResult;
    removeCollection: (id: string) => void;
    /** 删除收藏歌单里的若干首（按唯一键批量删），不改动上游歌单本身。 */
    removeCollectionSongs: (id: string, keys: string[]) => void;
};

export const useLuoxueLibraryStore = create<LuoxueLibraryState>((set, get) => {
    const initial = readPersisted();
    /** 所有写入都经它落盘，避免某个动作漏掉字段把别的数据写没了。 */
    const save = (patch: Partial<PersistedShape>): void => persist({
        favorites: patch.favorites ?? get().favorites,
        history: patch.history ?? get().history,
        lists: patch.lists ?? get().lists,
        collections: patch.collections ?? get().collections,
    });
    return {
        favorites: initial.favorites,
        history: initial.history,
        lists: initial.lists,
        collections: initial.collections,
        toggleFavorite: (song) => {
            const key = luoxueSongKey(song);
            const exists = get().favorites.some(item => luoxueSongKey(item) === key);
            const favorites = exists
                ? get().favorites.filter(item => luoxueSongKey(item) !== key)
                : [song, ...get().favorites];
            set({ favorites });
            save({ favorites });
            return !exists;
        },
        isFavorite: (song) => {
            const key = luoxueSongKey(song);
            return get().favorites.some(item => luoxueSongKey(item) === key);
        },
        removeFavorite: (song) => {
            const key = luoxueSongKey(song);
            const favorites = get().favorites.filter(item => luoxueSongKey(item) !== key);
            set({ favorites });
            save({ favorites });
        },
        removeFavoriteSongs: (keys) => {
            const drop = new Set(keys);
            if (drop.size === 0) return;
            const favorites = get().favorites.filter(song => !drop.has(luoxueSongKey(song)));
            set({ favorites });
            save({ favorites });
        },
        clearFavorites: () => {
            set({ favorites: [] });
            save({ favorites: [] });
        },
        createList: (name) => {
            const id = makeListId();
            const list: LuoxueUserList = {
                id,
                name: name.trim() || `新建列表 ${get().lists.length + 1}`,
                songs: [],
                createdAt: Date.now(),
            };
            const lists = [...get().lists, list];
            set({ lists });
            save({ lists });
            return id;
        },
        renameList: (id, name) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            const lists = get().lists.map(list => (list.id === id ? { ...list, name: trimmed } : list));
            set({ lists });
            save({ lists });
        },
        removeList: (id) => {
            const lists = get().lists.filter(list => list.id !== id);
            set({ lists });
            save({ lists });
        },
        toggleSongInList: (id, song) => {
            const key = luoxueSongKey(song);
            let added = false;
            const lists = get().lists.map(list => {
                if (list.id !== id) return list;
                const exists = list.songs.some(item => luoxueSongKey(item) === key);
                added = !exists;
                return exists
                    ? { ...list, songs: list.songs.filter(item => luoxueSongKey(item) !== key) }
                    : { ...list, songs: [song, ...list.songs] };
            });
            set({ lists });
            save({ lists });
            return added;
        },
        removeUserListSongs: (id, keys) => {
            const drop = new Set(keys);
            if (drop.size === 0) return;
            let changed = false;
            const lists = get().lists.map(list => {
                if (list.id !== id) return list;
                const songs = list.songs.filter(song => !drop.has(luoxueSongKey(song)));
                if (songs.length === list.songs.length) return list;
                changed = true;
                return { ...list, songs };
            });
            if (!changed) return;
            set({ lists });
            save({ lists });
        },
        pushHistory: (song) => {
            const key = luoxueSongKey(song);
            const history = [song, ...get().history.filter(item => luoxueSongKey(item) !== key)].slice(0, HISTORY_LIMIT);
            set({ history });
            save({ history });
        },
        clearHistory: () => {
            set({ history: [] });
            save({ history: [] });
        },
        removeHistorySongs: (keys) => {
            const drop = new Set(keys);
            if (drop.size === 0) return;
            const history = get().history.filter(song => !drop.has(luoxueSongKey(song)));
            set({ history });
            save({ history });
        },
        saveCollection: (meta, songs) => {
            const snapshot = dedupeSongs(songs);
            const key = luoxueCollectionKey(meta);
            const now = Date.now();
            const existing = get().collections.find(item => luoxueCollectionKey(item) === key);
            if (existing) {
                // 已收藏过 → 覆盖为本次拉到的曲目（这就是「更新」），元信息一并刷新。
                const collections = get().collections.map(item => (
                    item.id === existing.id
                        ? {
                            ...item,
                            name: meta.name || item.name,
                            coverUrl: meta.coverUrl ?? item.coverUrl,
                            publisher: meta.publisher ?? item.publisher,
                            updatedAt: now,
                            songs: snapshot,
                        }
                        : item
                ));
                set({ collections });
                save({ collections });
                return { id: existing.id, refreshed: true, total: snapshot.length };
            }
            const id = makeCollectionId();
            const collections: LuoxueSavedCollection[] = [
                {
                    id,
                    collectionId: meta.collectionId,
                    lxSource: meta.lxSource,
                    kind: meta.kind,
                    name: meta.name,
                    coverUrl: meta.coverUrl,
                    publisher: meta.publisher,
                    savedAt: now,
                    updatedAt: now,
                    songs: snapshot,
                },
                ...get().collections,
            ];
            set({ collections });
            save({ collections });
            return { id, refreshed: false, total: snapshot.length };
        },
        removeCollection: (id) => {
            const collections = get().collections.filter(item => item.id !== id);
            set({ collections });
            save({ collections });
        },
        removeCollectionSongs: (id, keys) => {
            const drop = new Set(keys);
            if (drop.size === 0) return;
            let changed = false;
            const collections = get().collections.map(item => {
                if (item.id !== id) return item;
                const songs = item.songs.filter(song => !drop.has(luoxueSongKey(song)));
                if (songs.length === item.songs.length) return item;
                changed = true;
                return { ...item, songs };
            });
            if (!changed) return;
            set({ collections });
            save({ collections });
        },
    };
});

export const selectLuoxueFavorites = (state: LuoxueLibraryState) => state.favorites;
export const selectLuoxueHistory = (state: LuoxueLibraryState) => state.history;
export const selectLuoxueUserLists = (state: LuoxueLibraryState) => state.lists;
export const selectLuoxueSavedCollections = (state: LuoxueLibraryState) => state.collections;
