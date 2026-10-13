import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Loader2, Trash2, X } from 'lucide-react';
import { useLxDownloadStore } from '../../stores/useLxDownloadStore';
import type { LxDownloadTask } from '../../services/lxSource/lxSourceTransport';

// src/components/lxSource/LxDownloadPanel.tsx
// 自定义音源版块的下载队列：下载目录选择 + 任务列表（进度 / 状态 / 取消）。
// 任务状态全部来自 useLxDownloadStore（→ 主进程 lxDownload.cjs）。

type Props = {
    isDaylight: boolean;
    accentColor: string;
};

const PANEL = 'rounded-2xl border backdrop-blur-sm';
const panelTone = (isDaylight: boolean) => (isDaylight
    ? 'border-black/5 bg-white/70'
    : 'border-white/10 bg-white/5');

const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

const STATUS_KEYS: Record<LxDownloadTask['status'], string> = {
    queued: 'downloadQueued',
    downloading: 'downloadDownloading',
    done: 'downloadDone',
    error: 'downloadError',
    canceled: 'downloadCanceled',
};

const statusTone = (isDaylight: boolean, status: LxDownloadTask['status']) => {
    if (status === 'done') return isDaylight ? 'text-emerald-600' : 'text-emerald-300';
    if (status === 'error') return isDaylight ? 'text-rose-600' : 'text-rose-300';
    return isDaylight ? 'text-zinc-500' : 'text-white/50';
};

const TaskRow: React.FC<{
    task: LxDownloadTask;
    isDaylight: boolean;
    accentColor: string;
    onCancel: () => void;
    onRemove: () => void;
}> = ({ task, isDaylight, accentColor, onCancel, onRemove }) => {
    const { t } = useTranslation();
    const active = task.status === 'queued' || task.status === 'downloading';
    const percent = Math.round(Math.max(0, Math.min(1, task.progress)) * 100);

    return (
        <li className={`${PANEL} ${panelTone(isDaylight)} p-3`}>
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${isDaylight ? 'text-zinc-800' : 'text-white/90'}`}>
                        {task.name}
                    </p>
                    <p className={`truncate text-xs ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                        {task.artist}
                        {' · '}
                        <span className={statusTone(isDaylight, task.status)}>
                            {t(`lxSource.${STATUS_KEYS[task.status]}`)}
                        </span>
                        {task.status === 'downloading' && ` ${percent}%`}
                        {task.status === 'error' && task.error ? ` · ${task.error}` : ''}
                    </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${isDaylight
                    ? 'bg-black/5 text-zinc-500'
                    : 'bg-white/10 text-white/60'}`}>
                    {task.quality ?? task.requestedQuality}
                    {task.degraded ? '*' : ''}
                </span>
                {active ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label={t('lxSource.downloadCancel')}
                        title={t('lxSource.downloadCancel')}
                        className={`shrink-0 rounded-lg p-1.5 ${isDaylight
                            ? 'text-zinc-400 hover:bg-black/5 hover:text-zinc-700'
                            : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
                    >
                        <X size={14} />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={t('lxSource.downloadRemove')}
                        title={t('lxSource.downloadRemove')}
                        className={`shrink-0 rounded-lg p-1.5 ${isDaylight
                            ? 'text-zinc-400 hover:bg-black/5 hover:text-rose-600'
                            : 'text-white/40 hover:bg-white/10 hover:text-rose-300'}`}
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            {task.status === 'downloading' && (
                <div className={`mt-2 h-1 w-full overflow-hidden rounded-full ${isDaylight ? 'bg-black/5' : 'bg-white/10'}`}>
                    <div
                        className="h-full rounded-full transition-[width] duration-200"
                        style={{ width: `${percent}%`, backgroundColor: accentColor }}
                    />
                </div>
            )}
            {task.status === 'downloading' && task.totalBytes > 0 && (
                <p className={`mt-1 text-[11px] tabular-nums ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`}>
                    {formatBytes(task.receivedBytes)} / {formatBytes(task.totalBytes)}
                </p>
            )}
            {task.degraded && (
                <p className={`mt-1 text-[11px] ${isDaylight ? 'text-amber-700' : 'text-amber-300'}`}>
                    {t('lxSource.downloadDegraded', { quality: task.quality ?? '' })}
                </p>
            )}
            {task.status === 'done' && task.tagged && (
                <p className={`mt-1 text-[11px] ${isDaylight ? 'text-emerald-600' : 'text-emerald-300'}`}>
                    {t('lxSource.downloadTagged')}
                </p>
            )}
            {task.status === 'done' && task.filePath && (
                <p className={`mt-1 truncate text-[11px] ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`} title={task.filePath}>
                    {task.filePath}
                </p>
            )}
        </li>
    );
};

export const LxDownloadPanel: React.FC<Props> = ({ isDaylight, accentColor }) => {
    const { t } = useTranslation();
    const dir = useLxDownloadStore(state => state.dir);
    const tasks = useLxDownloadStore(state => state.tasks);
    const isLoading = useLxDownloadStore(state => state.isLoading);
    const isPickingDir = useLxDownloadStore(state => state.isPickingDir);
    const error = useLxDownloadStore(state => state.error);
    const refresh = useLxDownloadStore(state => state.refresh);
    const chooseDir = useLxDownloadStore(state => state.chooseDir);
    const cancel = useLxDownloadStore(state => state.cancel);
    const remove = useLxDownloadStore(state => state.remove);
    const subscribeProgress = useLxDownloadStore(state => state.subscribeProgress);

    useEffect(() => {
        const unsubscribe = subscribeProgress();
        void refresh();
        return unsubscribe;
    }, [refresh, subscribeProgress]);

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pb-16">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`shrink-0 text-xs ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                        {t('lxSource.downloadDir')}
                    </span>
                    <span className={`truncate text-xs ${isDaylight ? 'text-zinc-700' : 'text-white/70'}`} title={dir}>
                        {dir || '—'}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => void chooseDir()}
                    disabled={isPickingDir}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-50 ${isDaylight
                        ? 'text-zinc-600 hover:bg-black/5'
                        : 'text-white/60 hover:bg-white/10'}`}
                >
                    {isPickingDir ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
                    {t('lxSource.changeDir')}
                </button>
            </div>

            {error && (
                <p className={`text-xs ${isDaylight ? 'text-rose-600' : 'text-rose-300'}`}>{error}</p>
            )}

            {tasks.length === 0 ? (
                <div className={`${PANEL} ${panelTone(isDaylight)} flex flex-col items-center gap-2 px-6 py-10 text-center`}>
                    <p className={`text-sm ${isDaylight ? 'text-zinc-600' : 'text-white/70'}`}>
                        {isLoading ? t('lxSource.loading') : t('lxSource.downloadEmpty')}
                    </p>
                </div>
            ) : (
                <ul className="flex flex-col gap-2">
                    {tasks.map(task => (
                        <TaskRow
                            key={task.taskId}
                            task={task}
                            isDaylight={isDaylight}
                            accentColor={accentColor}
                            onCancel={() => void cancel(task.taskId)}
                            onRemove={() => void remove(task.taskId)}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
};
