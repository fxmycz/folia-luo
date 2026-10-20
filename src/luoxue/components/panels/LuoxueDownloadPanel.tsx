import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FolderOpen, Play, RotateCcw, Trash2, X } from 'lucide-react';
import type { LibraryHomeData } from '../../../library/core/home/home.contract';
import { useLuoxueDownloadStore, revealLuoxueDownload, type LuoxueDownloadTask } from '../../store/useLuoxueDownloadStore';

// src/luoxue/components/panels/LuoxueDownloadPanel.tsx
// 洛雪的「下载」面板（对齐 lx 桌面端的下载管理页）：筛选页签 + 表格（# / 歌曲名 / 进度 / 状态 / 品质 / 操作）。
// 数据全部来自 useLuoxueDownloadStore；这里只做展示与行级操作（试听、打开文件位置、重试、取消、移除）。
// lx 的「已暂停」页签没有移植——主进程的落盘桥只支持取消，做不出真正的断点续传，宁可不放这个空页签。

type LuoxueDownloadPanelProps = {
    isInteractive: boolean;
    /** 行内「试听」：走洛雪的播放回调（不跳大屏播放视图）。第 4 个参数是集合页来源（这里没有），第 5 个是导航选项。 */
    onPlaySong?: LibraryHomeData['onPlaySong'];
};

type TabId = 'all' | 'running' | 'error' | 'done';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'all', label: '所有任务' },
    { id: 'running', label: '正在下载' },
    { id: 'error', label: '出错' },
    { id: 'done', label: '下载完成' },
];

/** 表头与行的列宽（与 lx 下载页的比例一致）。 */
const ROW_GRID = '2.75rem minmax(0, 1fr) 5.5rem 7rem 6.5rem 8rem';

const belongsToTab = (task: LuoxueDownloadTask, tab: TabId): boolean => {
    switch (tab) {
        case 'running':
            // 「正在下载」把排队中的也算进来，与 lx 的 WAITING + RUN 一致。
            return task.status === 'idle' || task.status === 'downloading';
        case 'error':
            return task.status === 'error';
        case 'done':
            return task.status === 'done';
        default:
            return true;
    }
};

/** 进度列：完成即 100%，未知总量时给个占位。 */
const progressText = (task: LuoxueDownloadTask): string => {
    if (task.status === 'done') return '100%';
    if (task.status === 'idle') return '—';
    if (task.total > 0) return `${Math.min(99, Math.round((task.received / task.total) * 100))}%`;
    return task.received > 0 ? '下载中' : '0%';
};

/** 状态列（与 lx 的中文状态文案一致）。 */
const statusText = (task: LuoxueDownloadTask): string => {
    switch (task.status) {
        case 'idle':
            return '等待中';
        case 'downloading':
            return '下载中';
        case 'done':
            return '下载完成';
        default:
            return task.error || '出错';
    }
};

/** 品质列：与 lx 下载页一致，Hires 单独展开、其余大写。 */
const qualityText = (task: LuoxueDownloadTask): string =>
    task.quality === 'hires' ? 'FLAC Hires' : task.quality.toUpperCase();

/** 行内图标按钮（图标与文字都对齐 lx 的行操作）。 */
const RowButton: React.FC<{
    label: string;
    disabled: boolean;
    onClick: () => void;
    children: React.ReactNode;
}> = ({ label, disabled, onClick, children }) => (
    <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        className="rounded p-1 transition-opacity disabled:cursor-not-allowed disabled:opacity-30 enabled:opacity-70 enabled:hover:opacity-100"
        style={{ color: 'var(--text-primary)' }}
    >
        {children}
    </button>
);

const LuoxueDownloadPanel: React.FC<LuoxueDownloadPanelProps> = ({ isInteractive, onPlaySong }) => {
    const tasks = useLuoxueDownloadStore(useShallow(state => state.tasks));
    const cancelTask = useLuoxueDownloadStore(state => state.cancelTask);
    const retryTask = useLuoxueDownloadStore(state => state.retryTask);
    const removeTask = useLuoxueDownloadStore(state => state.removeTask);
    const clearFinished = useLuoxueDownloadStore(state => state.clearFinished);

    const [tab, setTab] = useState<TabId>('all');
    const disabled = !isInteractive;

    const list = useMemo(() => tasks.filter(task => belongsToTab(task, tab)), [tasks, tab]);
    const finishedCount = useMemo(() => tasks.filter(task => task.status === 'done' || task.status === 'error').length, [tasks]);
    // 试听：把自己当队列播，和洛雪其它面板一致（不跳大屏播放视图）。
    const playableSongs = tasks.map(task => task.song);

    const muted = { color: 'var(--text-secondary)' } as const;

    return (
        <div className="flex h-full min-h-0 flex-col gap-3" aria-label="洛雪下载">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="tablist" aria-label="下载筛选">
                {TABS.map(item => {
                    const active = item.id === tab;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(item.id)}
                            className={`border-b-2 pb-1 text-sm transition-colors ${active ? 'font-semibold' : 'opacity-60 hover:opacity-100'}`}
                            style={active
                                ? { borderColor: 'var(--text-accent, var(--text-primary))', color: 'var(--text-primary)' }
                                : { borderColor: 'transparent', ...muted }}
                        >
                            {item.label}
                        </button>
                    );
                })}
                {finishedCount > 0 ? (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => clearFinished()}
                        className="ml-auto text-xs transition-opacity disabled:cursor-not-allowed disabled:opacity-30 enabled:opacity-60 enabled:hover:opacity-100"
                        style={muted}
                    >
                        清空已完成
                    </button>
                ) : null}
            </div>

            <div className="flex items-center text-xs font-medium" style={{ ...muted, display: 'grid', gridTemplateColumns: ROW_GRID, gap: '0.5rem' }}>
                <span className="px-2">#</span>
                <span>歌曲名</span>
                <span>进度</span>
                <span>状态</span>
                <span>品质</span>
                <span>操作</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {list.length === 0 ? (
                    <p className="py-10 text-center text-sm" style={muted}>
                        列表竟然是空的…
                    </p>
                ) : (
                    list.map((task, index) => (
                        <div
                            key={task.id}
                            className="items-center border-b border-current/5 py-2 text-sm"
                            style={{ display: 'grid', gridTemplateColumns: ROW_GRID, gap: '0.5rem' }}
                        >
                            <span className="truncate px-2 text-xs" style={muted}>{index + 1}</span>
                            <span className="min-w-0 truncate" style={{ color: 'var(--text-primary)' }} title={`${task.songName} - ${task.artists}`}>
                                {task.songName} - {task.artists}
                            </span>
                            <span style={muted}>{progressText(task)}</span>
                            <span className="min-w-0 truncate" style={task.status === 'error' ? { color: 'var(--text-accent, var(--text-primary))' } : muted} title={task.error ?? undefined}>
                                {statusText(task)}
                            </span>
                            <span className="min-w-0 truncate" style={muted} title={task.quality}>{qualityText(task)}</span>
                            <span className="flex items-center gap-1">
                                {task.status === 'done' ? (
                                    <>
                                        <RowButton
                                            label="试听"
                                            disabled={disabled || !onPlaySong}
                                            onClick={() => onPlaySong?.(task.song, playableSongs, false, undefined, { shouldNavigateToPlayer: false })}
                                        >
                                            <Play size={15} />
                                        </RowButton>
                                        <RowButton label="打开文件位置" disabled={disabled || !task.filePath} onClick={() => revealLuoxueDownload(task.filePath)}>
                                            <FolderOpen size={15} />
                                        </RowButton>
                                    </>
                                ) : null}
                                {task.status === 'error' ? (
                                    <RowButton label="重试" disabled={disabled} onClick={() => retryTask(task.id)}>
                                        <RotateCcw size={15} />
                                    </RowButton>
                                ) : null}
                                {task.status === 'downloading' ? (
                                    <RowButton label="取消下载" disabled={disabled} onClick={() => cancelTask(task.id)}>
                                        <X size={15} />
                                    </RowButton>
                                ) : null}
                                <RowButton label="移除任务" disabled={disabled} onClick={() => removeTask(task.id)}>
                                    <Trash2 size={15} />
                                </RowButton>
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default LuoxueDownloadPanel;
