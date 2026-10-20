import React, { useEffect, useMemo, useState } from 'react';
import { SquareCheck, Square, Trash } from 'lucide-react';
import type { SongResult } from '../../types';
import ThemedDialog from '../../components/shared/ThemedDialog';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { luoxueSongKey } from '../store/useLuoxueLibraryStore';
import LuoxueSongList from './LuoxueSongList';

// src/luoxue/components/LuoxueSelectableSongList.tsx
// 给「正在浏览的列表」（收藏的歌单、播放历史）用的一组列表 + 批量操作：单选 / 全选 / 删除选中。
// 选择模式由外部的分区标题（「管理」）控制，删除前的确认走应用内的 ThemedDialog，不用系统弹窗。

export type LuoxueSelectableSongListProps = {
    songs: SongResult[];
    isInteractive: boolean;
    onPlay: (index: number) => void;
    onEnqueue: (song: SongResult) => void;
    /** 是否处于「管理」（多选）模式。 */
    selecting: boolean;
    onSelectingChange: (selecting: boolean) => void;
    /** 删除选中的歌曲（按唯一键）；不传则隐藏删除按钮。 */
    onRemoveSelected?: (keys: string[]) => void;
    emptyText?: string;
    /** 确认弹窗的标题。 */
    removeTitle?: string;
    /** 确认弹窗的描述（count = 本次将删除的条数）。 */
    removeDescription?: (count: number) => string;
    /** 列表区最大高度（默认 60vh，超出滚动）。 */
    bodyClassName?: string;
};

const LuoxueSelectableSongList: React.FC<LuoxueSelectableSongListProps> = ({
    songs,
    isInteractive,
    onPlay,
    onEnqueue,
    selecting,
    onSelectingChange,
    onRemoveSelected,
    emptyText = '这里还没有歌曲',
    removeTitle = '删除歌曲',
    removeDescription = count => `确定删除选中的 ${count} 首歌曲？该操作只影响本地列表，不会改动上游歌单。`,
    bodyClassName = 'max-h-[60vh]',
}) => {
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [confirmOpen, setConfirmOpen] = useState(false);

    // 退出管理模式即清空选择，免得下次进来还残留上次的勾选。
    useEffect(() => {
        if (!selecting) setSelected(new Set());
    }, [selecting]);

    // 只统计「此刻仍在列表里」的选中项：删除后残留的键不会算进去。
    const selectedKeys = useMemo(() => {
        if (!selecting) return new Set<string>();
        const keys = new Set(songs.map(luoxueSongKey));
        return new Set([...selected].filter(key => keys.has(key)));
    }, [selecting, selected, songs]);

    const allSelected = songs.length > 0 && selectedKeys.size === songs.length;

    const toggleOne = (song: SongResult): void => {
        const key = luoxueSongKey(song);
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleAll = (): void => {
        setSelected(allSelected ? new Set() : new Set(songs.map(luoxueSongKey)));
    };

    const handleRemove = (): void => {
        const keys = [...selectedKeys];
        if (keys.length === 0 || !onRemoveSelected) return;
        onRemoveSelected(keys);
        setSelected(new Set());
        setConfirmOpen(false);
    };

    const chipClass = (active: boolean): string => [
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
        active ? 'border-transparent' : 'border-current/10 hover:bg-current/5',
    ].join(' ');

    return (
        <div className="flex flex-col gap-2">
            {selecting ? (
                <div className="flex flex-wrap items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <button
                        type="button"
                        onClick={() => onSelectingChange(false)}
                        className={`rounded-full px-3 py-1.5 text-xs transition-colors ${isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]'}`}
                    >
                        完成
                    </button>
                    <button
                        type="button"
                        onClick={toggleAll}
                        disabled={songs.length === 0}
                        className={`${chipClass(false)} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                        {allSelected ? <SquareCheck size={13} /> : <Square size={13} />}
                        {allSelected ? '取消全选' : '全选'}
                    </button>
                    <span className="text-xs opacity-60">已选 {selectedKeys.size} / {songs.length}</span>
                    {onRemoveSelected ? (
                        <button
                            type="button"
                            disabled={selectedKeys.size === 0}
                            onClick={() => setConfirmOpen(true)}
                            className="flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs transition-colors hover:bg-current/5 disabled:cursor-not-allowed disabled:opacity-40"
                            style={{ color: 'var(--text-accent, var(--text-primary))' }}
                        >
                            <Trash size={13} />
                            删除选中
                        </button>
                    ) : null}
                </div>
            ) : null}

            <div className={`overflow-y-auto pr-1 ${bodyClassName}`}>
                <LuoxueSongList
                    songs={songs}
                    isInteractive={isInteractive}
                    emptyText={emptyText}
                    onPlay={onPlay}
                    onEnqueue={onEnqueue}
                    {...(selecting ? { selectedKeys, onToggleSelected: toggleOne } : {})}
                />
            </div>

            {confirmOpen ? (
                <ThemedDialog
                    isOpen
                    isDaylight={isDaylight}
                    onClose={() => setConfirmOpen(false)}
                    title={removeTitle}
                    description={removeDescription(selectedKeys.size)}
                    footer={(
                        <>
                            <button
                                type="button"
                                onClick={() => setConfirmOpen(false)}
                                className={`rounded-full px-4 py-2 text-sm transition-colors ${isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]'}`}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleRemove}
                                className="rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                                style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                            >
                                删除
                            </button>
                        </>
                    )}
                >
                    <></>
                </ThemedDialog>
            ) : null}
        </div>
    );
};

export default LuoxueSelectableSongList;
