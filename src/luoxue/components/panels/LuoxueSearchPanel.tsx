import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, Search, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult } from '../../../types';
import { useLuoxueSectionStore, type LuoxueSearchKind } from '../../store/useLuoxueSectionStore';
import LuoxueSongList, { type LuoxuePlaybackCallbacks } from '../LuoxueSongList';
import LuoxueCollectionCard from '../LuoxueCollectionCard';
import LuoxueCollectionDetail from '../LuoxueCollectionDetail';
import LuoxuePlatformSwitch from '../LuoxuePlatformSwitch';

// src/luoxue/components/panels/LuoxueSearchPanel.tsx
// 搜索面板：先选类别（单曲 / 歌单），再是输入框（回车或点「搜索」触发）、输入联想（上下键可选，回车带入）、
// 搜索历史（单条删除 / 清空）、热搜词 chips（各平台统一截到 20 条），以及结果列表与「加载更多」。
// 单曲结果显示歌单行（并可「播放全部 / 加入队列」），歌单结果显示歌单卡片，点开进集合详情。

type LuoxueSearchPanelProps = LuoxuePlaybackCallbacks;

/** 搜索类别：单曲走 omni 搜索，歌单走 lx 的 songList.search。 */
const SEARCH_KINDS: Array<{ id: LuoxueSearchKind; label: string }> = [
    { id: 'song', label: '单曲' },
    { id: 'songlist', label: '歌单' },
];

const LuoxueSearchPanel: React.FC<LuoxueSearchPanelProps> = ({ isInteractive, onPlaySong, onAddSongToQueue, onAddAllToQueue, onPlayAll }) => {
    const {
        query,
        setQuery,
        searchStatus,
        searchResults,
        searchHasMore,
        searchError,
        searchKind,
        setSearchKind,
        searchCollections,
        searchCollectionsStatus,
        searchCollectionsHasMore,
        searchCollectionsError,
        hotKeywords,
        hotStatus,
        runSearch,
        browsePlatform,
        searchHistory,
        removeSearchHistory,
        clearSearchHistory,
        suggestKeywords,
        runSuggest,
        clearSuggest,
        openCollection,
        openCollectionTracks,
    } = useLuoxueSectionStore(useShallow(state => ({
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
        browsePlatform: state.browsePlatform,
        searchHistory: state.searchHistory,
        removeSearchHistory: state.removeSearchHistory,
        clearSearchHistory: state.clearSearchHistory,
        suggestKeywords: state.suggestKeywords,
        runSuggest: state.runSuggest,
        clearSuggest: state.clearSuggest,
        // 详情按面板各记一份：这块读的是搜索面板自己打开的那个歌单（切面板 / 切回来都不串台、也不丢）。
        openCollection: state.openCollections.search,
        openCollectionTracks: state.openCollectionTracks,
    })));

    const songlistKind = searchKind === 'songlist';
    // 两类结果的加载状态各归各的：按当前类别取，免得一边在转圈一边已经把按钮按灰。
    const loading = songlistKind ? searchCollectionsStatus === 'loading' : searchStatus === 'loading';
    const songs = searchResults as SongResult[];

    // 联想下拉：是否展开、当前高亮的第几项（-1 表示没选中任何一项）。
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);

    // 记录最近一次非空关键词：切浏览平台时 store 会把 query 清空，靠它在切换后自动重搜。
    const lastQueryRef = useRef('');
    useEffect(() => {
        if (query.trim()) lastQueryRef.current = query;
    }, [query]);

    // 切浏览平台后 store 会清空结果与 query：此处把切换前的关键词重搜一次（跳过首次挂载）。
    const browsePlatformRef = useRef(browsePlatform);
    useEffect(() => {
        if (browsePlatformRef.current === browsePlatform) return;
        browsePlatformRef.current = browsePlatform;
        const keyword = lastQueryRef.current.trim();
        if (keyword) void runSearch(keyword);
    }, [browsePlatform, runSearch]);

    // 联想词随输入变化；空关键词时 store 会清空联想并关掉下拉。
    useEffect(() => {
        if (!query.trim()) setSuggestOpen(false);
        setHighlight(-1);
    }, [query]);

    const suggestItems = useMemo(() => suggestKeywords.slice(0, 12), [suggestKeywords]);

    const submit = (event?: React.FormEvent) => {
        event?.preventDefault();
        if (!isInteractive || loading) return;
        setSuggestOpen(false);
        void runSearch();
    };

    /** 用某个关键词直接发起搜索（联想项 / 历史 / 热搜共用）。 */
    const searchWith = (keyword: string) => {
        if (!isInteractive || loading) return;
        setQuery(keyword);
        setSuggestOpen(false);
        clearSuggest();
        void runSearch(keyword);
    };

    const handleInputChange = (value: string) => {
        setQuery(value);
        setSuggestOpen(true);
        void runSuggest(value);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            // 上下键只在联想列表里移动，不让光标跳到行首 / 行尾。
            if (suggestItems.length === 0) return;
            event.preventDefault();
            setSuggestOpen(true);
            setHighlight(previous => {
                if (event.key === 'ArrowDown') return previous >= suggestItems.length - 1 ? 0 : previous + 1;
                return previous <= 0 ? suggestItems.length - 1 : previous - 1;
            });
            return;
        }
        if (event.key === 'Enter') {
            if (suggestOpen && highlight >= 0 && suggestItems[highlight]) {
                event.preventDefault();
                searchWith(suggestItems[highlight]);
            }
            return;
        }
        if (event.key === 'Escape') {
            setSuggestOpen(false);
            setHighlight(-1);
        }
    };

    const showSuggest = suggestOpen && suggestItems.length > 0;

    if (openCollection) {
        return (
            <LuoxueCollectionDetail
                owner="search"
                isInteractive={isInteractive}
                onPlaySong={onPlaySong}
                onAddSongToQueue={onAddSongToQueue}
                onPlayAll={onPlayAll}
                emptyText="这个歌单暂时没有歌曲"
                errorText="歌单加载失败，请返回后重试"
            />
        );
    }

    return (
        <div className="flex h-full w-full flex-col gap-4">
            <LuoxuePlatformSwitch isInteractive={isInteractive} />

            <div className="flex shrink-0 flex-wrap items-center gap-2" role="tablist" aria-label="搜索类别">
                <span className="shrink-0 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>搜索类别</span>
                <div className="flex flex-wrap gap-1.5">
                    {SEARCH_KINDS.map(item => {
                        const active = searchKind === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                disabled={!isInteractive}
                                onClick={() => setSearchKind(item.id)}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed ${active ? 'border-current/30 opacity-100' : 'border-current/10 opacity-70 enabled:hover:bg-current/10 enabled:hover:opacity-100'}`}
                                style={{ color: active ? 'var(--text-accent, var(--text-primary))' : 'var(--text-secondary)' }}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <form onSubmit={submit} className="flex shrink-0 items-center gap-2">
                <div className="relative flex-1">
                    {loading ? (
                        <Loader2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin opacity-50" />
                    ) : (
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                    )}
                    <input
                        type="text"
                        value={query}
                        onChange={event => handleInputChange(event.target.value)}
                        onFocus={() => { if (query.trim()) setSuggestOpen(true); }}
                        onBlur={() => { setSuggestOpen(false); setHighlight(-1); }}
                        onKeyDown={handleKeyDown}
                        placeholder={songlistKind ? '搜索歌单…' : '搜索歌曲、歌手、专辑…'}
                        className="w-full rounded-full border border-white/10 bg-black/5 py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-white/20 dark:bg-white/5"
                        style={{ color: 'var(--text-primary)' }}
                    />
                    {showSuggest ? (
                        <div
                            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-current/10 p-1 shadow-lg"
                            style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)' }}
                        >
                            {suggestItems.map((keyword, index) => (
                                <button
                                    key={`${keyword}-${index}`}
                                    type="button"
                                    // 按住 mousedown 不让输入框失焦，否则 click 还没来下拉就先被 blur 关掉。
                                    onMouseDown={event => event.preventDefault()}
                                    onClick={() => searchWith(keyword)}
                                    disabled={!isInteractive}
                                    className={`block w-full truncate rounded-lg px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed ${index === highlight ? 'bg-current/15' : 'hover:bg-current/10'}`}
                                >
                                    {keyword}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
                <button
                    type="submit"
                    disabled={!isInteractive || loading || !query.trim()}
                    className="shrink-0 rounded-full border border-current/15 px-4 py-2 text-sm font-medium transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ color: 'var(--text-primary)' }}
                >
                    搜索
                </button>
                {!songlistKind && songs.length > 0 ? (
                    <>
                        <button
                            type="button"
                            disabled={!isInteractive}
                            onClick={() => onPlayAll(songs)}
                            className="shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                        >
                            播放全部
                        </button>
                        {onAddAllToQueue ? (
                            <button
                                type="button"
                                disabled={!isInteractive}
                                onClick={() => onAddAllToQueue(songs)}
                                className="shrink-0 rounded-full border border-current/15 px-4 py-2 text-sm transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                加入队列
                            </button>
                        ) : null}
                    </>
                ) : null}
            </form>

            {searchHistory.length > 0 ? (
                <div className="flex shrink-0 flex-col gap-2">
                    <div className="flex items-center gap-2 text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        <History size={13} />
                        <span>搜索历史</span>
                        <button
                            type="button"
                            disabled={!isInteractive}
                            onClick={clearSearchHistory}
                            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed"
                            aria-label="清空搜索历史"
                        >
                            <Trash2 size={12} />
                            清空
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {searchHistory.map(keyword => (
                            <span
                                key={keyword}
                                className="flex items-center rounded-full border border-current/10 opacity-75 transition-opacity hover:opacity-100"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                <button
                                    type="button"
                                    disabled={!isInteractive}
                                    onClick={() => searchWith(keyword)}
                                    className="max-w-[10rem] truncate py-1 pl-3 pr-1 text-xs disabled:cursor-not-allowed"
                                >
                                    {keyword}
                                </button>
                                <button
                                    type="button"
                                    disabled={!isInteractive}
                                    onClick={() => removeSearchHistory(keyword)}
                                    className="py-1 pl-1 pr-2 opacity-60 transition-opacity hover:opacity-100 disabled:cursor-not-allowed"
                                    aria-label={`删除历史记录 ${keyword}`}
                                >
                                    <X size={11} />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}

            {hotStatus === 'ready' && hotKeywords.length > 0 ? (
                <div className="flex shrink-0 flex-col gap-2">
                    <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>热门搜索</div>
                    <div className="flex flex-wrap gap-2">
                        {hotKeywords.map(keyword => (
                            <button
                                key={keyword}
                                type="button"
                                disabled={!isInteractive}
                                onClick={() => searchWith(keyword)}
                                className="rounded-full border border-current/10 px-3 py-1 text-xs opacity-70 transition-colors enabled:hover:bg-current/10 enabled:hover:opacity-100 disabled:cursor-not-allowed"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                {keyword}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {songlistKind ? (
                    searchCollectionsStatus === 'error' ? (
                        <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            歌单搜索失败：{searchCollectionsError || '请稍后重试'}
                        </div>
                    ) : loading && searchCollections.length === 0 ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            <Loader2 size={16} className="animate-spin" />
                            正在搜索歌单…
                        </div>
                    ) : searchCollections.length === 0 ? (
                        <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>输入关键词搜索歌单</div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                {searchCollections.map(list => (
                                    <LuoxueCollectionCard
                                        key={String(list.id)}
                                        collection={list}
                                        isInteractive={isInteractive}
                                        onOpen={() => void openCollectionTracks('search', list)}
                                    />
                                ))}
                            </div>
                            {searchCollectionsHasMore ? (
                                <div className="flex justify-center py-4">
                                    <button
                                        type="button"
                                        disabled={!isInteractive || loading}
                                        onClick={() => void runSearch(undefined, { append: true })}
                                        className="rounded-full border border-current/15 px-4 py-1.5 text-sm transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {loading ? '加载中…' : '加载更多'}
                                    </button>
                                </div>
                            ) : null}
                        </>
                    )
                ) : searchStatus === 'error' ? (
                    <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        搜索失败：{searchError || '请稍后重试'}
                    </div>
                ) : (
                    <>
                        <LuoxueSongList
                            songs={songs}
                            isInteractive={isInteractive}
                            loading={loading}
                            emptyText="输入关键词开始搜索"
                            onPlay={index => onPlaySong(songs[index], songs)}
                            onEnqueue={onAddSongToQueue}
                        />
                        {searchHasMore ? (
                            <div className="flex justify-center py-4">
                                <button
                                    type="button"
                                    disabled={!isInteractive || loading}
                                    onClick={() => void runSearch(undefined, { append: true })}
                                    className="rounded-full border border-current/15 px-4 py-1.5 text-sm transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {loading ? '加载中…' : '加载更多'}
                                </button>
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
};

export default LuoxueSearchPanel;
