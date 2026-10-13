import { create } from 'zustand';
import type { SongResult } from '../types';
import type { OmniCollection } from '../types/onlineMusic';

// src/stores/useLxFavoritesStore.ts
// 自定义音源版块的「收藏」：把浏览到的洛雪歌曲收进自建列表（歌单），完全独立、非侵入。
// 另外支持「收藏整个歌单」——只保存歌单条目（OmniCollection 引用），点击可重新打开，不复制歌曲。
// 只落在 renderer 的 localStorage（键带 `lx-source:` 前缀），不碰 Folia 本地的曲库 / 歌单。

const STORAGE_KEY = 'lx-source:favorites:v1';

export type LxFavoriteList = {
    id: string;
    name: string;
    createdAt: number;
    /** 收藏的歌曲；保留整份 SongResult（含 sourceRef），播放 / 下载时脚本仍能解析直链。 */
    songs: SongResult[];
};

const isList = (value: unknown): value is LxFavoriteList => {
    const list = value as LxFavoriteList | null;
    return Boolean(list)
        && typeof list!.id === 'string'
        && typeof list!.name === 'string'
        && Array.isArray(list!.songs);
};

/** 收藏歌单的条目；保留整份 OmniCollection（含 providerId / providerData），点击可重新打开。 */
export type LxFavoritePlaylist = OmniCollection & { favoritedAt: number };

const isPlaylist = (value: unknown): value is LxFavoritePlaylist => {
    const item = value as LxFavoritePlaylist | null;
    return Boolean(item)
        && typeof item!.id === 'string'
        && typeof item!.providerId === 'string'
        && typeof item!.name === 'string';
};

const load = (): { lists: LxFavoriteList[]; playlists: LxFavoritePlaylist[] } => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { lists: [], playlists: [] };
        const parsed = JSON.parse(raw) as { lists?: unknown; playlists?: unknown };
        const lists = Array.isArray(parsed?.lists) ? parsed.lists : [];
        const playlists = Array.isArray(parsed?.playlists) ? parsed.playlists : [];
        return {
            lists: lists.filter(isList).map(list => ({
                ...list,
                createdAt: typeof list.createdAt === 'number' ? list.createdAt : Date.now(),
            })),
            // 旧版本没有 playlists 字段：按空数组处理，向后兼容。
            playlists: playlists.filter(isPlaylist).map(item => ({
                ...item,
                favoritedAt: typeof item.favoritedAt === 'number' ? item.favoritedAt : Date.now(),
            })),
        };
    } catch {
        // 数据损坏或不可用：当作空列表，不阻断版块。
        return { lists: [], playlists: [] };
    }
};

const persist = (state: { lists: LxFavoriteList[]; playlists: LxFavoritePlaylist[] }) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // 隐私模式 / 配额不足：放弃持久化，不影响当前会话。
    }
};

const makeId = () => `lx_list_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;

/** 列表重名时追加后缀：`名字 (2)` / `名字 (3)`…，保证导入不会覆盖已有列表。 */
const uniqueListName = (lists: LxFavoriteList[], name: string): string => {
    const taken = new Set(lists.map(list => list.name));
    if (!taken.has(name)) return name;
    let index = 2;
    while (taken.has(`${name} (${index})`)) index += 1;
    return `${name} (${index})`;
};

/** 歌曲 id 可能是数字，统一成字符串后作为去重键。 */
const songKey = (song: SongResult | undefined): string => (song?.id == null ? '' : String(song.id));

/** 按歌曲 id 去重（保留先出现的一条），无 id 的条目直接丢弃。 */
const dedupeSongs = (songs: SongResult[]): SongResult[] => {
    const seen = new Set<string>();
    const result: SongResult[] = [];
    for (const song of songs) {
        const key = songKey(song);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(song);
    }
    return result;
};

/** 歌单去重键：平台 + 歌单 id。 */
const playlistKey = (collection: Pick<OmniCollection, 'providerId' | 'id'>) => `${collection.providerId}:${collection.id}`;

const initial = load();

export type LxFavoritesState = {
    lists: LxFavoriteList[];
    playlists: LxFavoritePlaylist[];
    /** 新建一个列表；返回新列表 id。名称两端空白会被裁掉。 */
    createList: (name: string) => string | null;
    /**
     * 导入一个列表：`new` 新建列表（重名自动加后缀），`append` 并入已有列表并按歌曲 id 去重。
     * 返回 `{ listId, added, skipped }`：listId 为落库列表，added / skipped 为写入与被去重丢弃的数量。
     */
    importList: (
        name: string,
        songs: SongResult[],
        options?: { mode: 'new' | 'append'; listId?: string },
    ) => { listId: string; added: number; skipped: number };
    removeList: (listId: string) => void;
    renameList: (listId: string, name: string) => void;
    /** 把一首歌加入指定列表（已在则不动）。 */
    addSong: (listId: string, song: SongResult) => void;
    /** 从指定列表移除一首歌。 */
    removeSong: (listId: string, songId: SongResult['id']) => void;
    /** 在指定列表里加入 / 移除；返回操作后是否在列表中。 */
    toggleSongInList: (listId: string, song: SongResult) => boolean;
    /** 把一首歌从所有列表移除。 */
    removeSongEverywhere: (songId: SongResult['id']) => void;
    /** 收藏一个歌单条目（已在则不动）。 */
    addPlaylist: (collection: OmniCollection) => void;
    /** 移除一个收藏的歌单条目。 */
    removePlaylist: (collection: Pick<OmniCollection, 'id' | 'providerId'>) => void;
    /** 收藏 / 取消收藏；返回操作后是否已收藏。 */
    togglePlaylist: (collection: OmniCollection) => boolean;
    /** 该歌单是否已收藏。 */
    isPlaylistFavorited: (collection: Pick<OmniCollection, 'id' | 'providerId'>) => boolean;
};

export const useLxFavoritesStore = create<LxFavoritesState>((set, get) => {
    const commit = (lists: LxFavoriteList[]) => {
        const state = { lists, playlists: get().playlists };
        persist(state);
        set(state);
    };

    const commitPlaylists = (playlists: LxFavoritePlaylist[]) => {
        const state = { lists: get().lists, playlists };
        persist(state);
        set(state);
    };

    return {
        lists: initial.lists,
        playlists: initial.playlists,

        createList: (name) => {
            const trimmed = name.trim();
            if (!trimmed) return null;
            const list: LxFavoriteList = { id: makeId(), name: trimmed, createdAt: Date.now(), songs: [] };
            commit([...get().lists, list]);
            return list.id;
        },

        importList: (name, songs, options) => {
            const trimmed = name.trim() || '导入列表';
            const mode = options?.mode ?? 'new';
            if (mode === 'append' && options?.listId) {
                const target = get().lists.find(list => list.id === options.listId);
                if (target) {
                    const existing = new Set(target.songs.map(song => songKey(song)));
                    const fresh = dedupeSongs(songs).filter(song => !existing.has(songKey(song)));
                    commit(get().lists.map(list => (list.id === target.id
                        ? { ...list, songs: [...list.songs, ...fresh] }
                        : list)));
                    return { listId: target.id, added: fresh.length, skipped: songs.length - fresh.length };
                }
            }
            const deduped = dedupeSongs(songs);
            const list: LxFavoriteList = {
                id: makeId(),
                name: uniqueListName(get().lists, trimmed),
                createdAt: Date.now(),
                songs: deduped,
            };
            commit([...get().lists, list]);
            return { listId: list.id, added: deduped.length, skipped: songs.length - deduped.length };
        },

        removeList: (listId) => {
            commit(get().lists.filter(list => list.id !== listId));
        },

        renameList: (listId, name) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            commit(get().lists.map(list => (list.id === listId ? { ...list, name: trimmed } : list)));
        },

        addSong: (listId, song) => {
            commit(get().lists.map(list => (
                list.id === listId && !list.songs.some(item => item.id === song.id)
                    ? { ...list, songs: [...list.songs, song] }
                    : list
            )));
        },

        removeSong: (listId, songId) => {
            commit(get().lists.map(list => (
                list.id === listId ? { ...list, songs: list.songs.filter(item => item.id !== songId) } : list
            )));
        },

        toggleSongInList: (listId, song) => {
            const list = get().lists.find(item => item.id === listId);
            const exists = list?.songs.some(item => item.id === song.id) ?? false;
            if (exists) get().removeSong(listId, song.id);
            else get().addSong(listId, song);
            return !exists;
        },

        removeSongEverywhere: (songId) => {
            commit(get().lists.map(list => (
                list.songs.some(item => item.id === songId)
                    ? { ...list, songs: list.songs.filter(item => item.id !== songId) }
                    : list
            )));
        },

        addPlaylist: (collection) => {
            const key = playlistKey(collection);
            if (get().playlists.some(item => playlistKey(item) === key)) return;
            // 后收藏的排前面，最近用到的歌单更容易点。
            commitPlaylists([{ ...collection, favoritedAt: Date.now() }, ...get().playlists]);
        },

        removePlaylist: (collection) => {
            const key = playlistKey(collection);
            commitPlaylists(get().playlists.filter(item => playlistKey(item) !== key));
        },

        togglePlaylist: (collection) => {
            const key = playlistKey(collection);
            const exists = get().playlists.some(item => playlistKey(item) === key);
            if (exists) get().removePlaylist(collection);
            else get().addPlaylist(collection);
            return !exists;
        },

        isPlaylistFavorited: (collection) => {
            const key = playlistKey(collection);
            return get().playlists.some(item => playlistKey(item) === key);
        },
    };
});
