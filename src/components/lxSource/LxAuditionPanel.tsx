import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Play, Trash2, X } from 'lucide-react';
import type { SongResult } from '../../types';
import { useLxAuditionStore } from '../../stores/useLxAuditionStore';
import { useLxSongDownload } from './useLxSongDownload';

// src/components/lxSource/LxAuditionPanel.tsx
// 「试听」标签：在这个版块里点播过的歌（最新在前）。播放 / 下载 / 逐条移除 / 清空。
// 数据来自 useLxAuditionStore（localStorage），与 Folia 的播放队列无关。

type Props = {
    isDaylight: boolean;
    accentColor: string;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
};

const formatDuration = (durationMs: number): string => {
    if (!durationMs || durationMs <= 0) return '--/--';
    const totalSeconds = Math.floor(durationMs / 1000);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

const artistNames = (song: SongResult): string => song.artists.map(artist => artist.name).join('、');

export const LxAuditionPanel: React.FC<Props> = ({ isDaylight, accentColor, onPlaySong }) => {
    const { t } = useTranslation();
    const songs = useLxAuditionStore(state => state.songs);
    const remove = useLxAuditionStore(state => state.remove);
    const clear = useLxAuditionStore(state => state.clear);
    const handleDownload = useLxSongDownload();

    const mutedText = isDaylight ? 'text-zinc-500' : 'text-white/50';
    const strongText = isDaylight ? 'text-zinc-900' : 'text-white';
    const panelTone = isDaylight ? 'border-black/5 bg-white/70' : 'border-white/10 bg-white/5';
    const hover = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5';

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pb-16">
            <section className={`rounded-2xl border p-4 backdrop-blur-sm ${panelTone}`}>
                <div className="mb-3 flex items-center gap-3">
                    <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${strongText}`}>
                        {t('lxSource.auditionTitle')}
                        <span className={`ml-2 text-xs font-normal ${mutedText}`}>
                            {t('lxSource.trackCount', { count: songs.length })}
                        </span>
                    </p>
                    {songs.length > 0 && (
                        <>
                            <button
                                type="button"
                                onClick={() => onPlaySong(songs[0], songs)}
                                className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white"
                                style={{ backgroundColor: accentColor }}
                            >
                                <Play size={12} fill="currentColor" />
                                {t('lxSource.playAll')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { if (window.confirm(t('lxSource.auditionClearConfirm'))) clear(); }}
                                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${isDaylight
                                    ? 'text-zinc-500 hover:bg-black/5 hover:text-rose-600'
                                    : 'text-white/50 hover:bg-white/10 hover:text-rose-400'}`}
                            >
                                <Trash2 size={13} />
                                {t('lxSource.auditionClear')}
                            </button>
                        </>
                    )}
                </div>

                {songs.length === 0 ? (
                    <p className={`py-6 text-xs ${mutedText}`}>{t('lxSource.auditionEmpty')}</p>
                ) : (
                    <ul className="flex flex-col">
                        {songs.map((song, index) => (
                            <li
                                key={`${song.id}-${index}`}
                                className={`group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors ${hover}`}
                            >
                                <button
                                    type="button"
                                    onClick={() => onPlaySong(song, songs)}
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
                                    onClick={() => remove(song.id)}
                                    aria-label={t('lxSource.auditionRemove')}
                                    className={`shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${isDaylight
                                        ? 'text-zinc-500 hover:bg-black/5 hover:text-rose-600'
                                        : 'text-white/60 hover:bg-white/10 hover:text-rose-400'}`}
                                >
                                    <X size={13} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
};
