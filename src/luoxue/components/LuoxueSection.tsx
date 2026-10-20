import React, { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult } from '../../types';
import type { PlaybackNavigationOptions } from '../../types/appPlayback';
import type { LibraryHomeData } from '../../library/core/home/home.contract';
import { useLuoxueLibraryStore } from '../store/useLuoxueLibraryStore';
import { useLuoxueSectionStore, type LuoxuePanelId } from '../store/useLuoxueSectionStore';
import { ensureLuoxueSongCover } from '../provider/coverHydration';
import { luoxueSourceLabel } from './LuoxueSongList';
import LuoxueSearchPanel from './panels/LuoxueSearchPanel';
import LuoxueBoardsPanel from './panels/LuoxueBoardsPanel';
import LuoxueSongListsPanel from './panels/LuoxueSongListsPanel';
import LuoxueMyListPanel from './panels/LuoxueMyListPanel';
import LuoxueSourcePanel from './panels/LuoxueSourcePanel';
import LuoxueDownloadPanel from './panels/LuoxueDownloadPanel';
import LuoxueSettingsPanel from './panels/LuoxueSettingsPanel';

// src/luoxue/components/LuoxueSection.tsx
// 洛雪版块的外壳：标题（浏览平台 + 当前音源脚本）、七个二级面板的页签条，以及当前面板。整块填满 folia 给的空间、
// 内部各自滚动。切入某个面板时按需懒加载它的目录数据（用状态字段兜底，只加载一次）。
// 浏览平台（搜索 / 排行榜 / 歌单走它）与音源脚本（提供播放 / 下载地址）是两件事，标题里分别展示。
// 三条 suite（grid / bravais / tui）都只挂这一个组件，variant 只影响外观细节。

export type LuoxueSectionProps = {
    /**
     * folia 首页模型的播放回调：第 4 个参数是「从哪个集合页点的」，第 5 个是导航选项。
     * 洛雪传 `shouldNavigateToPlayer: false`——从洛雪点歌只换歌，不跳到大屏播放视图。
     */
    onPlaySong: LibraryHomeData['onPlaySong'];
    onAddSongToQueue?: (song: SongResult) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    isInteractive: boolean;
    variant: 'grid' | 'bravais' | 'tui';
};

/** 洛雪自己的播放选项：不跳转播放视图（folia 自己的点播路径仍然照旧跳）。 */
const LUOXUE_PLAY_OPTIONS: PlaybackNavigationOptions = { shouldNavigateToPlayer: false };

const PANELS: ReadonlyArray<{ id: LuoxuePanelId; label: string }> = [
    { id: 'search', label: '搜索' },
    { id: 'boards', label: '排行榜' },
    { id: 'songlists', label: '歌单' },
    { id: 'mylist', label: '我的列表' },
    { id: 'download', label: '下载' },
    { id: 'source', label: '音源' },
    { id: 'settings', label: '设置' },
];

const LuoxueSection: React.FC<LuoxueSectionProps> = ({
    onPlaySong,
    onAddSongToQueue,
    onAddAllToQueue,
    isInteractive,
    variant,
}) => {
    const {
        panel,
        setPanel,
        hotStatus,
        loadHotKeywords,
        boardsStatus,
        loadBoards,
        songlistsStatus,
        loadSongListTags,
        loadSongLists,
        activeSourceId,
        browsePlatform,
    } = useLuoxueSectionStore(useShallow(state => ({
        panel: state.panel,
        setPanel: state.setPanel,
        hotStatus: state.hotStatus,
        loadHotKeywords: state.loadHotKeywords,
        boardsStatus: state.boardsStatus,
        loadBoards: state.loadBoards,
        songlistsStatus: state.songlistsStatus,
        loadSongListTags: state.loadSongListTags,
        loadSongLists: state.loadSongLists,
        activeSourceId: state.activeSourceId,
        browsePlatform: state.browsePlatform,
    })));

    // 面板块首访后常驻（切走只是不可见、不卸载）：切页签再切回来时，打开着的歌单 / 排行榜详情、
    // 选中的分类标签、搜索结果都还在原处，不会退回列表页。首访之前不挂载，避免一进洛雪就把所有面板的请求打出去。
    const [visited, setVisited] = useState<LuoxuePanelId[]>(() => [panel]);
    useEffect(() => {
        setVisited(previous => (previous.includes(panel) ? previous : [...previous, panel]));
    }, [panel]);

    // 切到某个面板时按需加载它的目录数据；状态字段为 idle 才发起，保证只加载一次。
    useEffect(() => {
        if (panel === 'search' && hotStatus === 'idle') {
            void loadHotKeywords();
        } else if (panel === 'boards' && boardsStatus === 'idle') {
            void loadBoards();
        } else if (panel === 'songlists' && songlistsStatus === 'idle') {
            void (async () => {
                await loadSongListTags();
                await loadSongLists();
            })();
        }
    }, [panel, hotStatus, boardsStatus, songlistsStatus, loadHotKeywords, loadBoards, loadSongListTags, loadSongLists]);

    // 从洛雪版块开始播放的歌曲都进洛雪自己的播放历史。
    // 列表加载时已经后台补过封面；这里兜住「从历史 / 我的列表点播」这类没补过的歌曲，
    // 让播放界面一开就有封面（已有封面或已补过时立即返回，不会拖慢播放）。
    // 带上 LUOXUE_PLAY_OPTIONS：只换歌不跳播放视图。
    const handlePlaySong = useCallback((song: SongResult, queue?: SongResult[]) => {
        if (!song) return;
        useLuoxueLibraryStore.getState().pushHistory(song);
        void ensureLuoxueSongCover(song).then(() => onPlaySong(song, queue, false, undefined, LUOXUE_PLAY_OPTIONS));
    }, [onPlaySong]);

    // 「播放全部」也走同一路：拿整批当队列播第一首，同样不跳播放视图（folia 的 onPlayAll 会跳，这里不用它）。
    const handlePlayAll = useCallback((songs: SongResult[]) => {
        if (!songs.length) return;
        useLuoxueLibraryStore.getState().pushHistory(songs[0]);
        void ensureLuoxueSongCover(songs[0]).then(() => onPlaySong(songs[0], songs, false, undefined, LUOXUE_PLAY_OPTIONS));
    }, [onPlaySong]);

    // 加入队列：优先用专门的单曲回调（与 folia 现有的「加入队列」一致），没有时退化成把单曲当一批加入。
    const handleEnqueue = useCallback((song: SongResult) => {
        if (onAddSongToQueue) onAddSongToQueue(song);
        else onAddAllToQueue?.([song]);
    }, [onAddSongToQueue, onAddAllToQueue]);

    const handleEnqueueAll = useCallback((songs: SongResult[]) => {
        onAddAllToQueue?.(songs);
    }, [onAddAllToQueue]);

    const playback = {
        isInteractive,
        onPlaySong: handlePlaySong,
        onAddSongToQueue: handleEnqueue,
        onAddAllToQueue: onAddAllToQueue ? handleEnqueueAll : undefined,
        onPlayAll: handlePlayAll,
    };

    const isTui = variant === 'tui';
    const rootClass = `flex h-full w-full min-w-0 min-h-0 flex-col ${isTui ? 'font-mono' : ''}`;
    const headerPad = isTui ? 'px-4 py-2' : 'px-5 py-3';

    return (
        <div className={rootClass} data-luoxue-section={variant}>
            <header className={`flex shrink-0 flex-col gap-2 border-b border-current/10 ${headerPad}`}>
                <div className="flex items-center gap-3">
                    <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>洛雪</span>
                    <span className="min-w-0 truncate text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        浏览平台：{luoxueSourceLabel(browsePlatform)} · 音源：{activeSourceId ? luoxueSourceLabel(activeSourceId) : '未选择'}
                    </span>
                </div>
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="洛雪">
                    {PANELS.map(item => {
                        const active = item.id === panel;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                disabled={!isInteractive}
                                onClick={() => setPanel(item.id)}
                                className={`rounded-full px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? '' : 'opacity-60 hover:opacity-100'}`}
                                style={active
                                    ? { backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }
                                    : { color: 'var(--text-secondary)' }}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            </header>

            {/* 面板叠在一起，切换只切可见性：用 visibility 而不是 display:none，因为 display:none 会销毁布局，
                再切回来时列表的滚动位置会被重置——那就不是「保留最后的状态」了。 */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
                {PANELS.map(item => {
                    if (!visited.includes(item.id)) return null;
                    const active = item.id === panel;
                    return (
                        <div
                            key={item.id}
                            aria-hidden={!active}
                            className={`absolute inset-0 flex flex-col p-4 ${active ? '' : 'invisible pointer-events-none'}`}
                        >
                            {item.id === 'search' ? (
                                <LuoxueSearchPanel {...playback} />
                            ) : item.id === 'boards' ? (
                                <LuoxueBoardsPanel {...playback} />
                            ) : item.id === 'songlists' ? (
                                <LuoxueSongListsPanel {...playback} />
                            ) : item.id === 'mylist' ? (
                                <LuoxueMyListPanel {...playback} />
                            ) : item.id === 'download' ? (
                                <LuoxueDownloadPanel isInteractive={isInteractive} onPlaySong={playback.onPlaySong} />
                            ) : item.id === 'settings' ? (
                                <LuoxueSettingsPanel isInteractive={isInteractive} />
                            ) : (
                                <LuoxueSourcePanel isInteractive={isInteractive} />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default LuoxueSection;
