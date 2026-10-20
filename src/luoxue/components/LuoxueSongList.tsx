import React, { useMemo, useState } from 'react';
import { Check, Download, Heart, Loader2, Play, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult } from '../../types';
import { LUOXUE_BUILTIN_SOURCES, readLuoxueExtra } from '../model/luoxueSong';
import { luoxueSongKey, useLuoxueLibraryStore } from '../store/useLuoxueLibraryStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import LuoxueDownloadDialog from './LuoxueDownloadDialog';
import LuoxueFavoriteDialog from './LuoxueFavoriteDialog';

// src/luoxue/components/LuoxueSongList.tsx
// 洛雪版块共用的歌曲列表：每行展示序号 / 标题（带音源角标）/ 歌手 / 专辑 / 时长，并给出播放、加入队列、收藏三个动作。
// 列表不做虚拟滚动，靠 content-visibility 让长列表也保持顺滑；收藏状态读洛雪自己的「我的列表」store。
// 每行另外给一个下载动作：点它先弹音质选择框（档位按当前音源对该平台的声明），确认后落到洛雪下载 store。
// 星标不直接切换收藏，而是弹出「收藏到」选择框（我的收藏 + 自建列表），在弹窗里决定收进哪些列表。

/** 五个面板共用的一组播放回调；播放前已由 LuoxueSection 记录历史，面板只负责转发。 */
export type LuoxuePlaybackCallbacks = {
    isInteractive: boolean;
    onPlaySong: (song: SongResult, queue?: SongResult[]) => void;
    onAddSongToQueue: (song: SongResult) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    onPlayAll: (songs: SongResult[]) => void;
};

/** 音源 id 的展示名：内置音源取固定名称，自定义音源（user_api_xxx）去掉前缀后原样展示。 */
export const luoxueSourceLabel = (sourceId: string): string => {
    const builtin = LUOXUE_BUILTIN_SOURCES.find(item => item.id === sourceId);
    if (builtin) return builtin.name;
    return sourceId.replace(/^user_api_/, '') || sourceId;
};

export type LuoxueSongListProps = {
    songs: SongResult[];
    isInteractive?: boolean;
    emptyText?: string;
    loading?: boolean;
    onPlay: (index: number) => void;
    onEnqueue: (song: SongResult) => void;
    /** 已选中的歌曲唯一键（传入 onToggleSelected 才会出现勾选框）。 */
    selectedKeys?: Set<string>;
    /** 勾选 / 取消勾选一首；传入即进入多选模式（单击行 = 切换勾选）。 */
    onToggleSelected?: (song: SongResult) => void;
};

/** 毫秒时长 → mm:ss。 */
const formatDuration = (durationMs: number): string => {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const LuoxueSongList: React.FC<LuoxueSongListProps> = ({
    songs,
    isInteractive = true,
    emptyText = '这里还没有歌曲',
    loading = false,
    onPlay,
    onEnqueue,
    selectedKeys,
    onToggleSelected,
}) => {
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const { favorites, lists } = useLuoxueLibraryStore(useShallow(state => ({
        favorites: state.favorites,
        lists: state.lists,
    })));
    // 星标亮起 = 这首歌在「我的收藏」或任一自建列表里（进哪个都算已收藏）。
    const favoriteKeys = useMemo(() => {
        const keys = new Set(favorites.map(luoxueSongKey));
        lists.forEach(list => list.songs.forEach(song => keys.add(luoxueSongKey(song))));
        return keys;
    }, [favorites, lists]);
    // 待选择下载音质的歌曲（点下载打开弹窗；打开时用歌曲自带音源算档位）。
    const [downloadSong, setDownloadSong] = useState<SongResult | null>(null);
    // 点了星标、正等待选择落点的歌曲（弹「收藏到」选择框）。
    const [favoriteSong, setFavoriteSong] = useState<SongResult | null>(null);

    if (loading && songs.length === 0) {
        return (
            <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 size={16} className="animate-spin" />
                正在加载…
            </div>
        );
    }

    if (songs.length === 0) {
        return (
            <div className="py-10 text-center text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>{emptyText}</div>
        );
    }

    const rowClass = `group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
        isDaylight
            ? 'border-black/[0.05] bg-black/[0.035] hover:bg-black/[0.07]'
            : 'border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08]'
    }`;
    const actionClass = 'shrink-0 rounded-full p-2 opacity-60 transition-all hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30';

    return (
        <div className="flex flex-col gap-1">
            {songs.map((song, index) => {
                const extra = readLuoxueExtra(song);
                const songKey = luoxueSongKey(song);
                const isFavorite = favoriteKeys.has(songKey);
                const selectable = Boolean(onToggleSelected);
                const isSelected = Boolean(selectedKeys?.has(songKey));
                const artistText = (song.artists ?? []).map(artist => artist.name).filter(Boolean).join('、') || '未知歌手';
                return (
                    <div
                        key={`${song.id}-${index}`}
                        className={`${rowClass}${isSelected ? ' ring-1 ring-inset ring-current/20' : ''}`}
                        style={{ contentVisibility: 'auto', containIntrinsicSize: '52px' }}
                        {...(selectable ? { role: 'checkbox', 'aria-checked': isSelected, 'aria-label': `${song.name} 勾选` } : {})}
                        onClick={event => {
                            if (!selectable || !isInteractive) return;
                            // 多选模式下单击行 = 勾选；点在行内按钮上时交给按钮自己的动作。
                            if ((event.target as HTMLElement).closest('button')) return;
                            onToggleSelected?.(song);
                        }}
                        onDoubleClick={event => {
                            if (!isInteractive) return;
                            // 双击行即播放，不必先找播放按钮；点在行内按钮上时不触发，免得和按钮自身的动作重复一次。
                            if ((event.target as HTMLElement).closest('button')) return;
                            onPlay(index);
                        }}
                    >
                        {selectable ? (
                            <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                    isSelected ? 'border-transparent bg-current/70 text-white' : 'border-current/30'
                                }`}
                                aria-hidden="true"
                            >
                                {isSelected ? <Check size={12} strokeWidth={3} /> : null}
                            </span>
                        ) : null}
                        <span className="w-6 shrink-0 text-right font-mono text-xs opacity-40">{index + 1}</span>

                        <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                    {song.name}
                                </span>
                                {extra?.lxSource ? (
                                    <span className="shrink-0 rounded-full border border-current/10 px-2 py-0.5 text-[10px] opacity-60">
                                        {luoxueSourceLabel(extra.lxSource)}
                                    </span>
                                ) : null}
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                <span className="min-w-0 truncate">{artistText}</span>
                                {song.album?.name ? (
                                    <>
                                        <span className="shrink-0 opacity-40">•</span>
                                        <span className="max-w-[45%] truncate">{song.album.name}</span>
                                    </>
                                ) : null}
                            </div>
                        </div>

                        <span className="hidden shrink-0 font-mono text-xs opacity-35 sm:block">
                            {formatDuration(song.durationMs)}
                        </span>

                        <button
                            type="button"
                            disabled={!isInteractive}
                            onClick={() => onPlay(index)}
                            className={actionClass}
                            title="播放"
                            aria-label="播放"
                        >
                            <Play size={15} fill="currentColor" />
                        </button>
                        <button
                            type="button"
                            disabled={!isInteractive}
                            onClick={() => onEnqueue(song)}
                            className={actionClass}
                            title="加入队列"
                            aria-label="加入队列"
                        >
                            <Plus size={16} />
                        </button>
                        <button
                            type="button"
                            disabled={!isInteractive}
                            onClick={() => setDownloadSong(song)}
                            className={actionClass}
                            title="下载"
                            aria-label="下载"
                        >
                            <Download size={16} />
                        </button>
                        <button
                            type="button"
                            disabled={!isInteractive}
                            onClick={() => setFavoriteSong(song)}
                            className={actionClass}
                            title={isFavorite ? '已收藏（点击管理收藏）' : '收藏到列表'}
                            aria-label={isFavorite ? '已收藏' : '收藏到列表'}
                            style={isFavorite ? { color: 'var(--text-accent, var(--text-primary))' } : undefined}
                        >
                            <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
                        </button>
                    </div>
                );
            })}
            {downloadSong ? (
                <LuoxueDownloadDialog song={downloadSong} onClose={() => setDownloadSong(null)} />
            ) : null}
            {favoriteSong ? (
                <LuoxueFavoriteDialog song={favoriteSong} onClose={() => setFavoriteSong(null)} />
            ) : null}
        </div>
    );
};

export default LuoxueSongList;
