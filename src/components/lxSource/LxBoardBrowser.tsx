import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Download, History, ListMusic, Loader2, Music2, Play, Search, Star, X } from 'lucide-react';
import type { SongResult } from '../../types';
import type { AudioQualityPreference, OmniCollection } from '../../types/onlineMusic';
import { omni } from '../../services/onlineMusic/omni';
import { lxMusicInfoFromSourceRef } from '../../services/lxSource/lxNormalize';
import { callLxSource } from '../../services/lxSource/lxSourceTransport';
import { useLxDownloadStore } from '../../stores/useLxDownloadStore';
import { useLxFavoritesStore } from '../../stores/useLxFavoritesStore';
import { useLxSearchHistoryStore } from '../../stores/useLxSearchHistoryStore';
import { useLxBrowseMemoryStore, type LxBrowseMode } from '../../stores/useLxBrowseMemoryStore';
import { useLxPlaybackQualityStore } from '../../stores/useLxPlaybackQualityStore';
import { clearPrefetchRuntime } from '../../services/prefetchService';
import { useLxSourceStore } from '../../services/lxSource/lxSourceStore';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { LxFavoritePicker } from './LxFavoritePicker';

// src/components/lxSource/LxBoardBrowser.tsx
// 自定义音源版块的在线浏览区：酷我 / 咪咕榜单、歌单与搜索。
// 在线数据一律经 omni 读取（架构约束），播放由父层注入 onPlaySong，下载交 useLxDownloadStore。

type Props = {
    isDaylight: boolean;
    accentColor: string;
    /** 播放注入：与 Lattice 一致，队列就是当前列表。 */
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
};

type LxPlatform = { providerId: string; label: string };

/** 已移植的平台，与 lxRegistration / musicSdk 保持一致。 */
const LX_PLATFORMS: LxPlatform[] = [
    { providerId: 'lx-kw', label: '酷我音乐' },
    { providerId: 'lx-mg', label: '咪咕音乐' },
    { providerId: 'lx-kg', label: '酷狗音乐' },
    { providerId: 'lx-tx', label: 'QQ音乐' },
    { providerId: 'lx-wy', label: '网易云音乐' },
];

/** 下载音质选项：Folia 的统一偏好 ↔ 洛雪脚本使用的音质标识。 */
const QUALITY_OPTIONS: Array<{ value: AudioQualityPreference; labelKey: string; lx: string }> = [
    { value: 'standard', labelKey: 'account.qualityStandard', lx: '128k' },
    { value: 'high', labelKey: 'account.qualityExhigh', lx: '320k' },
    { value: 'lossless', labelKey: 'account.qualityLossless', lx: 'flac' },
    { value: 'hires', labelKey: 'account.qualityHires', lx: 'flac24bit' },
];

const TRACK_PAGE_SIZE = 50;
const SEARCH_PAGE_SIZE = 30;
const SUGGEST_DEBOUNCE_MS = 250;
const SUGGEST_MAX_ITEMS = 10;

const PANEL = 'rounded-2xl border backdrop-blur-sm';
const panelTone = (isDaylight: boolean) => (isDaylight
    ? 'border-black/5 bg-white/70'
    : 'border-white/10 bg-white/5');

/** providerId（lx-kw）→ 洛雪脚本使用的平台标识（kw）。 */
const lxSourceIdOf = (providerId: string): string => providerId.replace(/^lx-/, '');

const formatDuration = (durationMs: number): string => {
    if (!durationMs || durationMs <= 0) return '--/--';
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const artistNames = (song: SongResult): string => song.artists.map(artist => artist.name).join('、');

/** 一段可复用的曲目列表：整列播放 + 逐行播放，行尾给出时长与下载入口。 */
const TrackList: React.FC<{
    tracks: SongResult[];
    isDaylight: boolean;
    accentColor: string;
    onPlaySong: Props['onPlaySong'];
    onDownload?: (song: SongResult) => void;
    onFavorite?: (song: SongResult) => void;
}> = ({ tracks, isDaylight, accentColor, onPlaySong, onDownload, onFavorite }) => {
    const { t } = useTranslation();
    // 一首歌可能被收进多个列表；这里只关心「有没有被收藏」，用于点亮星标。
    const lists = useLxFavoritesStore(state => state.lists);
    const favoritedIds = useMemo(() => {
        const ids = new Set<SongResult['id']>();
        for (const list of lists) for (const item of list.songs) ids.add(item.id);
        return ids;
    }, [lists]);
    return (
    <ul className="flex flex-col">
        {tracks.map((song, index) => (
            <li
                key={`${song.id}-${index}`}
                className={`group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors ${isDaylight
                    ? 'hover:bg-black/5'
                    : 'hover:bg-white/5'}`}
            >
                <button
                    type="button"
                    onClick={() => onPlaySong(song, tracks)}
                    aria-label={song.name}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                    <span className={`w-6 shrink-0 text-right text-xs tabular-nums ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`}>
                        {index + 1}
                    </span>
                    <span className={`h-9 w-9 shrink-0 overflow-hidden rounded-md ${isDaylight ? 'bg-black/5' : 'bg-white/10'}`}>
                        {song.album?.coverUrl && (
                            <img src={song.album.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        )}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${isDaylight ? 'text-zinc-800' : 'text-white/90'}`}>
                            {song.name}
                        </span>
                        <span className={`block truncate text-xs ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                            {artistNames(song)}
                        </span>
                    </span>
                    <span className={`shrink-0 text-xs tabular-nums ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`}>
                        {formatDuration(song.durationMs)}
                    </span>
                </button>
                {onFavorite && (
                    <button
                        type="button"
                        onClick={() => onFavorite(song)}
                        aria-label={t('lxSource.favorite')}
                        title={t('lxSource.favorite')}
                        className={`shrink-0 rounded-full p-1.5 transition-opacity ${favoritedIds.has(song.id)
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100'} ${isDaylight
                            ? 'text-zinc-500 hover:bg-black/5'
                            : 'text-white/60 hover:bg-white/10'}`}
                        style={favoritedIds.has(song.id) ? { color: accentColor } : undefined}
                    >
                        <Star size={13} fill={favoritedIds.has(song.id) ? 'currentColor' : 'none'} />
                    </button>
                )}
                {onDownload && (
                    <button
                        type="button"
                        onClick={() => onDownload(song)}
                        aria-label={t('lxSource.download')}
                        className={`shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${isDaylight
                            ? 'text-zinc-500 hover:bg-black/5'
                            : 'text-white/60 hover:bg-white/10'}`}
                    >
                        <Download size={13} />
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => onPlaySong(song, tracks)}
                    aria-label={song.name}
                    className="shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ backgroundColor: accentColor, color: '#fff' }}
                >
                    <Play size={12} fill="currentColor" />
                </button>
            </li>
        ))}
    </ul>
    );
};

export const LxBoardBrowser: React.FC<Props> = ({ isDaylight, accentColor, onPlaySong }) => {
    const { t } = useTranslation();
    const startDownload = useLxDownloadStore(state => state.start);
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    const history = useLxSearchHistoryStore(state => state.items);
    const addHistory = useLxSearchHistoryStore(state => state.add);
    const removeHistory = useLxSearchHistoryStore(state => state.remove);
    const clearHistory = useLxSearchHistoryStore(state => state.clear);
    const rememberMode = useLxBrowseMemoryStore(state => state.rememberMode);
    const rememberCollection = useLxBrowseMemoryStore(state => state.rememberCollection);
    const forgetCollection = useLxBrowseMemoryStore(state => state.forgetCollection);
    const rememberProvider = useLxBrowseMemoryStore(state => state.rememberProvider);
    const patchSnapshot = useLxBrowseMemoryStore(state => state.patchSnapshot);
    const pendingOpen = useLxBrowseMemoryStore(state => state.pendingOpen);
    const consumePendingOpen = useLxBrowseMemoryStore(state => state.consumePendingOpen);
    const favoritesPlaylists = useLxFavoritesStore(state => state.playlists);
    const togglePlaylist = useLxFavoritesStore(state => state.togglePlaylist);
    const playbackQuality = useLxPlaybackQualityStore(state => state.playbackQuality);
    const setPlaybackQuality = useLxPlaybackQualityStore(state => state.setPlaybackQuality);
    const lxSourceStatus = useLxSourceStore(state => state.status);

    // 平台订阅 store 的 lastProviderId：切平台、以及「从收藏打开歌单」改平台，都只需改这一处。
    const lastProviderId = useLxBrowseMemoryStore(state => state.lastProviderId);
    const providerId = lastProviderId && LX_PLATFORMS.some(platform => platform.providerId === lastProviderId)
        ? lastProviderId
        : LX_PLATFORMS[0].providerId;

    // 视图（榜单 / 搜索）按平台记忆：默认落在该平台的记忆值上。
    const [mode, setMode] = useState<LxBrowseMode>(() => {
        const store = useLxBrowseMemoryStore.getState();
        const last = store.lastProviderId;
        const initialProvider = last && LX_PLATFORMS.some(platform => platform.providerId === last)
            ? last
            : LX_PLATFORMS[0].providerId;
        return store.byPlatform[initialProvider]?.mode ?? 'boards';
    });
    // 下载音质：默认跟随全局偏好，可在此单独选择；只列出当前平台脚本声明支持的那些。
    const [downloadQuality, setDownloadQuality] = useState<AudioQualityPreference>(audioQuality);

    const supportedQualityIds = lxSourceStatus?.sources?.[lxSourceIdOf(providerId)]?.qualitys ?? [];

    const [boards, setBoards] = useState<OmniCollection[]>([]);
    const [boardsLoading, setBoardsLoading] = useState(false);
    const [boardsError, setBoardsError] = useState(false);
    const [boardsLoaded, setBoardsLoaded] = useState(false);

    const [openCollection, setOpenCollection] = useState<OmniCollection | null>(null);
    const [tracks, setTracks] = useState<SongResult[]>([]);
    const [tracksLoading, setTracksLoading] = useState(false);
    const [tracksError, setTracksError] = useState(false);
    const [hasMore, setHasMore] = useState(false);

    const [query, setQuery] = useState('');
    const [searchKind, setSearchKind] = useState<'songs' | 'playlists'>('songs');
    const [results, setResults] = useState<SongResult[]>([]);
    const [playlistResults, setPlaylistResults] = useState<OmniCollection[]>([]);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [searchError, setSearchError] = useState(false);
    // 「收藏到…」浮层当前针对的歌曲；null 表示未打开。
    const [favoriteSong, setFavoriteSong] = useState<SongResult | null>(null);
    // 搜索联想：平台联想词 + 输入框下拉是否展开。
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [suggestOpen, setSuggestOpen] = useState(false);
    // 下拉里用上下键高亮的项；-1 表示未选中（此时回车就是直接搜索）。
    const [suggestIndex, setSuggestIndex] = useState(-1);
    // 高亮项滚动进可视区用。
    const activeSuggestRef = useRef<HTMLLIElement | null>(null);

    const mutedText = isDaylight ? 'text-zinc-500' : 'text-white/50';
    const strongText = isDaylight ? 'text-zinc-900' : 'text-white';

    // 播放能力取决于音源是否已启用；provider 未注册（尚未初始化）时按不可播放处理，避免渲染抛错。
    const [canPlay, setCanPlay] = useState(false);
    useEffect(() => {
        const refresh = () => {
            try {
                setCanPlay(omni.getProviderAvailability(providerId).configured);
            } catch {
                setCanPlay(false);
            }
        };
        refresh();
        return omni.subscribeProviders(refresh);
    }, [providerId]);

    const loadBoards = useCallback(async () => {
        setBoardsLoading(true);
        setBoardsError(false);
        try {
            setBoards(await omni.getLeaderboards(providerId));
            setBoardsLoaded(true);
        } catch {
            setBoards([]);
            setBoardsError(true);
        } finally {
            setBoardsLoading(false);
        }
    }, [providerId]);

    useEffect(() => {
        if (mode === 'boards' && !openCollection && !boardsLoaded) void loadBoards();
    }, [mode, openCollection, boardsLoaded, loadBoards]);

    // 打开一个集合（榜单 / 歌单）并拉第一页曲目。顺手记下它是这个平台「最后打开的那个」，切平台后可复位。
    const openTracks = useCallback(async (collection: OmniCollection) => {
        rememberCollection(providerId, collection);
        setOpenCollection(collection);
        setTracks([]);
        setTracksError(false);
        setTracksLoading(true);
        try {
            const page = await omni.getCollectionTracks(collection, { limit: TRACK_PAGE_SIZE, offset: 0 });
            setTracks(page.items);
            setHasMore(page.hasMore);
        } catch {
            setTracksError(true);
            setHasMore(false);
        } finally {
            setTracksLoading(false);
        }
    }, [providerId, rememberCollection]);

    // 切换榜单 / 搜索：记进该平台的记忆（切平台或离开再回来时复位到同一个视图）。
    const selectMode = useCallback((next: LxBrowseMode) => {
        setMode(next);
        rememberMode(providerId, next);
    }, [providerId, rememberMode]);

    // 平台归属标记：本地 state 属于哪个平台。用它区分「平台变了要水合」与「同平台的普通状态变更要回写快照」。
    const snapshotOwnerRef = useRef<string | null>(null);
    // 平台切换 / 首次挂载：优先用该平台的会话快照水合（结果 / 打开的歌单 / 曲目全都命中缓存，不重复请求）；
    // 没有快照时按记忆复位视图，并在记忆里有集合时打开它（无论榜单还是搜索视图）。同一平台的普通状态变更则回写快照。
    useEffect(() => {
        if (snapshotOwnerRef.current === providerId) {
            patchSnapshot(providerId, {
                mode, query, searchKind, searched, results, playlistResults,
                boards, boardsLoaded, tracks, hasMore, collection: openCollection,
            });
            return;
        }
        snapshotOwnerRef.current = providerId;
        const store = useLxBrowseMemoryStore.getState();
        const snapshot = store.getSnapshot(providerId);
        setBoardsError(false);
        setTracksError(false);
        setSearchError(false);
        if (snapshot) {
            setMode(snapshot.mode);
            setQuery(snapshot.query);
            setSearchKind(snapshot.searchKind);
            setSearched(snapshot.searched);
            setResults(snapshot.results);
            setPlaylistResults(snapshot.playlistResults);
            setBoards(snapshot.boards);
            setBoardsLoaded(snapshot.boardsLoaded);
            setOpenCollection(snapshot.collection);
            setTracks(snapshot.tracks);
            setHasMore(snapshot.hasMore);
            // 打开着歌单却没有曲目缓存（例如刚被收藏页指定打开）→ 补拉第一页。
            if (snapshot.collection && snapshot.tracks.length === 0) void openTracks(snapshot.collection);
            return;
        }
        const memory = store.byPlatform[providerId];
        setBoards([]);
        setBoardsLoaded(false);
        setOpenCollection(null);
        setTracks([]);
        setMode(memory?.mode ?? 'boards');
        if (memory?.collection) void openTracks(memory.collection);
    }, [providerId, mode, query, searchKind, searched, results, playlistResults, boards, boardsLoaded, tracks, hasMore, openCollection, patchSnapshot, openTracks]);

    // 「从收藏打开歌单」：一次性请求。同平台直接打开；跨平台先记进记忆与快照，由上面的水合逻辑打开。
    useEffect(() => {
        if (!pendingOpen) return;
        const target = pendingOpen;
        consumePendingOpen();
        const targetProvider = LX_PLATFORMS.some(platform => platform.providerId === target.providerId)
            ? target.providerId
            : providerId;
        rememberCollection(targetProvider, target);
        patchSnapshot(targetProvider, { collection: target, tracks: [], hasMore: false });
        if (targetProvider !== providerId) rememberProvider(targetProvider);
        else void openTracks(target);
    }, [pendingOpen, consumePendingOpen, rememberCollection, rememberProvider, patchSnapshot, providerId, openTracks]);

    const loadMoreTracks = useCallback(async () => {
        if (!openCollection || tracksLoading) return;
        setTracksLoading(true);
        try {
            const page = await omni.getCollectionTracks(openCollection, { limit: TRACK_PAGE_SIZE, offset: tracks.length });
            setTracks(prev => [...prev, ...page.items]);
            setHasMore(page.hasMore);
        } catch {
            setTracksError(true);
        } finally {
            setTracksLoading(false);
        }
    }, [openCollection, tracks.length, tracksLoading]);

    const runSearch = useCallback(async (keywordArg?: string) => {
        const keyword = (keywordArg ?? query).trim();
        if (!keyword) return;
        setSuggestOpen(false);
        setSuggestIndex(-1);
        addHistory(keyword);
        setOpenCollection(null);
        setTracks([]);
        setSearching(true);
        setSearchError(false);
        setSearched(true);
        try {
            if (searchKind === 'songs') {
                const page = await omni.searchProviderSongs(providerId, keyword, { limit: SEARCH_PAGE_SIZE, offset: 0 });
                setResults(page.items);
                setPlaylistResults([]);
            } else {
                const page = await omni.searchProviderPlaylists(providerId, keyword, { limit: SEARCH_PAGE_SIZE, offset: 0 });
                setPlaylistResults(page.items);
                setResults([]);
            }
        } catch {
            setResults([]);
            setPlaylistResults([]);
            setSearchError(true);
        } finally {
            setSearching(false);
        }
    }, [providerId, query, searchKind, addHistory]);

    // 搜索联想：输入防抖后拉本平台的真实联想接口；失败 / 为空则只展示本地搜索历史匹配。
    useEffect(() => {
        const keyword = query.trim();
        if (!keyword) {
            setSuggestions([]);
            return;
        }
        let active = true;
        const timer = window.setTimeout(() => {
            void callLxSource(providerId, bridge => bridge.searchSuggestions({
                source: lxSourceIdOf(providerId),
                query: keyword,
            })).then(list => {
                if (active) setSuggestions(Array.isArray(list) ? list : []);
            }).catch(() => {
                if (active) setSuggestions([]);
            });
        }, SUGGEST_DEBOUNCE_MS);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [query, providerId]);

    // 下拉候选 = 平台联想词（在前）+ 命中关键词的本地搜索历史（去重、封顶）。
    const suggestionItems = useMemo(() => {
        const keyword = query.trim();
        if (!keyword) return [];
        const lower = keyword.toLowerCase();
        const historySet = new Set(history);
        const localMatches = history.filter(item => item.toLowerCase().includes(lower));
        const merged: string[] = [];
        for (const item of [...suggestions, ...localMatches]) {
            if (!item || item === keyword || merged.includes(item)) continue;
            merged.push(item);
            if (merged.length >= SUGGEST_MAX_ITEMS) break;
        }
        return merged.map(item => ({ value: item, fromHistory: historySet.has(item) }));
    }, [suggestions, history, query]);

    // 联想结果异步刷新后可能变短，越界的高亮位置按「未选中」处理。
    const activeSuggestIndex = suggestIndex >= 0 && suggestIndex < suggestionItems.length ? suggestIndex : -1;

    // 高亮项超出下拉可视区时跟随滚动，保证上下键选中项始终可见。
    useEffect(() => {
        activeSuggestRef.current?.scrollIntoView({ block: 'nearest' });
    }, [activeSuggestIndex]);

    const closeSuggest = () => {
        setSuggestOpen(false);
        setSuggestIndex(-1);
    };

    // 输入框键盘操作：上下键在联想结果里移动高亮，回车选中高亮项（没有高亮则按原关键词搜索），Esc 收起下拉。
    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const open = suggestOpen && suggestionItems.length > 0;
        if (event.key === 'ArrowDown' && open) {
            event.preventDefault();
            setSuggestIndex(current => (current + 1) % suggestionItems.length);
            return;
        }
        if (event.key === 'ArrowUp' && open) {
            event.preventDefault();
            setSuggestIndex(current => (current <= 0 ? suggestionItems.length - 1 : current - 1));
            return;
        }
        if (event.key === 'Escape') {
            if (suggestOpen) {
                event.preventDefault();
                closeSuggest();
            }
            return;
        }
        if (event.key === 'Enter') {
            const picked = activeSuggestIndex >= 0 ? suggestionItems[activeSuggestIndex] : undefined;
            if (picked) {
                event.preventDefault();
                setQuery(picked.value);
                void runSearch(picked.value);
                closeSuggest();
                return;
            }
            void runSearch();
        }
    };

    // 下载入口：从歌曲 sourceRef 取回脚本要的 { source, musicInfo }，音质用界面上选定的下载音质。
    const handleDownload = useCallback((song: SongResult) => {
        const ref = song.sourceRef;
        if (ref?.kind !== 'online') return;
        const { source, musicInfo } = lxMusicInfoFromSourceRef(ref.providerData);
        if (!source) return;
        void startDownload(
            { source, musicInfo: musicInfo as Record<string, unknown>, name: song.name, artist: artistNames(song) },
            downloadQuality,
        );
    }, [startDownload, downloadQuality]);

    const tabClass = (active: boolean) => `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active
        ? 'text-white'
        : (isDaylight ? 'text-zinc-500 hover:bg-black/5' : 'text-white/50 hover:bg-white/10')}`;

    const playlistFavorited = Boolean(openCollection)
        && favoritesPlaylists.some(item => item.providerId === openCollection!.providerId && String(item.id) === String(openCollection!.id));

    const renderDetail = () => {
        if (!openCollection) return null;
        return (
            <section className={`${PANEL} ${panelTone(isDaylight)} p-4`}>
                <div className="mb-3 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => { setOpenCollection(null); setTracks([]); forgetCollection(providerId); }}
                        className={`rounded-full p-1.5 ${isDaylight ? 'text-zinc-500 hover:bg-black/5' : 'text-white/60 hover:bg-white/10'}`}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-semibold ${strongText}`}>{openCollection.name}</p>
                        {typeof openCollection.trackCount === 'number' && (
                            <p className={`text-xs ${mutedText}`}>
                                {t('lxSource.trackCount', { count: openCollection.trackCount })}
                            </p>
                        )}
                    </div>
                    {tracks.length > 0 && (
                        <button
                            type="button"
                            onClick={() => onPlaySong(tracks[0], tracks)}
                            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white"
                            style={{ backgroundColor: accentColor }}
                        >
                            <Play size={12} fill="currentColor" />
                            {t('lxSource.playAll')}
                        </button>
                    )}
                    {/* 收藏整个歌单：只存歌单条目，点击可重新打开。 */}
                    <button
                        type="button"
                        onClick={() => togglePlaylist(openCollection)}
                        aria-label={playlistFavorited ? t('lxSource.unfavoritePlaylist') : t('lxSource.favoritePlaylist')}
                        title={playlistFavorited ? t('lxSource.unfavoritePlaylist') : t('lxSource.favoritePlaylist')}
                        className={`shrink-0 rounded-full p-2 transition-colors ${isDaylight
                            ? 'text-zinc-500 hover:bg-black/5'
                            : 'text-white/60 hover:bg-white/10'}`}
                        style={playlistFavorited ? { color: accentColor } : undefined}
                    >
                        <Star size={15} fill={playlistFavorited ? 'currentColor' : 'none'} />
                    </button>
                </div>

                {tracksLoading && tracks.length === 0 ? (
                    <p className={`flex items-center gap-2 py-6 text-xs ${mutedText}`}>
                        <Loader2 size={14} className="animate-spin" />{t('lxSource.loading')}
                    </p>
                ) : tracksError ? (
                    <div className="flex items-center justify-between py-4">
                        <span className={`text-xs ${mutedText}`}>{t('lxSource.loadError')}</span>
                        <button type="button" onClick={() => void openTracks(openCollection)}
                            className={`text-xs ${isDaylight ? 'text-zinc-600 hover:underline' : 'text-white/70 hover:underline'}`}>
                            {t('lxSource.retry')}
                        </button>
                    </div>
                ) : tracks.length === 0 ? (
                    <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.noResults')}</p>
                ) : (
                    <>
                        <TrackList tracks={tracks} isDaylight={isDaylight} accentColor={accentColor} onPlaySong={onPlaySong} onDownload={handleDownload} onFavorite={setFavoriteSong} />
                        {hasMore && (
                            <button
                                type="button"
                                onClick={() => void loadMoreTracks()}
                                disabled={tracksLoading}
                                className={`mt-3 w-full rounded-xl py-2 text-xs disabled:opacity-50 ${isDaylight
                                    ? 'bg-black/5 text-zinc-600 hover:bg-black/10'
                                    : 'bg-white/10 text-white/70 hover:bg-white/15'}`}
                            >
                                {tracksLoading ? t('lxSource.loading') : t('lxSource.loadMore')}
                            </button>
                        )}
                    </>
                )}
            </section>
        );
    };

    const renderBoards = () => (
        <section className={`${PANEL} ${panelTone(isDaylight)} p-4`}>
            {boardsLoading ? (
                <p className={`flex items-center gap-2 py-6 text-xs ${mutedText}`}>
                    <Loader2 size={14} className="animate-spin" />{t('lxSource.loading')}
                </p>
            ) : boardsError ? (
                <div className="flex items-center justify-between py-4">
                    <span className={`text-xs ${mutedText}`}>{t('lxSource.loadError')}</span>
                    <button type="button" onClick={() => void loadBoards()}
                        className={`text-xs ${isDaylight ? 'text-zinc-600 hover:underline' : 'text-white/70 hover:underline'}`}>
                        {t('lxSource.retry')}
                    </button>
                </div>
            ) : boards.length === 0 ? (
                <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.noResults')}</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {boards.map(board => (
                        <button
                            key={String(board.id)}
                            type="button"
                            onClick={() => void openTracks(board)}
                            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-transform hover:scale-[1.03] ${isDaylight
                                ? 'bg-black/5 text-zinc-700'
                                : 'bg-white/10 text-white/80'}`}
                        >
                            <ListMusic size={12} />
                            {board.name}
                        </button>
                    ))}
                </div>
            )}
        </section>
    );

    const renderSearch = () => (
        <section className={`${PANEL} ${panelTone(isDaylight)} p-4`}>
            <div className="flex items-center gap-2">
                <div className={`relative flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 ${isDaylight
                    ? 'border-black/10 bg-white/80'
                    : 'border-white/10 bg-black/20'}`}>
                    <Search size={14} className={mutedText} />
                    <input
                        value={query}
                        onChange={event => { setQuery(event.target.value); setSuggestIndex(-1); }}
                        onFocus={() => setSuggestOpen(true)}
                        onBlur={() => window.setTimeout(() => { setSuggestOpen(false); setSuggestIndex(-1); }, 120)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder={t('lxSource.searchPlaceholder')}
                        className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${isDaylight
                            ? 'text-zinc-800 placeholder:text-zinc-400'
                            : 'text-white placeholder:text-white/30'}`}
                    />
                    {suggestOpen && suggestionItems.length > 0 && (
                        <ul className={`absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border py-1 shadow-lg ${isDaylight
                            ? 'border-black/10 bg-white'
                            : 'border-white/10 bg-zinc-900'}`}>
                            {suggestionItems.map((item, index) => (
                                <li
                                    key={item.value}
                                    ref={index === activeSuggestIndex ? activeSuggestRef : undefined}
                                >
                                    <button
                                        type="button"
                                        // 阻止 mousedown 夺焦，blur 的延时关闭才不会抢在 click 之前。
                                        onMouseDown={event => event.preventDefault()}
                                        onMouseEnter={() => setSuggestIndex(index)}
                                        onClick={() => { setQuery(item.value); void runSearch(item.value); }}
                                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${index === activeSuggestIndex
                                            ? (isDaylight ? 'bg-black/5' : 'bg-white/10')
                                            : (isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10')}`}
                                    >
                                        {item.fromHistory
                                            ? <History size={12} className="shrink-0" style={{ color: accentColor }} />
                                            : <Search size={12} className={`shrink-0 ${mutedText}`} />}
                                        <span
                                            className={`min-w-0 flex-1 truncate ${item.fromHistory
                                                ? (isDaylight ? 'text-zinc-800' : 'text-white/90')
                                                : (isDaylight ? 'text-zinc-600' : 'text-white/70')}`}
                                            style={item.fromHistory ? { color: accentColor } : undefined}
                                        >
                                            {item.value}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => void runSearch()}
                    disabled={searching || !query.trim()}
                    className="shrink-0 rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    style={{ backgroundColor: accentColor }}
                >
                    {searching ? t('lxSource.loading') : t('lxSource.search')}
                </button>
            </div>

            <div className="mt-3 flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setSearchKind('songs')}
                    className={tabClass(searchKind === 'songs')}
                    style={searchKind === 'songs' ? { backgroundColor: accentColor } : undefined}
                >
                    {t('lxSource.searchSongs')}
                </button>
                <button
                    type="button"
                    onClick={() => setSearchKind('playlists')}
                    className={tabClass(searchKind === 'playlists')}
                    style={searchKind === 'playlists' ? { backgroundColor: accentColor } : undefined}
                >
                    {t('lxSource.searchPlaylists')}
                </button>
            </div>

            {history.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className={`shrink-0 text-xs ${mutedText}`}>{t('lxSource.searchHistory')}</span>
                    {history.map(item => (
                        <span
                            key={item}
                            className={`flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1.5 text-xs ${isDaylight
                                ? 'bg-black/5 text-zinc-700'
                                : 'bg-white/10 text-white/75'}`}
                        >
                            <button
                                type="button"
                                onClick={() => { setQuery(item); void runSearch(item); }}
                                className="max-w-40 truncate"
                                title={item}
                            >
                                {item}
                            </button>
                            <button
                                type="button"
                                onClick={() => removeHistory(item)}
                                aria-label={t('lxSource.searchHistoryRemove')}
                                className={`rounded-full p-0.5 ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/15'}`}
                            >
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                    <button
                        type="button"
                        onClick={clearHistory}
                        className={`shrink-0 text-xs hover:underline ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}
                    >
                        {t('lxSource.searchHistoryClear')}
                    </button>
                </div>
            )}

            <div className="mt-3">
                {searching ? (
                    <p className={`flex items-center gap-2 py-6 text-xs ${mutedText}`}>
                        <Loader2 size={14} className="animate-spin" />{t('lxSource.loading')}
                    </p>
                ) : searchError ? (
                    <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.loadError')}</p>
                ) : searchKind === 'songs' ? (
                    results.length ? (
                        <TrackList tracks={results} isDaylight={isDaylight} accentColor={accentColor} onPlaySong={onPlaySong} onDownload={handleDownload} onFavorite={setFavoriteSong} />
                    ) : searched ? (
                        <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.noResults')}</p>
                    ) : null
                ) : playlistResults.length ? (
                    <ul className="flex flex-col gap-1">
                        {playlistResults.map(playlist => (
                            <li key={String(playlist.id)}>
                                <button
                                    type="button"
                                    onClick={() => void openTracks(playlist)}
                                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${isDaylight
                                        ? 'hover:bg-black/5'
                                        : 'hover:bg-white/5'}`}
                                >
                                    <span className={`h-9 w-9 shrink-0 overflow-hidden rounded-md ${isDaylight ? 'bg-black/5' : 'bg-white/10'}`}>
                                        {playlist.coverUrl && (
                                            <img src={playlist.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className={`block truncate text-sm ${isDaylight ? 'text-zinc-800' : 'text-white/90'}`}>
                                            {playlist.name}
                                        </span>
                                        <span className={`block truncate text-xs ${mutedText}`}>
                                            {playlist.publisher || ''}
                                            {typeof playlist.trackCount === 'number'
                                                ? `${playlist.publisher ? ' · ' : ''}${t('lxSource.trackCount', { count: playlist.trackCount })}`
                                                : ''}
                                        </span>
                                    </span>
                                    <Music2 size={14} className={mutedText} />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : searched ? (
                    <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.noResults')}</p>
                ) : null}
            </div>
        </section>
    );

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pb-16">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {LX_PLATFORMS.map(platform => (
                        <button
                            key={platform.providerId}
                            type="button"
                            onClick={() => rememberProvider(platform.providerId)}
                            className={tabClass(providerId === platform.providerId)}
                            style={providerId === platform.providerId ? { backgroundColor: accentColor } : undefined}
                        >
                            {platform.label}
                        </button>
                    ))}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {/* 「榜单 / 搜索」常驻：打开某个榜单时也能直接切走，不用先返回。
                        切走不会丢掉「最后打开的那个榜单」——记忆只在点详情里的返回箭头时才清。
                        回到榜单视图且当前没在详情里时，自动复位到上次打开的那条。 */}
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => {
                                selectMode('boards');
                                if (openCollection) {
                                    setOpenCollection(null);
                                    setTracks([]);
                                } else {
                                    const remembered = useLxBrowseMemoryStore.getState().byPlatform[providerId]?.collection;
                                    if (remembered) void openTracks(remembered);
                                }
                            }}
                            className={tabClass(mode === 'boards')}
                            style={mode === 'boards' ? { backgroundColor: accentColor } : undefined}
                        >
                            {t('lxSource.boardsTab')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                selectMode('search');
                                if (openCollection) { setOpenCollection(null); setTracks([]); }
                            }}
                            className={tabClass(mode === 'search')}
                            style={mode === 'search' ? { backgroundColor: accentColor } : undefined}
                        >
                            {t('lxSource.searchTab')}
                        </button>
                    </div>
                    <label className={`flex items-center gap-1.5 text-xs ${mutedText}`} title={t('lxSource.playbackQualityHint')}>
                        <span className="shrink-0">{t('lxSource.playbackQuality')}</span>
                        <select
                            value={playbackQuality ?? ''}
                            onChange={event => {
                                setPlaybackQuality(event.target.value ? event.target.value as AudioQualityPreference : null);
                                // 已预取/缓存的直链是按旧音质拿的，清掉让下一次播放重新解析。
                                clearPrefetchRuntime();
                            }}
                            className={`rounded-lg border px-2 py-1 text-xs outline-none ${isDaylight
                                ? 'border-black/10 bg-white/80 text-zinc-700'
                                : 'border-white/10 bg-black/30 text-white/80'}`}
                        >
                            <option value="">{t('lxSource.playbackQualityFollow')}</option>
                            {QUALITY_OPTIONS.map(option => (
                                <option
                                    key={option.value}
                                    value={option.value}
                                    disabled={supportedQualityIds.length > 0 && !supportedQualityIds.includes(option.lx)}
                                >
                                    {t(option.labelKey)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={`flex items-center gap-1.5 text-xs ${mutedText}`} title={t('lxSource.downloadQualityHint')}>
                        <span className="shrink-0">{t('lxSource.downloadQuality')}</span>
                        <select
                            value={downloadQuality}
                            onChange={event => setDownloadQuality(event.target.value as AudioQualityPreference)}
                            className={`rounded-lg border px-2 py-1 text-xs outline-none ${isDaylight
                                ? 'border-black/10 bg-white/80 text-zinc-700'
                                : 'border-white/10 bg-black/30 text-white/80'}`}
                        >
                            {QUALITY_OPTIONS.map(option => (
                                <option
                                    key={option.value}
                                    value={option.value}
                                    disabled={supportedQualityIds.length > 0 && !supportedQualityIds.includes(option.lx)}
                                >
                                    {t(option.labelKey)}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>

            {!canPlay && (
                <p className={`text-xs ${isDaylight ? 'text-amber-700' : 'text-amber-300'}`}>
                    {t('lxSource.playNeedsSource')}
                </p>
            )}

            {openCollection ? renderDetail() : mode === 'boards' ? renderBoards() : renderSearch()}

            {favoriteSong && (
                <LxFavoritePicker
                    song={favoriteSong}
                    isDaylight={isDaylight}
                    accentColor={accentColor}
                    onClose={() => setFavoriteSong(null)}
                />
            )}
        </div>
    );
};
