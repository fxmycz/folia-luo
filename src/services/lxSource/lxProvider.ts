import type { UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    JsonValue,
    OnlineMusicProvider,
    ProviderAudioSource,
    ProviderCollection,
    ProviderLyricsResult,
    ProviderPage,
} from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import { isPureMusicLyricText } from '../../utils/lyrics/pureMusic';
import { callLxSource, getLxSourceAvailability } from './lxSourceTransport';
import type { LxSourceBoard, LxSourceLyricResult, LxSourcePlaylist } from './lxSourceTransport';
import { lxCoverUrl, lxMusicInfoFromSourceRef, lxProviderIdForSource, normalizeLxSong } from './lxNormalize';
import { useLxPlaybackQualityStore } from '../../stores/useLxPlaybackQualityStore';

// src/services/lxSource/lxProvider.ts
// 洛雪自定义音源在 Folia 里的 provider 适配器：每个平台一个（lx-kw / lx-mg …）。
// 歌曲数据来自移植的洛雪 musicSdk（Phase 2），播放直链与歌词则经宿主窗口里的用户脚本解析。

// Folia 的统一音质偏好 → 洛雪脚本使用的音质标识。
const QUALITY_FOR_PREFERENCE: Record<AudioQualityPreference, string> = {
    standard: '128k',
    high: '320k',
    lossless: 'flac',
    hires: 'flac24bit',
};
const QUALITY_ORDER = ['128k', '320k', 'flac', 'flac24bit'];

/** 平台展示名；未列出的平台直接回退到标识本身。 */
const PLATFORM_NAMES: Record<string, { displayName: string; shortName: string }> = {
    kw: { displayName: '酷我音乐', shortName: '酷我' },
    mg: { displayName: '咪咕音乐', shortName: '咪咕' },
    kg: { displayName: '酷狗音乐', shortName: '酷狗' },
    tx: { displayName: 'QQ音乐', shortName: 'QQ' },
    wy: { displayName: '网易云音乐', shortName: '网易云' },
};

// 在音源声明的音质里挑最接近偏好的一档：优先同名档，其次不高于它的最高档，最后退到最低档。
const pickQuality = (preference: AudioQualityPreference, supported: string[]): string => {
    const desired = QUALITY_FOR_PREFERENCE[preference] ?? '128k';
    const allowed = QUALITY_ORDER.filter(quality => supported.includes(quality));
    if (!allowed.length) return desired;
    if (allowed.includes(desired)) return desired;
    const desiredRank = QUALITY_ORDER.indexOf(desired);
    const lower = allowed.filter(quality => QUALITY_ORDER.indexOf(quality) < desiredRank);
    return lower.length ? lower[lower.length - 1] : allowed[0];
};

// 当前激活音源声明的音质集合；查询失败就当作未声明，让脚本自行处理。
const supportedQualitysFor = async (providerId: string, source: string): Promise<string[]> => {
    try {
        const snapshot = await callLxSource(providerId, bridge => bridge.getStatus());
        const qualitys = snapshot.status.sources?.[source]?.qualitys;
        return Array.isArray(qualitys) ? qualitys : [];
    } catch {
        return [];
    }
};

const buildLyricsResult = (payload: LxSourceLyricResult): ProviderLyricsResult => {
    const mainText = payload.lyric || '';
    const translation = payload.tlyric ?? '';
    const wordLyrics = payload.lxlyric ? parseLyricsByFormat('enhanced-lrc', payload.lxlyric, translation) : null;
    const plainLyrics = parseLyricsByFormat('lrc', mainText, translation);
    const lyrics = wordLyrics?.lines.length ? wordLyrics : plainLyrics;
    return {
        lyrics: lyrics.lines.length ? lyrics : null,
        mainText,
        wordByWordText: wordLyrics?.lines.length ? payload.lxlyric ?? undefined : undefined,
        translationText: payload.tlyric ?? null,
        isPureMusic: isPureMusicLyricText(mainText),
    };
};

const text = (value: unknown): string => (value == null ? '' : String(value));

// Omni 用 offset 分页，洛雪用 1 起的页码；offset 是 limit 的整数倍时两者一一对应。
const pageFromOffset = (limit: number, offset: number): number => (
    limit > 0 ? Math.floor(Math.max(0, offset) / limit) + 1 : 1
);

// 洛雪返回 total（有的平台是字符串）+ 本页条目，换算成 Omni 的分页形状。
// 条目为空时一律判为到底，避免上游 total 虚高导致调用方无限翻页。
const toProviderPage = <T>(items: T[], rawTotal: unknown, limit: number, offset: number): ProviderPage<T> => {
    const parsedTotal = Number(rawTotal);
    const total = Number.isFinite(parsedTotal) ? parsedTotal : undefined;
    const nextOffset = offset + items.length;
    const hasMore = items.length > 0 && (total !== undefined ? nextOffset < total : items.length >= limit);
    return { items, total, hasMore, nextOffset };
};

/** 为一个洛雪平台造一个 provider（id 形如 `lx-kw`）。 */
export const createLxProvider = (source: string): OnlineMusicProvider => {
    const providerId = lxProviderIdForSource(source);
    const names = PLATFORM_NAMES[source] ?? { displayName: source.toUpperCase(), shortName: source.toUpperCase() };

    // 榜单 → Omni 集合（type 固定 'leaderboard'，getCollectionTracks 据此转到榜单曲目）。
    const toBoardCollection = (item: LxSourceBoard): ProviderCollection => {
        const boardId = text(item.bangid ?? item.id);
        return {
            providerId,
            id: boardId,
            name: text(item.name) || boardId,
            type: 'leaderboard',
            providerData: { source, boardId },
        };
    };

    // 歌单搜索结果 → Omni 集合（type 'playlist'，打开后走 catalog.getPlaylistTracks）。
    const toPlaylistCollection = (item: LxSourcePlaylist): ProviderCollection => {
        const id = text(item.id);
        const trackCount = Number(item.total);
        return {
            providerId,
            id,
            name: text(item.name) || id,
            type: 'playlist',
            coverUrl: lxCoverUrl(item.img),
            description: item.desc ? text(item.desc) : undefined,
            trackCount: Number.isFinite(trackCount) ? trackCount : undefined,
            publisher: item.author ? text(item.author) : undefined,
            providerData: { source },
        };
    };

    const normalizeTracks = (list: unknown): UnifiedSong[] => (Array.isArray(list) ? list.map(normalizeLxSong) : []);

    // 榜单曲目 / 歌单曲目共用：page ↔ offset 适配后归一化成 UnifiedSong。
    const loadCollectionTracks = async (
        limit: number,
        offset: number,
        fetch: (page: number, limit: number) => Promise<{ list?: unknown; total?: unknown }>,
    ): Promise<ProviderPage<UnifiedSong>> => {
        const result = await fetch(pageFromOffset(limit, offset), limit);
        return toProviderPage(normalizeTracks(result.list), result.total, limit, offset);
    };

    const assertOwnedRef = (providerData?: Record<string, JsonValue>) => {
        const resolved = lxMusicInfoFromSourceRef(providerData);
        if (!resolved.source) throw new OnlineProviderError('unsupported', `歌曲不属于自定义音源 ${providerId}`, providerId);
        return resolved;
    };

    return {
        id: providerId,
        displayName: names.displayName,
        shortName: names.shortName,
        getAvailability: getLxSourceAvailability,
        capabilities: {
            search: true,
            playback: true,
            lyrics: true,
            wordByWordLyrics: true,
            leaderboards: true,
            auth: false,
            userLibrary: false,
            playlists: true,
            albums: false,
            artists: false,
            recommendations: false,
            mutations: false,
        },
        normalizeSong: normalizeLxSong,
        songMetadata: { getSongMetadata: createProviderSongMetadata },
        // 单曲搜索与歌单搜索都来自移植的洛雪 musicSdk（仅 kw / mg）。
        search: {
            async searchSongs(query, limit, offset): Promise<ProviderPage<UnifiedSong>> {
                const page = pageFromOffset(limit, offset);
                const result = await callLxSource(providerId, bridge => bridge.searchSongs({ source, query, page, limit }));
                return toProviderPage(normalizeTracks(result.list), result.total, limit, offset);
            },
            async searchPlaylists(query, limit, offset): Promise<ProviderPage<ProviderCollection>> {
                const page = pageFromOffset(limit, offset);
                const result = await callLxSource(providerId, bridge => bridge.searchPlaylists({ source, query, page, limit }));
                const items = Array.isArray(result.list) ? result.list.map(toPlaylistCollection) : [];
                return toProviderPage(items, result.total, limit, offset);
            },
        },
        // 平台榜单：集合类型 'leaderboard'，曲目走 getLeaderboardTracks。
        leaderboards: {
            async getLeaderboards(): Promise<ProviderCollection[]> {
                const result = await callLxSource(providerId, bridge => bridge.getBoards(source));
                return Array.isArray(result.list) ? result.list.map(toBoardCollection) : [];
            },
            getLeaderboardTracks(id, limit, offset, collection): Promise<ProviderPage<UnifiedSong>> {
                const boardId = text(collection?.providerData?.boardId) || String(id);
                return loadCollectionTracks(limit, offset, (page, pageLimit) => (
                    callLxSource(providerId, bridge => bridge.getBoardTracks({ source, boardId, page, limit: pageLimit }))
                ));
            },
        },
        catalog: {
            // 打开歌单（来源：歌单搜索）后拉曲目。
            getPlaylistTracks(id, limit, offset): Promise<ProviderPage<UnifiedSong>> {
                return loadCollectionTracks(limit, offset, (page, pageLimit) => (
                    callLxSource(providerId, bridge => bridge.getPlaylistTracks({ source, id: String(id), page, limit: pageLimit }))
                ));
            },
        },
        playback: {
            // 移植的 musicSdk 只提供榜单/歌单/搜索，没有按 id 反查详情的接口；播放所需字段随歌曲一起来。
            async getSongDetail() { return null; },
            getAvailability() { return { state: 'unknown' }; },
            async getAudioSource(song, quality): Promise<ProviderAudioSource> {
                const ref = song.sourceRef;
                if (ref?.kind !== 'online' || ref.providerId !== providerId) {
                    throw new OnlineProviderError('unsupported', `歌曲不属于自定义音源 ${providerId}`, providerId);
                }
                // 没有启用的脚本时必然是失败：明确报 not-configured，让界面引导去启用音源，
                // 而不是让下游把它当成「歌曲不可用 / 已下架」。
                const availability = getLxSourceAvailability();
                if (!availability.configured) {
                    throw new OnlineProviderError(
                        availability.reason === 'not-configured' ? 'not-configured' : 'unavailable',
                        '自定义音源尚未启用，请先在自定义音源版块启用一个音源脚本',
                        providerId,
                    );
                }
                const { source: refSource, musicInfo } = assertOwnedRef(ref.providerData);
                const supported = await supportedQualitysFor(providerId, refSource);
                // 版块自己的播放音质优先；没设置时跟随调用方传来的全局偏好。
                const preferred = useLxPlaybackQualityStore.getState().playbackQuality ?? quality;
                const resolved = pickQuality(preferred, supported);
                const result = await callLxSource(providerId, bridge => bridge.getMusicUrl({
                    source: refSource,
                    musicInfo,
                    quality: resolved,
                }));
                if (!result.url) throw new OnlineProviderError('not-playable', '自定义音源未返回播放地址', providerId);
                return { url: result.url, fetchedAt: Date.now(), quality: preferred };
            },
        },
        lyrics: {
            async getLyrics(song) {
                const ref = song.sourceRef;
                if (ref?.kind !== 'online' || ref.providerId !== providerId) {
                    throw new OnlineProviderError('unsupported', `歌曲不属于自定义音源 ${providerId}`, providerId);
                }
                const { source: refSource, musicInfo } = assertOwnedRef(ref.providerData);
                const payload = await callLxSource(providerId, bridge => bridge.getLyric({
                    source: refSource,
                    musicInfo,
                }));
                return buildLyricsResult(payload);
            },
        },
    };
};
