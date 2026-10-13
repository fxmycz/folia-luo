import { create } from 'zustand';
import { callLxSource, getLxSourceBridge } from '../services/lxSource/lxSourceTransport';
import type { LxDownloadTask, LxDownloadTrackPayload } from '../services/lxSource/lxSourceTransport';
import type { AudioQualityPreference } from '../types/onlineMusic';

// src/stores/useLxDownloadStore.ts
// 自定义音源下载队列的渲染层状态：目录、任务列表与进度。
// 任务真身在主进程（lxDownload.cjs），这里只做镜像：listDownloads 拉全量，onDownloadProgress 增量更新。

/** 一次性下载提示：入队 / 完成 / 失败都经它反馈给界面（无需切到下载标签）。 */
export type LxDownloadNotice = {
    kind: 'queued' | 'done' | 'error';
    name: string;
    quality?: string | null;
    error?: string | null;
    at: number;
};

export type LxDownloadState = {
    /** 当前下载目录；桌面端首次刷新后才有值。 */
    dir: string;
    tasks: LxDownloadTask[];
    isLoading: boolean;
    isPickingDir: boolean;
    error: string | null;
    /** 最近一次下载提示；界面自行做超时消失。 */
    notice: LxDownloadNotice | null;

    refresh: () => Promise<void>;
    /** 弹系统目录选择框并落盘；用户取消时保持原目录。 */
    chooseDir: () => Promise<void>;
    /** 入队一首歌；返回是否成功。 */
    start: (track: LxDownloadTrackPayload, quality: AudioQualityPreference) => Promise<boolean>;
    cancel: (taskId: string) => Promise<void>;
    /** 删除一条已结束的下载记录（只移除列表项，不删磁盘文件）。 */
    remove: (taskId: string) => Promise<void>;
    dismissNotice: () => void;
    /** 订阅进度广播；返回取消订阅函数。无桥时是空操作。 */
    subscribeProgress: () => () => void;
};

// 按创建时间倒序合并一个任务；已存在则原地替换。
const upsertTask = (tasks: LxDownloadTask[], task: LxDownloadTask): LxDownloadTask[] => {
    const index = tasks.findIndex(item => item.taskId === task.taskId);
    if (index === -1) return [task, ...tasks].sort((a, b) => b.createdAt - a.createdAt);
    const next = tasks.slice();
    next[index] = task;
    return next;
};

export const useLxDownloadStore = create<LxDownloadState>((set, get) => ({
    dir: '',
    tasks: [],
    isLoading: false,
    isPickingDir: false,
    error: null,
    notice: null,

    refresh: async () => {
        if (!getLxSourceBridge()) return;
        set({ isLoading: true });
        try {
            const snapshot = await callLxSource('lx', bridge => bridge.listDownloads());
            set({ dir: snapshot.dir, tasks: snapshot.tasks, error: null });
        } catch (error) {
            set({ error: error instanceof Error ? error.message : String(error) });
        } finally {
            set({ isLoading: false });
        }
    },

    chooseDir: async () => {
        if (!getLxSourceBridge()) return;
        set({ isPickingDir: true, error: null });
        try {
            const result = await callLxSource('lx', bridge => bridge.chooseDownloadDir());
            if (!result.canceled) set({ dir: result.dir });
        } catch (error) {
            set({ error: error instanceof Error ? error.message : String(error) });
        } finally {
            set({ isPickingDir: false });
        }
    },

    start: async (track, quality) => {
        if (!getLxSourceBridge()) {
            set({ error: '自定义音源仅桌面端可用' });
            return false;
        }
        set({ error: null });
        try {
            const task = await callLxSource('lx', bridge => bridge.startDownload({ track, quality }));
            set({
                tasks: upsertTask(get().tasks, task),
                notice: { kind: 'queued', name: track.name, quality: task.quality ?? null, at: Date.now() },
            });
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            set({ error: message, notice: { kind: 'error', name: track.name, error: message, at: Date.now() } });
            return false;
        }
    },

    cancel: async (taskId) => {
        if (!getLxSourceBridge()) return;
        try {
            await callLxSource('lx', bridge => bridge.cancelDownload(taskId));
        } catch (error) {
            set({ error: error instanceof Error ? error.message : String(error) });
        }
    },

    remove: async (taskId) => {
        if (!getLxSourceBridge()) return;
        try {
            await callLxSource('lx', bridge => bridge.removeDownload(taskId));
            set({ tasks: get().tasks.filter(task => task.taskId !== taskId) });
        } catch (error) {
            set({ error: error instanceof Error ? error.message : String(error) });
        }
    },

    dismissNotice: () => set({ notice: null }),

    subscribeProgress: () => {
        const bridge = getLxSourceBridge();
        if (!bridge) return () => {};
        return bridge.onDownloadProgress(task => {
            const patch: Partial<LxDownloadState> = { tasks: upsertTask(get().tasks, task) };
            // 完成 / 失败时给一次性提示，让用户不切到下载标签也能收到反馈。
            if (task.status === 'done') {
                patch.notice = { kind: 'done', name: task.name, quality: task.quality ?? null, at: Date.now() };
            } else if (task.status === 'error') {
                patch.notice = { kind: 'error', name: task.name, error: task.error ?? null, at: Date.now() };
            }
            set(patch);
        });
    },
}));
