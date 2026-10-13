import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import type { SongResult } from '../../types';
import { useLxFavoritesStore } from '../../stores/useLxFavoritesStore';

// src/components/lxSource/LxFavoritePicker.tsx
// 「收藏到…」选择框：从浏览区把一首歌收进某几个自建列表，也可当场新建列表。
// 独立的居中浮层，不依赖 Folia 既有的弹窗体系（保持版块自包含）。

type Props = {
    song: SongResult;
    isDaylight: boolean;
    accentColor: string;
    onClose: () => void;
};

export const LxFavoritePicker: React.FC<Props> = ({ song, isDaylight, accentColor, onClose }) => {
    const { t } = useTranslation();
    const lists = useLxFavoritesStore(state => state.lists);
    const createList = useLxFavoritesStore(state => state.createList);
    const toggleSongInList = useLxFavoritesStore(state => state.toggleSongInList);
    const [newName, setNewName] = useState('');

    const memberIds = new Set(lists.filter(list => list.songs.some(item => item.id === song.id)).map(list => list.id));

    const handleCreate = () => {
        const id = createList(newName);
        if (!id) return;
        toggleSongInList(id, song);
        setNewName('');
    };

    const panelTone = isDaylight ? 'bg-white text-zinc-800' : 'bg-zinc-900 text-white';
    const muted = isDaylight ? 'text-zinc-500' : 'text-white/50';
    const hover = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10';

    return (
        <div
            className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 p-6"
            onClick={onClose}
        >
            <div
                className={`w-full max-w-sm rounded-2xl p-4 shadow-[0_16px_48px_rgba(0,0,0,0.4)] ${panelTone}`}
                onClick={event => event.stopPropagation()}
            >
                <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{t('lxSource.favoritesAddTo')}</p>
                        <p className={`truncate text-xs ${muted}`}>{song.name}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('lxSource.back')}
                        className={`shrink-0 rounded-full p-1.5 ${hover}`}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="max-h-64 overflow-y-auto">
                    {lists.length === 0 ? (
                        <p className={`py-3 text-xs ${muted}`}>{t('lxSource.favoritesEmpty')}</p>
                    ) : (
                        <ul className="flex flex-col gap-0.5">
                            {lists.map(list => {
                                const active = memberIds.has(list.id);
                                return (
                                    <li key={list.id}>
                                        <button
                                            type="button"
                                            onClick={() => toggleSongInList(list.id, song)}
                                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${hover}`}
                                        >
                                            <span
                                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                                                style={active ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
                                            >
                                                {active && <Check size={11} className="text-white" />}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">{list.name}</span>
                                            <span className={`shrink-0 text-xs ${muted}`}>{list.songs.length}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className={`mt-3 flex items-center gap-2 border-t pt-3 ${isDaylight ? 'border-black/10' : 'border-white/10'}`}>
                    <input
                        value={newName}
                        onChange={event => setNewName(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') handleCreate(); }}
                        placeholder={t('lxSource.newListPlaceholder')}
                        className={`min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none ${isDaylight
                            ? 'border-black/10 bg-black/[0.03] text-zinc-800 placeholder:text-zinc-400'
                            : 'border-white/10 bg-black/30 text-white placeholder:text-white/30'}`}
                    />
                    <button
                        type="button"
                        onClick={handleCreate}
                        disabled={!newName.trim()}
                        className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                        style={{ backgroundColor: accentColor }}
                    >
                        <Plus size={14} />
                        {t('lxSource.newList')}
                    </button>
                </div>
            </div>
        </div>
    );
};
