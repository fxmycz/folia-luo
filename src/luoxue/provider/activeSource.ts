import { setCurrentSource } from '../sdk';

// src/luoxue/provider/activeSource.ts
// 洛雪版块的两个「当前」，是两件互不相干的事（lx 的模型本来就是这样）：
// - 浏览平台（`browsePlatform`）：搜索、排行榜、歌单这些目录能力由内置音源 provider 提供，跟着它切；
// - 音源脚本（`activeSourceId`，形如 user_api_xxx）：取播放地址 / 歌词 / 封面靠导入的自定义音源脚本。
// 切浏览平台不动当前脚本，切脚本也不改浏览平台。播放时按歌曲自己记录的 lxSource（见 model/luoxueSong）挑脚本实现，
// 所以换平台不会让队列里的旧歌失效。
//
// 用订阅式的小 store（而不是 zustand）是为了让 provider 层能在非 React 环境里直接读它。

const BROWSE_KEY = 'luoxue_browse_platform';
const SOURCE_KEY = 'luoxue_active_source';

/** 可用来浏览的 lx 内置平台。 */
export const BROWSE_PLATFORMS = ['kw', 'kg', 'tx', 'wy', 'mg', 'git'] as const;
export const DEFAULT_BROWSE_PLATFORM = 'kw';

export const isBrowsePlatform = (id: string): boolean => (BROWSE_PLATFORMS as readonly string[]).includes(id);

const readStored = (key: string): string => {
    if (typeof window === 'undefined') return '';
    try {
        return window.localStorage.getItem(key)?.trim() ?? '';
    } catch {
        return '';
    }
};

const writeStored = (key: string, value: string): void => {
    if (typeof window === 'undefined') return;
    try {
        if (value) window.localStorage.setItem(key, value);
        else window.localStorage.removeItem(key);
    } catch {
        // 存储不可用时只在内存里生效
    }
};

// 迁移旧版本存下的单一「当前音源」（那时它同时充当浏览平台与播放脚本）：是内置平台就并进浏览平台，否则当脚本。
const storedSource = readStored(SOURCE_KEY);
const migratedBrowse = isBrowsePlatform(storedSource) ? storedSource : '';

let browsePlatform = readStored(BROWSE_KEY) || migratedBrowse || DEFAULT_BROWSE_PLATFORM;
let activeSourceId = migratedBrowse ? '' : storedSource;

const listeners = new Set<() => void>();

const emit = (): void => {
    for (const listener of listeners) listener();
};

/** 浏览用的内置平台 id（搜索 / 排行榜 / 歌单都按它走）。 */
export const getBrowsePlatform = (): string => browsePlatform;

export const setBrowsePlatform = (id: string): void => {
    if (!isBrowsePlatform(id) || id === browsePlatform) return;
    browsePlatform = id;
    writeStored(BROWSE_KEY, id);
    emit();
};

/** 当前音源脚本 id（空串 = 还没导入过脚本）。 */
export const getActiveLuoxueSourceId = (): string => activeSourceId;

export const setActiveLuoxueSourceId = (id: string): void => {
    const next = id.trim();
    if (!next || next === activeSourceId) return;
    activeSourceId = next;
    writeStored(SOURCE_KEY, next);
    setCurrentSource(next);
    emit();
};

/** 把持久化的音源同步给 SDK（应用启动时调用一次即可）。 */
export const syncActiveLuoxueSourceToSdk = (): void => {
    setCurrentSource(activeSourceId);
};

export const subscribeActiveLuoxueSource = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
