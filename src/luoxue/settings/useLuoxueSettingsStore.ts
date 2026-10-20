import { create } from 'zustand';
import type { LxQuality } from '../sdk';

// src/luoxue/settings/useLuoxueSettingsStore.ts
// 洛雪自己的设置（音质 + 下载），移植自 lx 的 defaultSetting.ts 与 SettingPlay / SettingDownload。
// 只保存洛雪版块用得到的项，用 localStorage 单独持久化（键 luoxue_settings），与 folia 的全局设置互不影响。

const STORAGE_KEY = 'luoxue_settings';

/** 播放音质可选值：对齐 lx 设置页的播放音质列表（由低到高）。 */
export const LUOXUE_PLAY_QUALITY_OPTIONS: readonly LxQuality[] = ['128k', '192k', '320k', 'flac', 'hires', 'atmos'];
/**
 * 下载音质的兜底档位：只在无法得知音源脚本声明了什么时使用。
 * 正常路径是点下载时弹窗、选项由「当前音源脚本对该平台声明的 qualitys」决定（各平台不同），见 components/LuoxueDownloadDialog。
 */
export const LUOXUE_DOWNLOAD_QUALITY_OPTIONS: readonly LxQuality[] = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires'];

/**
 * 音质标识 → 展示名（逐字对齐 ikun DownloadModal 的 getTypeName：普通音质 / 高清音质 / 无损音质 三档 + 具体格式）；
 * 设置面板的播放音质与下载弹窗共用。ikun 未覆盖的档位（flac24bit 等）按同一套文案补全。
 */
export const LUOXUE_QUALITY_LABELS: Record<string, string> = {
    '128k': '普通音质 128K',
    '192k': '普通音质 192K',
    '320k': '高清音质 320K',
    flac: '高清音质 FLAC',
    flac24bit: '无损音质 FLAC 24bit',
    hires: '无损音质 FLAC Hires',
    atmos: '无损音质 Atmos',
    atmos_plus: '无损音质 Atmos 2.0',
    master: '无损音质 Master',
};

/** 命名模板：对齐 lx download.fileName 的三个取值。 */
export const LUOXUE_FILE_NAME_TEMPLATES = ['歌名 - 歌手', '歌手 - 歌名', '歌名'] as const;
export type LuoxueFileNameTemplate = (typeof LUOXUE_FILE_NAME_TEMPLATES)[number];

export type LuoxueSettingsState = {
    /** 播放音质（优先于 folia 全局音质偏好，见 provider/luoxueProvider）。 */
    playQuality: LxQuality;
    /** 下载目录（绝对路径）；为空时不允许发起下载。 */
    downloadDir: string;
    /** 下载功能总开关（对应 lx download.enable）。 */
    downloadEnabled: boolean;
    /** 目标文件已存在且非空时跳过（对应 lx download.skipExistFile）。 */
    skipExistFile: boolean;
    /** 同时下载数（对应 lx download.maxDownloadNum）。 */
    maxDownloadNum: number;
    /** 文件名模板（对应 lx download.fileName）。 */
    fileNameFormat: LuoxueFileNameTemplate;
    /** 嵌入封面（对应 lx download.isEmbedPic）。 */
    isEmbedPic: boolean;
    /** 嵌入歌词（对应 lx download.isEmbedLyric）。 */
    isEmbedLyric: boolean;
    /** 同时嵌入 LX Music 逐字歌词（对应 lx download.isEmbedLyricLx）。 */
    isEmbedLyricLx: boolean;
    /** 同时嵌入翻译歌词（对应 lx download.isEmbedLyricT）。 */
    isEmbedLyricT: boolean;
    /** 同时嵌入罗马音歌词（对应 lx download.isEmbedLyricR）。 */
    isEmbedLyricR: boolean;
    /**
     * 省点模式：不预取洛雪歌曲的播放地址，只在真正播放时取一次（重播命中缓存不再问脚本）。
     * 自定义音源脚本按次计费（例如每日 300 次），folia 原有的邻居预取会为前后几首各扣一次点，
     * 所以默认开；关掉后队列前后几首会提前取址，切换更顺滑但更耗额度。
     */
    quotaSaver: boolean;

    setPlayQuality: (quality: LxQuality) => void;
    setDownloadDir: (dir: string) => void;
    setDownloadEnabled: (enabled: boolean) => void;
    setSkipExistFile: (enabled: boolean) => void;
    setMaxDownloadNum: (num: number) => void;
    setFileNameFormat: (template: LuoxueFileNameTemplate) => void;
    setIsEmbedPic: (enabled: boolean) => void;
    setIsEmbedLyric: (enabled: boolean) => void;
    setIsEmbedLyricLx: (enabled: boolean) => void;
    setIsEmbedLyricT: (enabled: boolean) => void;
    setIsEmbedLyricR: (enabled: boolean) => void;
    setQuotaSaver: (enabled: boolean) => void;
};

/** 可持久化的字段集合（动作不落盘）。 */
type PersistedSettings = Pick<
    LuoxueSettingsState,
    'playQuality' | 'downloadDir' | 'downloadEnabled' | 'skipExistFile' | 'maxDownloadNum' | 'fileNameFormat' | 'isEmbedPic' | 'isEmbedLyric' | 'isEmbedLyricLx' | 'isEmbedLyricT' | 'isEmbedLyricR' | 'quotaSaver'
>;

// 默认值对齐 lx defaultSetting.ts（playQuality 128k / skipExistFile true / maxDownloadNum 3 / 文件名「歌名 - 歌手」/ 下载开关默认关；
// 嵌入封面与逐字歌词默认开，嵌入歌词/翻译/罗马音默认关）。
const DEFAULT_SETTINGS: PersistedSettings = {
    playQuality: '128k',
    downloadDir: '',
    downloadEnabled: false,
    skipExistFile: true,
    maxDownloadNum: 3,
    fileNameFormat: '歌名 - 歌手',
    isEmbedPic: true,
    isEmbedLyric: false,
    isEmbedLyricLx: true,
    isEmbedLyricT: false,
    isEmbedLyricR: false,
    // 省点模式默认开：限量音源下，邻居预取会白扣额度，默认行为按最省额度的来。
    quotaSaver: true,
};

const includesQuality = (list: readonly LxQuality[], value: unknown): value is LxQuality =>
    typeof value === 'string' && (list as readonly string[]).includes(value);

/** 从 localStorage 读取并做基础校验；损坏或缺失时整体回退到默认值。 */
const readPersisted = (): Partial<PersistedSettings> => {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const result: Partial<PersistedSettings> = {};
        if (includesQuality(LUOXUE_PLAY_QUALITY_OPTIONS, parsed.playQuality)) result.playQuality = parsed.playQuality;
        if (typeof parsed.downloadDir === 'string') result.downloadDir = parsed.downloadDir;
        if (typeof parsed.downloadEnabled === 'boolean') result.downloadEnabled = parsed.downloadEnabled;
        if (typeof parsed.skipExistFile === 'boolean') result.skipExistFile = parsed.skipExistFile;
        if (typeof parsed.maxDownloadNum === 'number' && Number.isFinite(parsed.maxDownloadNum)) {
            result.maxDownloadNum = Math.min(6, Math.max(1, Math.round(parsed.maxDownloadNum)));
        }
        if (typeof parsed.fileNameFormat === 'string' && (LUOXUE_FILE_NAME_TEMPLATES as readonly string[]).includes(parsed.fileNameFormat)) {
            result.fileNameFormat = parsed.fileNameFormat as LuoxueFileNameTemplate;
        }
        if (typeof parsed.isEmbedPic === 'boolean') result.isEmbedPic = parsed.isEmbedPic;
        if (typeof parsed.isEmbedLyric === 'boolean') result.isEmbedLyric = parsed.isEmbedLyric;
        if (typeof parsed.isEmbedLyricLx === 'boolean') result.isEmbedLyricLx = parsed.isEmbedLyricLx;
        if (typeof parsed.isEmbedLyricT === 'boolean') result.isEmbedLyricT = parsed.isEmbedLyricT;
        if (typeof parsed.isEmbedLyricR === 'boolean') result.isEmbedLyricR = parsed.isEmbedLyricR;
        if (typeof parsed.quotaSaver === 'boolean') result.quotaSaver = parsed.quotaSaver;
        return result;
    } catch {
        return {};
    }
};

const persist = (state: PersistedSettings): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            playQuality: state.playQuality,
            downloadDir: state.downloadDir,
            downloadEnabled: state.downloadEnabled,
            skipExistFile: state.skipExistFile,
            maxDownloadNum: state.maxDownloadNum,
            fileNameFormat: state.fileNameFormat,
            isEmbedPic: state.isEmbedPic,
            isEmbedLyric: state.isEmbedLyric,
            isEmbedLyricLx: state.isEmbedLyricLx,
            isEmbedLyricT: state.isEmbedLyricT,
            isEmbedLyricR: state.isEmbedLyricR,
            quotaSaver: state.quotaSaver,
        }));
    } catch {
        // 存储不可用时只保留内存里的设置
    }
};

const pickPersisted = (state: PersistedSettings): PersistedSettings => ({
    playQuality: state.playQuality,
    downloadDir: state.downloadDir,
    downloadEnabled: state.downloadEnabled,
    skipExistFile: state.skipExistFile,
    maxDownloadNum: state.maxDownloadNum,
    fileNameFormat: state.fileNameFormat,
    isEmbedPic: state.isEmbedPic,
    isEmbedLyric: state.isEmbedLyric,
    isEmbedLyricLx: state.isEmbedLyricLx,
    isEmbedLyricT: state.isEmbedLyricT,
    isEmbedLyricR: state.isEmbedLyricR,
    quotaSaver: state.quotaSaver,
});

export const useLuoxueSettingsStore = create<LuoxueSettingsState>((set, get) => {
    // 设置类动作统一「写入 → 落盘」，避免每个 setXxx 都重复持久化逻辑。
    const apply = (patch: Partial<PersistedSettings>): void => {
        set(patch as Partial<LuoxueSettingsState>);
        persist(pickPersisted(get()));
    };

    return {
        ...DEFAULT_SETTINGS,
        ...readPersisted(),

        setPlayQuality: quality => apply({ playQuality: quality }),
        setDownloadDir: dir => apply({ downloadDir: dir }),
        setDownloadEnabled: enabled => apply({ downloadEnabled: enabled }),
        setSkipExistFile: enabled => apply({ skipExistFile: enabled }),
        setMaxDownloadNum: num => apply({ maxDownloadNum: Math.min(6, Math.max(1, Math.round(num))) }),
        setFileNameFormat: template => apply({ fileNameFormat: template }),
        setIsEmbedPic: enabled => apply({ isEmbedPic: enabled }),
        setIsEmbedLyric: enabled => apply({ isEmbedLyric: enabled }),
        setIsEmbedLyricLx: enabled => apply({ isEmbedLyricLx: enabled }),
        setIsEmbedLyricT: enabled => apply({ isEmbedLyricT: enabled }),
        setIsEmbedLyricR: enabled => apply({ isEmbedLyricR: enabled }),
        setQuotaSaver: enabled => apply({ quotaSaver: enabled }),
    };
});

/** 常用字段选择器：一次订阅面板需要的全部设置，避免每次渲染重建对象。 */
export const selectLuoxueSettings = (state: LuoxueSettingsState) => ({
    playQuality: state.playQuality,
    downloadDir: state.downloadDir,
    downloadEnabled: state.downloadEnabled,
    skipExistFile: state.skipExistFile,
    maxDownloadNum: state.maxDownloadNum,
    fileNameFormat: state.fileNameFormat,
    isEmbedPic: state.isEmbedPic,
    isEmbedLyric: state.isEmbedLyric,
    isEmbedLyricLx: state.isEmbedLyricLx,
    isEmbedLyricT: state.isEmbedLyricT,
    isEmbedLyricR: state.isEmbedLyricR,
    quotaSaver: state.quotaSaver,
});
