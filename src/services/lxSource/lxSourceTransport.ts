import { OnlineProviderError } from '../../types/onlineMusic';
import type { AudioQualityPreference, ProviderAvailability, ProviderErrorCode } from '../../types/onlineMusic';

// src/services/lxSource/lxSourceTransport.ts
// 渲染层访问自定义音源的唯一入口：封装主进程 preload 挂上的 `window.electron.lxSource`，
// 把统一 Result 形状转成 OnlineProviderError。桥只在桌面端存在，Web 端一律 runtime-unavailable。

export type LxSourceApiInfo = {
    id: string;
    name: string;
    description: string;
    author: string;
    homepage: string;
    version: string;
    allowShowUpdateAlert: boolean;
};

export type LxSourceSupport = {
    type: 'music';
    actions: string[];
    qualitys: string[];
};

export type LxSourceStatus = {
    activeApiId: string | null;
    loaded: boolean;
    message: string;
    /** 当前脚本声明的平台 → 支持的动作与音质。 */
    sources: Record<string, LxSourceSupport>;
};

export type LxSourceSnapshot = {
    apis: LxSourceApiInfo[];
    activeApiId: string | null;
    status: LxSourceStatus;
};

/** 本地文件导入的结果：用户取消时 canceled 为 true，snapshot 保持导入前状态。 */
export type LxSourceImportFileResult = {
    canceled: boolean;
    snapshot: LxSourceSnapshot;
};

export type LxSourceMusicUrlResult = { type?: string; url: string };

export type LxSourceLyricResult = {
    lyric: string;
    tlyric?: string | null;
    rlyric?: string | null;
    lxlyric?: string | null;
};

export type LxSourceMusicUrlPayload = {
    source: string;
    /** 交给脚本的平台字段（songmid / hash / copyrightId…）。 */
    musicInfo?: Record<string, unknown>;
    /** 已按音源声明解析好的洛雪音质：128k / 320k / flac / flac24bit。 */
    quality?: string;
};

export type LxSourceMusicInfoPayload = {
    source: string;
    musicInfo?: Record<string, unknown>;
};

/** Phase 2：主进程里移植的洛雪 musicSdk 返回的原始记录（榜单 / 歌单 / 歌曲）。 */
export type LxSourceRawTrack = Record<string, unknown>;

export type LxSourceBoard = {
    id: string;
    name: string;
    bangid: string;
    source?: string;
};

export type LxSourcePlaylist = {
    id: string;
    name: string;
    img?: string;
    author?: string;
    desc?: string;
    total?: number;
    play_count?: string;
    source: string;
};

export type LxSourcePlaylistInfo = {
    name?: string;
    img?: string;
    desc?: string;
    author?: string;
    play_count?: string;
};

/** 洛雪分页返回：`page` 是 1 起的页码，`total` 是总量。 */
export type LxSourcePage<T> = {
    list: T[];
    source: string;
    page?: number;
    limit?: number;
    total?: number;
    allPage?: number;
    info?: LxSourcePlaylistInfo | null;
};

export type LxSourceBoardsPayload = { source: string };
export type LxSourceBoardTracksPayload = { source: string; boardId: string; page: number; limit?: number };
export type LxSourcePlaylistTracksPayload = { source: string; id: string; page: number; limit?: number };
export type LxSourceSearchPayload = { source: string; query: string; page: number; limit?: number };
/** 搜索联想：平台没有联想接口时返回空数组。 */
export type LxSourceSuggestionPayload = { source: string; query: string };

/** 脚本发的更新提示（洛雪 `updateAlert` 事件）。 */
export type LxSourceUpdateAlert = {
    log: string;
    updateUrl?: string;
};

/** Phase 3：下载任务的公开状态。 */
export type LxDownloadStatus = 'queued' | 'downloading' | 'done' | 'error' | 'canceled';

export type LxDownloadTask = {
    taskId: string;
    name: string;
    artist: string;
    status: LxDownloadStatus;
    /** 实际使用的洛雪音质（未开始前为 null）。 */
    quality: string | null;
    requestedQuality: AudioQualityPreference;
    /** 目标音质不可用、已降级时为 true。 */
    degraded: boolean;
    receivedBytes: number;
    totalBytes: number;
    progress: number;
    error: string | null;
    filePath: string | null;
    /** 歌词 / 封面是否已成功内嵌（mp3 / flac 才有意义）。 */
    tagged?: boolean;
    /** 内嵌失败的原因；失败不影响下载本身。 */
    tagError?: string | null;
    createdAt: number;
};

export type LxDownloadSnapshot = { dir: string; tasks: LxDownloadTask[] };

/** 交给主进程的下载歌曲信息：source/musicInfo 来自歌曲的 sourceRef.providerData。 */
export type LxDownloadTrackPayload = {
    source: string;
    musicInfo: Record<string, unknown>;
    name: string;
    artist: string;
};

export type LxDownloadStartPayload = {
    track: LxDownloadTrackPayload;
    quality: AudioQualityPreference;
    targetDir?: string;
};

export type LxSourceBridgeResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } };

export interface LxSourceBridge {
    listApis(): Promise<LxSourceBridgeResult<LxSourceSnapshot>>;
    importScriptOnline(url: string): Promise<LxSourceBridgeResult<LxSourceSnapshot>>;
    importScriptText(text: string): Promise<LxSourceBridgeResult<LxSourceSnapshot>>;
    /** 弹系统文件选择框导入本地 .js 音源脚本。 */
    importScriptFile(): Promise<LxSourceBridgeResult<LxSourceImportFileResult>>;
    removeApis(ids: string[]): Promise<LxSourceBridgeResult<LxSourceSnapshot>>;
    setActive(apiId: string | null): Promise<LxSourceBridgeResult<LxSourceSnapshot>>;
    getStatus(): Promise<LxSourceBridgeResult<LxSourceSnapshot>>;
    getMusicUrl(payload: LxSourceMusicUrlPayload): Promise<LxSourceBridgeResult<LxSourceMusicUrlResult>>;
    getLyric(payload: LxSourceMusicInfoPayload): Promise<LxSourceBridgeResult<LxSourceLyricResult>>;
    getPic(payload: LxSourceMusicInfoPayload): Promise<LxSourceBridgeResult<string>>;
    // Phase 2：榜单 / 歌单 / 搜索（主进程里移植的洛雪 musicSdk，仅 kw / mg）。
    getBoards(source: string): Promise<LxSourceBridgeResult<LxSourcePage<LxSourceBoard>>>;
    getBoardTracks(payload: LxSourceBoardTracksPayload): Promise<LxSourceBridgeResult<LxSourcePage<LxSourceRawTrack>>>;
    getPlaylistTracks(payload: LxSourcePlaylistTracksPayload): Promise<LxSourceBridgeResult<LxSourcePage<LxSourceRawTrack>>>;
    searchSongs(payload: LxSourceSearchPayload): Promise<LxSourceBridgeResult<LxSourcePage<LxSourceRawTrack>>>;
    searchPlaylists(payload: LxSourceSearchPayload): Promise<LxSourceBridgeResult<LxSourcePage<LxSourcePlaylist>>>;
    /** 搜索联想词；平台不支持时为 `[]`。 */
    searchSuggestions(payload: LxSourceSuggestionPayload): Promise<LxSourceBridgeResult<string[]>>;
    // Phase 3：下载队列。
    chooseDownloadDir(): Promise<LxSourceBridgeResult<{ canceled: boolean; dir: string }>>;
    startDownload(payload: LxDownloadStartPayload): Promise<LxSourceBridgeResult<LxDownloadTask>>;
    cancelDownload(taskId: string): Promise<LxSourceBridgeResult<boolean>>;
    /** 删除一条已结束的下载记录（只移除列表项，不删磁盘文件）。 */
    removeDownload(taskId: string): Promise<LxSourceBridgeResult<boolean>>;
    listDownloads(): Promise<LxSourceBridgeResult<LxDownloadSnapshot>>;
    openDevTools(): Promise<LxSourceBridgeResult<boolean>>;
    onStatusChanged(callback: (status: LxSourceStatus) => void): () => void;
    onUpdateAlert(callback: (alert: LxSourceUpdateAlert) => void): () => void;
    onDownloadProgress(callback: (task: LxDownloadTask) => void): () => void;
}

export const getLxSourceBridge = (): LxSourceBridge | null => (
    typeof window !== 'undefined' && window.electron?.lxSource ? window.electron.lxSource : null
);

// 供 provider 的同步 getAvailability 使用：store 在状态更新时刷新它。
let hasActiveSource = false;

export const setLxSourceHasActiveSource = (active: boolean): void => {
    hasActiveSource = active;
};

/** 桥不存在（Web 端）→ runtime-unavailable；桥在但没有激活脚本 → not-configured。 */
export const getLxSourceAvailability = (): ProviderAvailability => {
    if (!getLxSourceBridge()) return { configured: false, reason: 'runtime-unavailable' };
    if (!hasActiveSource) return { configured: false, reason: 'not-configured' };
    return { configured: true };
};

const KNOWN_ERROR_CODES: ProviderErrorCode[] = [
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable',
    'preview-only', 'region-restricted', 'not-configured', 'network', 'invalid-response',
];

const toProviderErrorCode = (code: unknown): ProviderErrorCode => (
    typeof code === 'string' && (KNOWN_ERROR_CODES as string[]).includes(code)
        ? code as ProviderErrorCode
        : 'invalid-response'
);

/** 调一次桥并拆掉 Result；桥缺失或 IPC 抛错都收敛成 OnlineProviderError。 */
export const callLxSource = async <T>(
    providerId: string,
    call: (bridge: LxSourceBridge) => Promise<LxSourceBridgeResult<T>>,
): Promise<T> => {
    const bridge = getLxSourceBridge();
    if (!bridge) throw new OnlineProviderError('unavailable', '自定义音源需要桌面端运行', providerId);
    let result: LxSourceBridgeResult<T>;
    try {
        result = await call(bridge);
    } catch {
        throw new OnlineProviderError('network', '自定义音源请求失败', providerId);
    }
    if (!result?.ok) {
        throw new OnlineProviderError(
            toProviderErrorCode(result?.error?.code),
            result?.error?.message || '自定义音源请求失败',
            providerId,
        );
    }
    return result.data;
};
