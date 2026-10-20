import React, { useMemo, useState } from 'react';
import { Check, ListPlus, Square, SquareCheck } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult } from '../../types';
import ThemedDialog from '../../components/shared/ThemedDialog';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { luoxueSongKey, useLuoxueLibraryStore } from '../store/useLuoxueLibraryStore';

// src/luoxue/components/LuoxueFavoriteDialog.tsx
// 点歌曲行的星标打开的落点选择框：把这一首歌收进「我的收藏」或某个自建列表。
// 每一行就是一个开关，点一下立即生效（再点一下移出），不需要「确定」——和 lx 的收藏弹窗一致。
// 顺带在这里提供「新建列表」，新建后这首歌直接进新列表。

type LuoxueFavoriteDialogProps = {
    song: SongResult;
    onClose: () => void;
};

const LuoxueFavoriteDialog: React.FC<LuoxueFavoriteDialogProps> = ({ song, onClose }) => {
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const {
        favorites, lists,
        toggleFavorite, createList, toggleSongInList,
    } = useLuoxueLibraryStore(useShallow(state => ({
        favorites: state.favorites,
        lists: state.lists,
        toggleFavorite: state.toggleFavorite,
        createList: state.createList,
        toggleSongInList: state.toggleSongInList,
    })));
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');

    const songKey = luoxueSongKey(song);
    // 已经收进哪些列表：默认那份和自建的都算。
    const memberIds = useMemo(() => {
        const ids = new Set<string>();
        if (favorites.some(item => luoxueSongKey(item) === songKey)) ids.add('default');
        lists.forEach(list => {
            if (list.songs.some(item => luoxueSongKey(item) === songKey)) ids.add(list.id);
        });
        return ids;
    }, [favorites, lists, songKey]);

    const rowClass = `flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
        isDaylight ? 'border-black/[0.06] hover:bg-black/[0.05]' : 'border-white/[0.08] hover:bg-white/[0.06]'
    }`;

    /** 新建列表并把这首歌直接收进去。 */
    const handleCreate = (): void => {
        const id = createList(newName);
        toggleSongInList(id, song);
        setNewName('');
        setCreating(false);
    };

    return (
        <ThemedDialog
            isOpen
            isDaylight={isDaylight}
            onClose={onClose}
            title="收藏到"
            description={song.name}
            footer={(
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                    style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                >
                    完成
                </button>
            )}
        >
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
                <button
                    type="button"
                    onClick={() => toggleFavorite(song)}
                    className={rowClass}
                    style={{ color: 'var(--text-primary)' }}
                >
                    {memberIds.has('default') ? <SquareCheck size={16} className="shrink-0" /> : <Square size={16} className="shrink-0 opacity-40" />}
                    <span className="min-w-0 flex-1 truncate">我的收藏</span>
                    <span className="shrink-0 text-xs opacity-60">{favorites.length} 首</span>
                </button>

                {lists.map(list => (
                    <button
                        key={list.id}
                        type="button"
                        onClick={() => toggleSongInList(list.id, song)}
                        className={rowClass}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {memberIds.has(list.id) ? <SquareCheck size={16} className="shrink-0" /> : <Square size={16} className="shrink-0 opacity-40" />}
                        <span className="min-w-0 flex-1 truncate">{list.name}</span>
                        <span className="shrink-0 text-xs opacity-60">{list.songs.length} 首</span>
                    </button>
                ))}

                {creating ? (
                    <div className="flex items-center gap-2 rounded-xl border border-current/15 px-3 py-2">
                        <input
                            autoFocus
                            value={newName}
                            onChange={event => setNewName(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') handleCreate();
                                if (event.key === 'Escape') { setCreating(false); setNewName(''); }
                            }}
                            placeholder="新列表名称"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                            style={{ color: 'var(--text-primary)' }}
                        />
                        <button
                            type="button"
                            onClick={handleCreate}
                            className="shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
                            style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                        >
                            新建
                        </button>
                        <button
                            type="button"
                            onClick={() => { setCreating(false); setNewName(''); }}
                            className="shrink-0 rounded-full px-2 py-1 text-xs opacity-60 transition-colors hover:opacity-100"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            取消
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setCreating(true)}
                        className={`${rowClass} justify-center`}
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        <ListPlus size={16} className="shrink-0" />
                        <span>新建列表</span>
                    </button>
                )}

                {memberIds.size > 0 ? (
                    <div className="flex items-center gap-1.5 px-1 pt-1 text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        <Check size={12} />
                        已收藏：再点一下可移出
                    </div>
                ) : null}
            </div>
        </ThemedDialog>
    );
};

export default LuoxueFavoriteDialog;
