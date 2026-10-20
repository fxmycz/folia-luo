import type { AudioQualityPreference, MediaId, OnlineMusicProvider, ProviderCapabilities, ProviderCollection, ProviderLyricsResult, ProviderPage } from '../../types/onlineMusic';
import type { SongResult, UnifiedSong } from '../../types';
import { registerOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import { resolveFoliumLyricsResult } from '../../mods/folium/lyricsSource';
import { LUOXUE_PROVIDER_ID, resolveLuoxueSource, toLuoxueSongs } from '../model/luoxueSong';
import type { LxBoard, LxMusicInfo, LxQuality, LxSongListInfo } from '../sdk';
import { getLeaderboardDetail, getLyric, getLeaderboards, getMusicUrl, getSongListDetail, getSongLists, searchMusic, searchSongLists } from '../sdk';
import { useLuoxueSettingsStore } from '../settings/useLuoxueSettingsStore';
import { getBrowsePlatform } from './activeSource';

// src/luoxue/provider/luoxueProvider.ts
// 把洛雪音源接进 folia 的 omni：注册一个 provider id = 'luoxue' 的适配器，让播放、歌词、搜索、
// 队列预取这些既有链路原样工作，洛雪版块不需要自己写一套播放器。
//
// provider 只出现在 omni 的注册表里，不参与平台登录：getAvailability 报 runtime-unavailable，
// 于是 folia 原有的平台切换器（grid / bravais）会把它过滤掉，界面与以前完全一样。

/** folia 的音质选项 → lx 音质标识；hires 优先 24bit，降级顺序依次往低走。 */
const QUALITY_DOWNGRADE_ORDER: Record<AudioQualityPreference, string[]> = {
    standard: ['128k'],
    high: ['320k', '128k'],
    ultra: ['flac', '320k', '128k'],
    lossless: ['flac', '320k', '128k'],
    hires: ['flac24bit', 'hires', 'flac', '320k', '128k'],
};

/** lx 音质由高到低（含 24bit），供「显式音质」按脚本声明做降级回退。 */
const LUOXUE_QUALITY_ORDER: readonly string[] = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', 'ape', 'wav', 'dsd', '320k', '192k', '128k'];

/**
 * 给定一个期望的 lx 音质，按「由高到低」挑第一个被当前脚本声明支持的音质。
 * 脚本未声明任何音质时直接用期望值；声明的都不匹配时回退到最低的 128k。供播放与下载共用。
 */
export const resolveLuoxueQuality = (lxSource: string, preferred: string): LxQuality => {
    const startIndex = LUOXUE_QUALITY_ORDER.indexOf(preferred);
    const order = startIndex >= 0 ? LUOXUE_QUALITY_ORDER.slice(startIndex) : [preferred, ...LUOXUE_QUALITY_ORDER];
    const supported = getLuoxueSupportedQualitys(lxSource);
    if (supported.length === 0) return (order[0] ?? '128k') as LxQuality;
    const picked = order.find(quality => supported.includes(quality));
    return (picked ?? '128k') as LxQuality;
};

/** 自定义源在 `qualitys` 里对每个音源各声明一组支持的音质；按降级顺序挑第一个被支持的。 */
const resolveLxQuality = (lxSource: string, preference: AudioQualityPreference): LxQuality => {
    // 洛雪自己的「播放音质」优先于 folia 全局偏好：设置了显式音质就按它，并按脚本声明做降级回退。
    const explicit = useLuoxueSettingsStore.getState().playQuality;
    if (typeof explicit === 'string' && explicit) return resolveLuoxueQuality(lxSource, explicit);
    const order = QUALITY_DOWNGRADE_ORDER[preference] ?? QUALITY_DOWNGRADE_ORDER.high;
    const supported = getLuoxueSupportedQualitys(lxSource);
    if (supported.length === 0) return order[0] as LxQuality;
    const picked = order.find(quality => supported.includes(quality));
    return (picked ?? order[0]) as LxQuality;
};

/** 当前自定义源为这个 lx 音源声明的音质列表；内置音源没有声明时返回空数组。 */
export const getLuoxueSupportedQualitys = (lxSource: string): string[] => {
    // 动态读取，避免与运行时的循环依赖（运行时在 provider 之后装配）。
    const runtime = getSourceRuntimeRef();
    if (!runtime) return [];
    for (const info of runtime.getSourceInfo()) {
        const qualitys = (info as { qualitys?: Record<string, string[]> }).qualitys;
        const list = qualitys?.[lxSource];
        if (Array.isArray(list) && list.length > 0) return list.map(String);
    }
    return [];
};

type SourceRuntimeLike = {
    getApis(source: string): unknown;
    getSourceIds(): string[];
    getSourceInfo(): Array<{ id: string; name: string }>;
};

let sourceRuntime: SourceRuntimeLike | null = null;

/** 由 bootstrap 注入自定义源运行时；provider 只用它读「这个音源支持哪些音质」。 */
export const setLuoxueSourceRuntimeRef = (runtime: SourceRuntimeLike | null): void => {
    sourceRuntime = runtime;
};

const getSourceRuntimeRef = (): SourceRuntimeLike | null => sourceRuntime;

/** lx 列表 → omni 分页；页码从 1 开始，offset 由调用方给。 */
const toPage = (list: LxMusicInfo[], lxSource: string, offset: number, hasMore: boolean, total?: number): ProviderPage<UnifiedSong> => {
    const items = toLuoxueSongs(list, lxSource) as unknown as UnifiedSong[];
    return {
        items,
        hasMore,
        nextOffset: offset + items.length,
        ...(Number.isFinite(total) ? { total } : {}),
    };
};

/** 洛雪集合通过 providerData 记住自己是「排行榜」还是「歌单」，以及它属于哪个音源。 */
type LuoxueCollectionData = { kind: 'leaderboard' | 'songlist'; lxSource: string; id: string };

const readCollectionData = (collection: ProviderCollection | undefined): LuoxueCollectionData | null => {
    const data = collection?.providerData as unknown as LuoxueCollectionData | undefined;
    if (!data || typeof data.id !== 'string' || typeof data.lxSource !== 'string') return null;
    if (data.kind !== 'leaderboard' && data.kind !== 'songlist') return null;
    return data;
};

/** 排行榜 / 歌单列表 → omni 集合（供洛雪版块用 omni 打开后取曲目）。 */
export const toLuoxueBoardCollection = (board: LxBoard, lxSource: string): ProviderCollection => ({
    providerId: LUOXUE_PROVIDER_ID,
    id: String(board.id),
    name: board.name,
    type: 'playlist',
    coverUrl: board.picUrl ?? board.img ?? undefined,
    ...(typeof board.total === 'number' ? { trackCount: board.total } : {}),
    providerData: { kind: 'leaderboard', lxSource, id: String(board.id) } as unknown as ProviderCollection['providerData'],
});

export const toLuoxueSongListCollection = (list: LxSongListInfo, lxSource: string): ProviderCollection => ({
    providerId: LUOXUE_PROVIDER_ID,
    id: String(list.id),
    name: list.name,
    type: 'playlist',
    coverUrl: list.picUrl ?? list.img ?? undefined,
    description: list.desc ?? undefined,
    ...(typeof list.total === 'number' ? { trackCount: list.total } : {}),
    ...(list.author ? { publisher: list.author } : {}),
    providerData: { kind: 'songlist', lxSource, id: String(list.id) } as unknown as ProviderCollection['providerData'],
});

/**
 * lx 各音源的排行榜 id 形如 `kw__93`（`平台__真实榜单id`），前缀只用来让多平台的榜单在界面上不重名；
 * 而榜单接口（如酷我 bang_info）只认后半段的真实 id。这里按 `__` 切开取第二段，与 lx desktop 一致。
 */
const parseLuoxueBoardId = (boardId: string): string => {
    const parts = String(boardId).split('__');
    return parts.length > 1 ? parts[1] : parts[0];
};

/** 排行榜曲目：分页拉取并转成统一歌曲模型。 */
export const getLuoxueBoardTracks = async (lxSource: string, boardId: string, page = 1): Promise<ProviderPage<UnifiedSong>> => {
    const result = await getLeaderboardDetail(lxSource, parseLuoxueBoardId(boardId), page);
    const offset = (page - 1) * (result.list.length || 0);
    return toPage(result.list, lxSource, offset, result.list.length > 0, result.total);
};

const buildLuoxueProvider = (): OnlineMusicProvider => {
    const capabilities: ProviderCapabilities = {
        search: true,
        playback: true,
        lyrics: true,
        auth: false,
        userLibrary: false,
        playlists: false,
        albums: false,
        artists: false,
        recommendations: false,
        mutations: false,
        wordByWordLyrics: true,
    };

    return {
        id: LUOXUE_PROVIDER_ID,
        displayName: '洛雪音源',
        shortName: '洛雪',
        // 不参与平台登录：这个声明让 grid / bravais 的平台切换器把它过滤掉，folia 原来的界面不出现它。
        getAvailability: () => ({ configured: false, reason: 'runtime-unavailable' as const }),
        capabilities,
        // 洛雪歌曲在构造时已经是 UnifiedSong 形状（见 model/luoxueSong），normalize 只做校验与直通。
        normalizeSong: (raw) => {
            const candidate = raw as UnifiedSong;
            if (candidate?.sourceRef?.kind === 'online' && candidate.sourceRef.providerId === LUOXUE_PROVIDER_ID) return candidate;
            throw new Error('luoxue: cannot normalize song');
        },
        search: {
            searchSongs: async (query, limit, offset) => {
                const lxSource = getBrowsePlatform();
                const page = Math.floor(offset / Math.max(limit, 1)) + 1;
                const result = await searchMusic(lxSource, query, page, limit);
                return toPage(result.list, lxSource, offset, result.list.length >= limit, result.total);
            },
        },
        playback: {
            // lx 没有「按 id 查歌」的通用接口，取不到就返回 null，由上层按缺失处理。
            getSongDetail: async (_id: MediaId) => null,
            getAudioSource: async (song: SongResult, quality: AudioQualityPreference) => {
                const { lxSource, info } = resolveLuoxueSource(song, getBrowsePlatform());
                if (!info) return null;
                const url = await getMusicUrl(lxSource, info, resolveLxQuality(lxSource, quality));
                if (!url) return null;
                return { url, fetchedAt: Date.now(), quality };
            },
        },
        lyrics: {
            getLyrics: async (song: SongResult): Promise<ProviderLyricsResult> => {
                const { lxSource, info } = resolveLuoxueSource(song, getBrowsePlatform());
                if (!info) return { lyrics: null, isPureMusic: false };
                const result = await getLyric(lxSource, info);
                // lxlyric 是逐字（YRC）；交给 folia 本地的歌词管线按格式解析，与 NetEase 的 yrc 走同一条路。
                return resolveFoliumLyricsResult({
                    main: result.lyric ? { format: 'lrc', text: result.lyric, translationText: result.tlyric || undefined, romanizationText: result.rlyric || undefined } : undefined,
                    wordByWord: result.lxlyric ? { format: 'yrc', text: result.lxlyric } : undefined,
                    isPureMusic: !result.lyric && !result.lxlyric,
                }, 'luoxue');
            },
        },
        catalog: {
            // 洛雪版块把排行榜 / 歌单包成 omni 集合，这里按集合自带的 providerData 分派到对应音源接口。
            getPlaylistTracks: async (id, limit, offset, collection) => {
                const data = readCollectionData(collection);
                if (!data) return { items: [], hasMore: false, nextOffset: offset };
                if (data.kind === 'leaderboard') {
                    return getLuoxueBoardTracks(data.lxSource, String(id), Math.floor(offset / Math.max(limit, 1)) + 1);
                }
                const result = await getSongListDetail(data.lxSource, String(id), Math.floor(offset / Math.max(limit, 1)) + 1, limit);
                return toPage(result.list, data.lxSource, offset, result.list.length >= limit, result.total);
            },
            getPlaylistDetail: async (id, collection) => {
                const data = readCollectionData(collection);
                if (!data || data.kind !== 'songlist') return collection ?? null;
                const result = await getSongListDetail(data.lxSource, String(id), 1, 0);
                return result.info ? toLuoxueSongListCollection(result.info, data.lxSource) : (collection ?? null);
            },
        },
    };
};

let registered = false;

/** 幂等注册：重复调用不会产生第二个 provider。 */
export const installLuoxueProvider = (): void => {
    if (registered) return;
    registered = true;
    registerOnlineMusicProvider(buildLuoxueProvider());
};

/** 供洛雪版块读取当前音源的排行榜列表（lx 专属能力，omni 契约里没有对应项）。 */
export const listLuoxueBoards = async (lxSource: string): Promise<ProviderCollection[]> => {
    const boards = await getLeaderboards(lxSource);
    return boards.map(board => toLuoxueBoardCollection(board, lxSource));
};

/** 供洛雪版块浏览歌单（lx 专属能力，与排行榜同理）。歌单列表的条目结构是歌单元信息，SDK 统一按 LxMusicInfo 报出。 */
export const listLuoxueSongLists = async (lxSource: string, tagId: string, page: number, limit: number): Promise<{ collections: ProviderCollection[]; total?: number }> => {
    const result = await getSongLists(lxSource, tagId, page, limit);
    return { collections: (result.list as unknown as LxSongListInfo[]).map(list => toLuoxueSongListCollection(list, lxSource)), total: result.total };
};

/** 按关键词搜歌单（lx 专属能力，与浏览歌单同理）：结果与浏览歌单同一套集合结构，打开后走同一条取曲目的路。 */
export const searchLuoxueSongLists = async (lxSource: string, keyword: string, page: number, limit: number): Promise<{ collections: ProviderCollection[]; total?: number }> => {
    const result = await searchSongLists(lxSource, keyword, page, limit);
    return { collections: (result.list as unknown as LxSongListInfo[]).map(list => toLuoxueSongListCollection(list, lxSource)), total: result.total };
};
