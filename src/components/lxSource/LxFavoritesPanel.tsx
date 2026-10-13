import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ListMusic, Play, Plus, Star, Trash2, X } from 'lucide-react';
import type { SongResult } from '../../types';
import type { OmniCollection } from '../../types/onlineMusic';
import { useLxFavoritesStore } from '../../stores/useLxFavoritesStore';
import { useLxSongDownload } from './useLxSongDownload';

// src/components/lxSource/LxFavoritesPanel.tsx
// 「收藏」标签：自建列表（可新建 / 删除）+ 收藏的歌单条目；右侧是选中列表的歌曲（播放 / 移除 / 下载）。
// 数据全部来自 useLxFavoritesStore（localStorage），与 Folia 的本地曲库互不相干。

type Props = {
    isDaylight: boolean;
    accentColor: string;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    /** 点某个收藏的歌单：跳回「在线浏览」并打开它。 */
    onOpenPlaylist: (collection: OmniCollection) => void;
};

/** 收藏歌单条目上展示来源平台的简名。 */
const PLAYLIST_PLATFORM_LABELS: Record<string, string> = {
    'lx-kw': '酷我音乐',
    'lx-mg': '咪咕音乐',
    'lx-kg': '酷狗音乐',
    'lx-tx': 'QQ音乐',
    'lx-wy': '网易云音乐',
};

const formatDuration = (durationMs: number): string => {
    if (!durationMs || durationMs <= 0) return '--/--';
    const totalSeconds = Math.floor(durationMs / 1000);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

const artistNames = (song: SongResult): string => song.artists.map(artist => artist.name).join('、');

export const LxFavoritesPanel: React.FC<Props> = ({ isDaylight, accentColor, onPlaySong, onOpenPlaylist }) => {
    const { t } = useTranslation();
    const lists = useLxFavoritesStore(state => state.lists);
    const createList = useLxFavoritesStore(state => state.createList);
    const removeList = useLxFavoritesStore(state => state.removeList);
    const removeSong = useLxFavoritesStore(state => state.removeSong);
    const playlists = useLxFavoritesStore(state => state.playlists);
    const removePlaylist = useLxFavoritesStore(state => state.removePlaylist);
    const handleDownload = useLxSongDownload();

    const [newName, setNewName] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // 选中的列表被删掉（或还没选）时回落到第一个。
    useEffect(() => {
        if (selectedId && lists.some(list => list.id === selectedId)) return;
        setSelectedId(lists[0]?.id ?? null);
    }, [lists, selectedId]);

    const selected = useMemo(
        () => lists.find(list => list.id === selectedId) ?? null,
        [lists, selectedId],
    );

    const mutedText = isDaylight ? 'text-zinc-500' : 'text-white/50';
    const strongText = isDaylight ? 'text-zinc-900' : 'text-white';
    const panelTone = isDaylight ? 'border-black/5 bg-white/70' : 'border-white/10 bg-white/5';

    const handleCreate = () => {
        const id = createList(newName);
        if (!id) return;
        setSelectedId(id);
        setNewName('');
    };

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pb-16">
            <div className={`rounded-2xl border p-4 backdrop-blur-sm ${panelTone}`}>
                <div className="flex items-center gap-2">
                    <input
                        value={newName}
                        onChange={event => setNewName(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') handleCreate(); }}
                        placeholder={t('lxSource.newListPlaceholder')}
                        className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none ${isDaylight
                            ? 'border-black/10 bg-white/80 text-zinc-800 placeholder:text-zinc-400'
                            : 'border-white/10 bg-black/20 text-white placeholder:text-white/30'}`}
                    />
                    <button
                        type="button"
                        onClick={handleCreate}
                        disabled={!newName.trim()}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                        style={{ backgroundColor: accentColor }}
                    >
                        <Plus size={15} />
                        {t('lxSource.newList')}
                    </button>
                </div>
            </div>

            {/* 收藏的歌单：只存歌单条目，点一下跳回「在线浏览」重新打开。 */}
            {playlists.length > 0 && (
                <section className={`rounded-2xl border p-4 backdrop-blur-sm ${panelTone}`}>
                    <div className="mb-3 flex items-center gap-2">
                        <Star size={14} style={{ color: accentColor }} />
                        <p className={`text-sm font-semibold ${strongText}`}>{t('lxSource.favoritesPlaylistsTitle')}</p>
                        <span className={`text-xs ${mutedText}`}>{playlists.length}</span>
                    </div>
                    <ul className="flex flex-col gap-1">
                        {playlists.map(playlist => (
                            <li key={`${playlist.providerId}:${playlist.id}`}>
                                <div className={`group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors ${isDaylight
                                    ? 'hover:bg-black/5'
                                    : 'hover:bg-white/5'}`}>
                                    <button
                                        type="button"
                                        onClick={() => onOpenPlaylist(playlist)}
                                        title={t('lxSource.openPlaylist')}
                                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
                                                {PLAYLIST_PLATFORM_LABELS[playlist.providerId] ?? playlist.providerId}
                                                {typeof playlist.trackCount === 'number'
                                                    ? ` · ${t('lxSource.trackCount', { count: playlist.trackCount })}`
                                                    : ''}
                                            </span>
                                        </span>
                                        <ListMusic size={14} className={mutedText} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removePlaylist(playlist)}
                                        aria-label={t('lxSource.unfavoritePlaylist')}
                                        title={t('lxSource.unfavoritePlaylist')}
                                        className={`shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${isDaylight
                                            ? 'text-zinc-500 hover:bg-black/5 hover:text-rose-600'
                                            : 'text-white/60 hover:bg-white/10 hover:text-rose-400'}`}
                                    >
                                        <X size={13} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {lists.length === 0 ? (
                <p className={`px-1 text-xs ${mutedText}`}>{t('lxSource.favoritesEmpty')}</p>
            ) : (
                <div className="flex flex-col gap-4 md:flex-row">
                    <ul className="flex shrink-0 flex-col gap-1 md:w-56">
                        {lists.map(list => {
                            const active = list.id === selectedId;
                            return (
                                <li key={list.id}>
                                    <div
                                        className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors ${active
                                            ? (isDaylight ? 'bg-black/[0.06]' : 'bg-white/10')
                                            : (isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5')}`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setSelectedId(list.id)}
                                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                        >
                                            <ListMusic size={14} style={active ? { color: accentColor } : undefined} className={active ? '' : mutedText} />
                                            <span className={`min-w-0 flex-1 truncate text-sm ${active ? strongText : (isDaylight ? 'text-zinc-700' : 'text-white/80')}`}>
                                                {list.name}
                                            </span>
                                            <span className={`shrink-0 text-xs ${mutedText}`}>{list.songs.length}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (window.confirm(t('lxSource.deleteListConfirm', { name: list.name }))) removeList(list.id);
                                            }}
                                            aria-label={t('lxSource.deleteList')}
                                            className={`shrink-0 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 ${isDaylight
                                                ? 'text-zinc-400 hover:bg-black/5 hover:text-rose-600'
                                                : 'text-white/40 hover:bg-white/10 hover:text-rose-400'}`}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    <section className={`min-w-0 flex-1 rounded-2xl border p-4 backdrop-blur-sm ${panelTone}`}>
                        {!selected ? (
                            <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.favoritesSelectList')}</p>
                        ) : selected.songs.length === 0 ? (
                            <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.favoritesListEmpty')}</p>
                        ) : (
                            <>
                                <div className="mb-3 flex items-center gap-3">
                                    <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${strongText}`}>{selected.name}</p>
                                    <button
                                        type="button"
                                        onClick={() => onPlaySong(selected.songs[0], selected.songs)}
                                        className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white"
                                        style={{ backgroundColor: accentColor }}
                                    >
                                        <Play size={12} fill="currentColor" />
                                        {t('lxSource.playAll')}
                                    </button>
                                </div>
                                <ul className="flex flex-col">
                                    {selected.songs.map((song, index) => (
                                        <li
                                            key={`${song.id}-${index}`}
                                            className={`group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors ${isDaylight
                                                ? 'hover:bg-black/5'
                                                : 'hover:bg-white/5'}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => onPlaySong(song, selected.songs)}
                                                aria-label={song.name}
                                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                            >
                                                <span className={`w-6 shrink-0 text-right text-xs tabular-nums ${mutedText}`}>{index + 1}</span>
                                                <span className={`h-9 w-9 shrink-0 overflow-hidden rounded-md ${isDaylight ? 'bg-black/5' : 'bg-white/10'}`}>
                                                    {song.album?.coverUrl && (
                                                        <img src={song.album.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                                    )}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className={`block truncate text-sm ${isDaylight ? 'text-zinc-800' : 'text-white/90'}`}>{song.name}</span>
                                                    <span className={`block truncate text-xs ${mutedText}`}>{artistNames(song)}</span>
                                                </span>
                                                <span className={`shrink-0 text-xs tabular-nums ${mutedText}`}>{formatDuration(song.durationMs)}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDownload(song)}
                                                aria-label={t('lxSource.download')}
                                                className={`shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${isDaylight
                                                    ? 'text-zinc-500 hover:bg-black/5'
                                                    : 'text-white/60 hover:bg-white/10'}`}
                                            >
                                                <Download size={13} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeSong(selected.id, song.id)}
                                                aria-label={t('lxSource.favoritesRemove')}
                                                className={`shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${isDaylight
                                                    ? 'text-zinc-500 hover:bg-black/5 hover:text-rose-600'
                                                    : 'text-white/60 hover:bg-white/10 hover:text-rose-400'}`}
                                            >
                                                <X size={13} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
};
