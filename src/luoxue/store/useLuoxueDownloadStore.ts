import { create } from 'zustand';
import type { SongResult } from '../../types';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { resolveLuoxueSource } from '../model/luoxueSong';
import { getLyric, getMusicUrl, getPic, type LxLyricResult, type LxMusicInfo, type LxQuality } from '../sdk';
import { getBrowsePlatform } from '../provider/activeSource';
import { resolveLuoxueQuality } from '../provider/luoxueProvider';
import { useLuoxueSettingsStore, type LuoxueSettingsState } from '../settings/useLuoxueSettingsStore';

// src/luoxue/store/useLuoxueDownloadStore.ts
// 洛雪下载：任务列表 + 并发调度 + 真实落盘。地址解析与 luoxueProvider 一致（歌曲自带 lx 音源 → getMusicUrl），
// 落盘由主进程 electron/luoxueSource 完成（渲染层 webSecurity:true，不能直接写文件）。
// 非 Electron（浏览器）环境没有任何桥，动作只给出明确提示，不抛异常、不崩界面。

/** window.electron.luoxueSource 里与下载相关的那几个方法；浏览器构建里整个键都不存在。 */
type LuoxueDownloadBridge = {
    selectDirectory(): Promise<string | null>;
    // 在系统文件管理器里定位已下载的文件；返回是否定位成功。
    showItemInFolder(filePath: string): Promise<boolean> | void;
    download(payload: {
        taskId: string;
        url: string;
        dir: string;
        fileName: string;
        headers?: Record<string, string>;
        skipExistFile?: boolean;
    }): Promise<{ filePath: string; received: number; total: number; skipped?: boolean }>;
    downloadCancel(taskId: string): Promise<void> | void;
    // 落盘成功后写入音频标签（主进程 electron/luoxueSource 的 writeTags 通道）。
    // supported:false 表示该文件格式不支持写标签，此时把 reason 作为备注展示、不当错误处理。
    writeTags(payload: {
        filePath: string;
        meta: {
            title: string;
            artist: string;
            album: string;
            coverUrl?: string;
            lyrics?: string;
        };
    }): Promise<{ supported: boolean; format: string; written: boolean; reason?: string }>;
    onDownloadProgress(callback: (payload: { taskId: string; received: number; total: number }) => void): () => void;
};

const getDownloadBridge = (): LuoxueDownloadBridge | null => {
    if (typeof window === 'undefined') return null;
    const electron = (window as unknown as { electron?: { luoxueSource?: LuoxueDownloadBridge } }).electron;
    return electron?.luoxueSource ?? null;
};

export type LuoxueDownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

export type LuoxueDownloadTask = {
    id: string;
    /** 歌曲原文（避免重复解析）；不参与渲染。
     *  UI 只读 songName / artists 等派生字段。 */
    song: SongResult;
    songName: string;
    artists: string;
    quality: LxQuality;
    ext: string;
    dir: string;
    fileName: string;
    status: LuoxueDownloadStatus;
    received: number;
    total: number;
    /** 失败原因或状态说明（中文）。 */
    error: string | null;
    filePath: string | null;
    /** 嵌入音频标签的结果备注（中文）：「已写入标签」/ 主进程回传的 reason / 写入失败原因；未处理为 null。 */
    tagMessage: string | null;
};

type LuoxueDownloadState = {
    tasks: LuoxueDownloadTask[];
    /** 局部更新一个任务；供进度监听（React 之外的模块级入口）调用。 */
    patchTask: (id: string, patch: Partial<LuoxueDownloadTask>) => void;
    /** 把一首歌加入下载（自动排队、按 maxDownloadNum 并发）；音质由「点下载时弹出的选择框」传入。 */
    startDownload: (song: SongResult, quality: LxQuality) => void;
    /** 取消一个任务（下载中会中断主进程写入；排队中直接作废）。 */
    cancelTask: (id: string) => void;
    /** 重试一个出错 / 等待中的任务（重新排队取地址；下载中的任务不可重试）。 */
    retryTask: (id: string) => void;
    /** 从列表移除（下载中会先取消）。 */
    removeTask: (id: string) => void;
    /** 清空已完成/已取消的任务。 */
    clearFinished: () => void;
    /** 清空所有任务（下载中会先取消）。 */
    clearAll: () => void;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 音质 → 文件扩展名（与 lx worker/download/utils.ts 的 getExt 一致）。 */
const qualityExt = (quality: LxQuality): string => {
    switch (quality) {
        case 'flac':
        case 'flac24bit':
        case 'hires':
        case 'atmos':
        case 'ape':
        case 'wav':
        case 'dsd':
            return 'flac';
        default:
            return 'mp3';
    }
};

/** 文件名：把模板里的「歌名」「歌手」替换成实际值（对齐 lx 的 createDownloadInfo）。 */
const buildFileName = (song: SongResult, template: string, ext: string): string => {
    const singer = (song.artists ?? []).map(artist => artist.name).filter(Boolean).join('、') || '未知歌手';
    const base = template.replace('歌名', song.name).replace('歌手', singer) || song.name;
    return `${base}.${ext}`;
};

// ---- 歌词合并：把 tlyric / rlyric 里与主歌词同时间轴的行拼进歌词文本（移植自 lx 的 worker/download/lrcTool.ts）----
// lx 用 /g 的 timeFieldExp 配 exec，lastIndex 会在多行循环里残留；这里用非全局版本，语义相同且更稳。
const TIME_FIELD_EXP = /^(?:\[[\d:.]+\])+/;
const TIME_EXP = /\d{1,3}(:\d{1,3}){0,2}(?:\.\d{1,3})/g;

const formatTimeLabel = (label: string): string => label
    .replace(/^0+(\d+)/, '$1')
    .replace(/:0+(\d+)/g, ':$1')
    .replace(/\.0+(\d+)/, '.$1');

/** 只保留与主歌词时间轴重合的翻译 / 罗马音行，避免把错位翻译写进 .lrc。 */
const filterExtendedLyric = (lrcTimeLabels: Set<string>, extendedLyric: string): string => {
    const lines: string[] = [];
    for (const rawLine of extendedLyric.split(/\r\n|\n|\r/)) {
        const line = rawLine.trim();
        const timeField = TIME_FIELD_EXP.exec(line);
        if (!timeField) continue;
        const text = line.replace(TIME_FIELD_EXP, '').trim();
        if (!text) continue;
        const times = timeField[0].match(TIME_EXP);
        if (!times) continue;
        const newTimes = times.filter(time => lrcTimeLabels.has(formatTimeLabel(time)));
        if (newTimes.length !== times.length) {
            if (!newTimes.length) continue;
            lines.push(`[${newTimes.join('][')}]${text}`);
        } else {
            lines.push(line);
        }
    }
    return lines.join('\n');
};

const parseLrcTimeLabels = (lrc: string): Set<string> => {
    const labels = new Set<string>();
    for (const rawLine of lrc.split(/\r\n|\n|\r/)) {
        const line = rawLine.trim();
        const timeField = TIME_FIELD_EXP.exec(line);
        if (!timeField) continue;
        if (!line.replace(TIME_FIELD_EXP, '').trim()) continue;
        const times = timeField[0].match(TIME_EXP);
        if (!times) continue;
        for (const time of times) labels.add(formatTimeLabel(time));
    }
    return labels;
};

/** UTF-8 文本 → base64（等价 lx 的 `Buffer.from(text, 'utf-8').toString('base64')`，渲染层没有 Buffer）。 */
const toBase64Utf8 = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};

/** LX Music 逐字歌词块（移植自 lx lrcTool.ts 的 buildAwlyric，第 62-77 行）：把各语言歌词 base64 后拼成 `[awlrc:...]`。 */
const buildAwlyric = (lrcData: LxLyricResult): string => {
    const parts: string[] = [];
    if (lrcData.lyric) parts.push(`lrc:${toBase64Utf8(lrcData.lyric.trim())}`);
    if (lrcData.tlyric) parts.push(`tlrc:${toBase64Utf8(lrcData.tlyric.trim())}`);
    if (lrcData.rlyric) parts.push(`rlrc:${toBase64Utf8(lrcData.rlyric.trim())}`);
    if (lrcData.lxlyric) parts.push(`awlrc:${toBase64Utf8(lrcData.lxlyric.trim())}`);
    return parts.length ? `[awlrc:${parts.join(',')}]` : '';
};

/**
 * 组装要写入歌词的文本（移植自 lx lrcTool.ts buildLyrics 第 79-101 行）：
 * 主歌词 +（可选）翻译 +（可选）罗马音 +（可选）LX Music 逐字块；逐字块总是最后追加。
 */
const buildLyrics = (
    lrcData: LxLyricResult,
    downloadLxLyric: boolean,
    downloadT: boolean,
    downloadR: boolean,
): string => {
    if (!lrcData.tlyric && !lrcData.rlyric && !lrcData.lxlyric) return lrcData.lyric;
    const labels = parseLrcTimeLabels(lrcData.lyric);
    let lrc = lrcData.lyric;
    if (downloadT && lrcData.tlyric) lrc = `${lrc.trim()}\n\n${filterExtendedLyric(labels, lrcData.tlyric)}\n`;
    if (downloadR && lrcData.rlyric) lrc = `${lrc.trim()}\n\n${filterExtendedLyric(labels, lrcData.rlyric)}\n`;
    if (downloadLxLyric) {
        const awlrc = buildAwlyric(lrcData);
        if (awlrc) lrc = `${lrc.trim()}\n\n${awlrc}\n`;
    }
    return lrc;
};

let taskSeq = 0;
const makeTaskId = (): string => `lx_${Date.now().toString(36)}_${(taskSeq += 1)}`;

// 进度事件只在第一次下载时订阅一次，避免重复挂监听。
let progressListening = false;
const ensureProgressListener = (bridge: LuoxueDownloadBridge): void => {
    if (progressListening) return;
    progressListening = true;
    bridge.onDownloadProgress(payload => {
        if (!payload || typeof payload.taskId !== 'string') return;
        useLuoxueDownloadStore.getState().patchTask(payload.taskId, {
            received: Number(payload.received) || 0,
            total: Number(payload.total) || 0,
        });
    });
};

export const useLuoxueDownloadStore = create<LuoxueDownloadState>((set, get) => {
    /** 局部更新一个任务；找不到时是安全的空操作。 */
    const patchTask = (id: string, patch: Partial<LuoxueDownloadTask>): void => {
        set(state => {
            const index = state.tasks.findIndex(task => task.id === id);
            if (index === -1) return {};
            const tasks = state.tasks.slice();
            tasks[index] = { ...tasks[index], ...patch };
            return { tasks };
        });
    };

    return {
        tasks: [],
        // patchTask 挂在 store 上供进度监听调用（React 之外的模块级入口）。
        patchTask,

        startDownload: (song, quality) => {
            const bridge = getDownloadBridge();
            if (!bridge) {
                setStatusMessage({ type: 'error', text: '当前环境不支持下载（仅 Electron 桌面端可用）', nonce: Date.now() });
                return;
            }
            const settings = useLuoxueSettingsStore.getState();
            if (!settings.downloadEnabled) {
                setStatusMessage({ type: 'info', text: '下载功能未开启，请在「设置」面板打开', nonce: Date.now() });
                return;
            }
            if (!settings.downloadDir) {
                setStatusMessage({ type: 'info', text: '请先在「设置」面板选择下载目录', nonce: Date.now() });
                return;
            }
            if (!song) return;

            const id = makeTaskId();
            // 音质来自下载弹窗（按当前音源对该平台声明的档位选），文件名/扩展名先按它算一份初值，
            // 真正取地址时 runTask 还会按脚本声明做一次降级回退，那时再刷新这两项。
            const ext = qualityExt(quality);
            const task: LuoxueDownloadTask = {
                id,
                song,
                songName: song.name,
                artists: (song.artists ?? []).map(artist => artist.name).filter(Boolean).join('、') || '未知歌手',
                quality,
                ext,
                dir: settings.downloadDir,
                fileName: buildFileName(song, settings.fileNameFormat, ext),
                status: 'idle',
                received: 0,
                total: 0,
                error: null,
                filePath: null,
                tagMessage: null,
            };
            ensureProgressListener(bridge);
            set(state => ({ tasks: [...state.tasks, task] }));
            startNext();
        },

        cancelTask: (id) => {
            const task = get().tasks.find(item => item.id === id);
            if (!task || task.status === 'done') return;
            const bridge = getDownloadBridge();
            if (task.status === 'downloading' && bridge) {
                void Promise.resolve(bridge.downloadCancel(id)).catch(() => undefined);
            }
            patchTask(id, { status: 'error', error: '已取消' });
            // 让出并发槽位，把后面的排队任务顶上来。
            if (task.status === 'downloading') startNext();
        },

        retryTask: (id) => {
            const task = get().tasks.find(item => item.id === id);
            // 只有排队中 / 出错的任务能重试：已完成不必重试，下载中的要先取消。
            if (!task || task.status === 'done' || task.status === 'downloading') return;
            patchTask(id, { status: 'idle', error: null, received: 0, total: 0 });
            startNext();
        },

        removeTask: (id) => {
            const task = get().tasks.find(item => item.id === id);
            if (task?.status === 'downloading') {
                const bridge = getDownloadBridge();
                if (bridge) void Promise.resolve(bridge.downloadCancel(id)).catch(() => undefined);
            }
            set(state => ({ tasks: state.tasks.filter(item => item.id !== id) }));
            startNext();
        },

        clearFinished: () => {
            set(state => ({ tasks: state.tasks.filter(task => task.status !== 'done' && task.status !== 'error') }));
        },

        clearAll: () => {
            const bridge = getDownloadBridge();
            // 在途下载先中断，再清空列表。
            for (const task of get().tasks) {
                if (task.status === 'downloading' && bridge) void Promise.resolve(bridge.downloadCancel(task.id)).catch(() => undefined);
            }
            set({ tasks: [] });
        },
    };
});

/** ipcRenderer.invoke 的失败信息带一长串前缀（Error invoking remote method '...'），只留最后一段原因。 */
const shortInvokeError = (error: unknown): string => {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '') || text;
};

/** 在系统文件管理器里定位已下载的文件；非 Electron 环境（或旧构建没有该通道）只给出提示。 */
export const revealLuoxueDownload = (filePath: string | null): void => {
    if (!filePath) return;
    const bridge = getDownloadBridge();
    if (!bridge || typeof bridge.showItemInFolder !== 'function') {
        setStatusMessage({ type: 'info', text: '打开文件位置仅支持 Electron 桌面端', nonce: Date.now() });
        return;
    }
    void Promise.resolve(bridge.showItemInFolder(filePath))
        .then((ok) => {
            if (ok === false) setStatusMessage({ type: 'error', text: '文件已不存在，可能已被移动或删除', nonce: Date.now() });
        })
        .catch((error) => {
            const reason = shortInvokeError(error);
            // 主进程还没注册这个通道（改了主进程代码但只热重载了界面）时，直接说清怎么办。
            const text = /No handler registered/i.test(reason) ? '打开文件位置需要重启应用后生效（主进程尚未加载该功能）' : `打开文件位置失败：${reason}`;
            setStatusMessage({ type: 'error', text, nonce: Date.now() });
        });
};

const readText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 下载落盘成功后按设置把封面 / 歌词写进音频标签；任何失败只反映在任务备注里，不改变已完成状态。 */
const embedTags = async (
    taskId: string,
    bridge: LuoxueDownloadBridge,
    task: LuoxueDownloadTask,
    lxSource: string,
    info: LxMusicInfo | null,
    lrcData: LxLyricResult | null,
    settings: LuoxueSettingsState,
): Promise<void> => {
    if (!task.filePath) return;
    const patch = useLuoxueDownloadStore.getState().patchTask;
    // 主进程尚未提供 writeTags（旧构建 / 浏览器）时只提示，不当错误。
    if (typeof bridge.writeTags !== 'function') {
        setStatusMessage({ type: 'info', text: '当前环境不支持写入音频标签', nonce: Date.now() });
        return;
    }
    try {
        const rawInfo = (info ?? {}) as unknown as Record<string, unknown>;
        const rawMeta = rawInfo.meta as Record<string, unknown> | undefined;
        let coverUrl: string | undefined;
        if (settings.isEmbedPic) {
            // 照 lx saveMeta：优先歌曲自带的 meta.picUrl，没有就用 SDK 的 getPic。
            const ownPic = readText(rawMeta?.picUrl);
            coverUrl = (ownPic || (info ? await getPic(lxSource, info).catch(() => '') : '')) || undefined;
        }
        // lyrics 只在 isEmbedLyric 为真时给；合并规则见 buildLyrics。
        const lyrics = settings.isEmbedLyric
            ? buildLyrics(lrcData ?? { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }, settings.isEmbedLyricLx, settings.isEmbedLyricT, settings.isEmbedLyricR)
            : undefined;
        const result = await bridge.writeTags({
            filePath: task.filePath,
            meta: {
                title: readText(rawInfo.name) || task.songName,
                // lx 把歌手的 `、` 分隔替换成 `;`（saveMeta 里 singer.replaceAll('、', ';')）。
                artist: (readText(rawInfo.singer) || task.artists).replace(/、/g, ';'),
                album: readText(rawMeta?.albumName) || readText(rawInfo.albumName) || task.song.album?.name || '',
                ...(coverUrl ? { coverUrl } : {}),
                ...(lyrics !== undefined ? { lyrics } : {}),
            },
        });
        if (result?.supported === false) {
            patch(taskId, { tagMessage: result.reason ? `未写入标签：${result.reason}` : '未写入标签：当前文件格式不支持' });
        } else if (result?.written) {
            patch(taskId, { tagMessage: '已写入标签' });
        } else {
            patch(taskId, { tagMessage: result?.reason ? `未写入标签：${result.reason}` : '未写入标签' });
        }
    } catch (error) {
        patch(taskId, { tagMessage: `写入标签失败：${errorText(error)}` });
    }
};

/** 跑一个任务：解析地址 → 主进程落盘 →（可选）写歌词侧车文件 + 嵌入标签。 */
const runTask = async (taskId: string): Promise<void> => {
    const store = useLuoxueDownloadStore.getState();
    const task = store.tasks.find(item => item.id === taskId);
    if (!task) return;
    // 先同步置为 downloading，startNext 才能正确统计并发槽位。
    store.patchTask(taskId, { status: 'downloading', error: null, received: 0, total: 0 });
    let cancelled = false;
    try {
        const bridge = getDownloadBridge();
        if (!bridge) throw new Error('当前环境不支持下载（仅 Electron 桌面端可用）');
        const settings = useLuoxueSettingsStore.getState();
        const { lxSource, info } = resolveLuoxueSource(task.song, getBrowsePlatform());
        if (!info) throw new Error('无法取得歌曲信息，可能音源脚本未就绪');
        // 用户在弹窗里选的档位是目标音质；这里按音源脚本对该平台的声明做一次降级回退，
        // 保证真正请求的档位一定被支持（各平台支持范围不同，不能一概而论）。
        const quality = resolveLuoxueQuality(lxSource, task.quality);
        const url = await getMusicUrl(lxSource, info, quality);
        if (!url) throw new Error('音源未返回可下载的播放地址');
        const ext = qualityExt(quality);
        const fileName = buildFileName(task.song, settings.fileNameFormat, ext);
        store.patchTask(taskId, { quality, ext, fileName, dir: settings.downloadDir });

        const result = await bridge.download({
            taskId,
            url,
            dir: settings.downloadDir,
            fileName,
            skipExistFile: settings.skipExistFile,
        });
        store.patchTask(taskId, {
            status: 'done',
            received: Number(result?.received) || 0,
            total: Number(result?.total) || Number(result?.received) || 0,
            filePath: result?.filePath ?? null,
        });
        const doneTask: LuoxueDownloadTask = { ...task, fileName, dir: settings.downloadDir, filePath: result?.filePath ?? null };
        // 歌词只在需要嵌入标签时取一次；取失败不阻断后续流程。
        let lrcData: LxLyricResult | null = null;
        if (settings.isEmbedLyric) {
            try {
                lrcData = await getLyric(lxSource, info);
            } catch {
                lrcData = null;
            }
        }
        // 落盘成功后嵌入标签；失败只体现在任务备注里，不让已完成任务翻成失败。
        await embedTags(taskId, bridge, doneTask, lxSource, info, lrcData, settings);
        setStatusMessage({
            type: 'success',
            text: result?.skipped ? `「${task.songName}」已存在，跳过下载` : `「${task.songName}」下载完成`,
            nonce: Date.now(),
        });
    } catch (error) {
        cancelled = errorText(error).includes('取消');
        store.patchTask(taskId, { status: 'error', error: cancelled ? '已取消' : errorText(error) });
        if (!cancelled) {
            setStatusMessage({ type: 'error', text: `「${task.songName}」下载失败：${errorText(error)}`, nonce: Date.now() });
        }
    } finally {
        startNext();
    }
};

/** 调度：在并发上限内把排队（idle）的任务依次启动。 */
const startNext = (): void => {
    const max = Math.max(1, useLuoxueSettingsStore.getState().maxDownloadNum);
    const state = useLuoxueDownloadStore.getState();
    const running = state.tasks.filter(task => task.status === 'downloading').length;
    if (running >= max) return;
    const next = state.tasks.find(task => task.status === 'idle');
    if (!next) return;
    void runTask(next.id);
    // runTask 会同步把状态改成 downloading，这里递归继续填满并发槽位。
    startNext();
};
