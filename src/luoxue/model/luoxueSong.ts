import type { Artist, SongResult } from '../../types';
import type { LxMusicInfo } from '../sdk';

// src/luoxue/model/luoxueSong.ts
// 洛雪版块的歌曲模型：把 lx 音源给出的 musicInfo 映射成 folia 的 SongResult，并把「这首歌属于哪个 lx 音源」
// 随歌曲一起带走。播放时取地址要按歌曲自己的音源去问，所以这条信息必须能跟着队列和历史走。

/** 洛雪歌曲额外携带的字段：lx 音源 id + lx 的原始 musicInfo。 */
export type LuoxueSongExtra = {
    /** lx 音源标识：内置 kw / kg / tx / wy / mg，或自定义源 id（user_api_xxx）。 */
    lxSource: string;
    /** lx 的原始 musicInfo，取播放地址与歌词时原样交还给音源。 */
    lx: LxMusicInfo;
};

export type LuoxueSongResult = SongResult & { luoxue?: LuoxueSongExtra };

/** 洛雪版块在 omni 里的 provider id；它不参与平台登录，只负责这首歌的地址与歌词。 */
export const LUOXUE_PROVIDER_ID = 'luoxue';

/** lx 内置音源（顺序即界面上的展示顺序）。 */
export const LUOXUE_BUILTIN_SOURCES: ReadonlyArray<{ id: string; name: string }> = [
    { id: 'kw', name: '酷我音乐' },
    { id: 'kg', name: '酷狗音乐' },
    { id: 'tx', name: 'QQ音乐' },
    { id: 'wy', name: '网易云音乐' },
    { id: 'mg', name: '咪咕音乐' },
    { id: 'git', name: 'ChatMusic' },
];

const readString = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** lx 的歌手字段是 `、` / `,` 分隔的一串名字；拆开后去掉空项与首尾空白。 */
export const parseLxSinger = (singer: unknown): string[] => {
    const text = readString(singer);
    if (!text) return [];
    return text
        .split(/、|,|;|\//)
        .map(name => name.trim())
        .filter(Boolean);
};

/**
 * lx 的时长字段：kg 用 `_interval`（秒），其余音源用 `interval`（`mm:ss` 字符串）；
 * 少数实现会直接给 `durationMs`。统一归一到毫秒。
 */
export const parseLxDurationMs = (info: Record<string, unknown>): number => {
    const durationMs = Number(info.durationMs);
    if (Number.isFinite(durationMs) && durationMs > 0) return durationMs;
    for (const seconds of [info._interval, info.interval]) {
        if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }
    const interval = info.interval;
    if (typeof interval === 'string' && interval) {
        const parts = interval.split(':').map(part => Number(part));
        if (parts.length > 0 && parts.every(part => Number.isFinite(part))) {
            return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
        }
    }
    return 0;
};

/** lx 的封面在 `img` / `picUrl` / `meta.picUrl` 几处；搜索结果通常为空（封面要另外取）。 */
const parseLxCoverUrl = (info: Record<string, unknown>): string => {
    const meta = info.meta as Record<string, unknown> | undefined;
    return readString(info.img)
        || readString(info.picUrl)
        || readString(meta?.picUrl)
        || readString(meta?.img);
};

/**
 * lx 各音源的歌曲主键字段并不统一：kw/wy/tx/mg 用 `songmid`，kg 另有 `hash`，
 * mg 另有 `copyrightId`，git 用 `id`。按这个顺序取第一个有值的作为 folia 侧的 mediaId。
 */
export const parseLxTrackId = (info: Record<string, unknown>): string => {
    const meta = info.meta as Record<string, unknown> | undefined;
    return readString(info.songmid)
        || readString(info.id)
        || readString(info.hash)
        || readString(info.copyrightId)
        || readString(meta?.songId);
};

/** lx musicInfo → folia SongResult；歌词、音质等运行时信息不在这里解析。 */
export const toLuoxueSong = (info: LxMusicInfo, lxSource: string): LuoxueSongResult | null => {
    const raw = info as unknown as Record<string, unknown>;
    const id = parseLxTrackId(raw);
    if (!id) return null;
    const meta = raw.meta as Record<string, unknown> | undefined;
    const name = readString(raw.name) || readString(raw.title) || id;
    const artists: Artist[] = parseLxSinger(raw.singer ?? raw.artist).map((artistName, index) => ({
        id: `${id}#artist${index}`,
        name: artistName,
    }));
    const albumName = readString(raw.albumName) || readString(raw.album) || readString(meta?.albumName);
    const coverUrl = parseLxCoverUrl(raw);
    const albumId = readString(raw.albumId);

    return {
        id,
        name,
        artists,
        album: { id: albumId || `${id}#album`, name: albumName, ...(coverUrl ? { coverUrl } : {}) },
        durationMs: parseLxDurationMs(raw),
        sourceRef: { kind: 'online', providerId: LUOXUE_PROVIDER_ID, mediaId: id },
        luoxue: { lxSource, lx: info },
    };
};

/** 批量转换；丢掉没有主键的条目。 */
export const toLuoxueSongs = (list: LxMusicInfo[], lxSource: string): LuoxueSongResult[] => {
    const songs: LuoxueSongResult[] = [];
    for (const info of list) {
        const song = toLuoxueSong(info, lxSource);
        if (song) songs.push(song);
    }
    return songs;
};

/** 读取歌曲携带的洛雪信息；不是洛雪歌曲时返回 null。 */
export const readLuoxueExtra = (song: SongResult): LuoxueSongExtra | null => {
    const extra = (song as LuoxueSongResult).luoxue;
    if (!extra || typeof extra.lxSource !== 'string' || !extra.lx) return null;
    return extra;
};

/**
 * 从 SongResult 反推一份最小的 lx musicInfo。队列里的歌曲经过 folia 的持久化往返后附加字段可能丢失，
 * 这时用歌曲自身的字段重建：按音源把主键写回该音源真正使用的字段（kg 要 hash、mg 要 copyrightId）。
 * 信息不完整，音源脚本取地址可能失败，这是这种回退路径的固有代价。
 */
export const rebuildLxMusicInfo = (song: SongResult, lxSource: string): LxMusicInfo | null => {
    const mediaId = song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id;
    const id = mediaId === undefined || mediaId === null ? '' : String(mediaId);
    if (!id) return null;
    const singer = (song.artists ?? []).map(artist => artist.name).filter(Boolean).join('、');
    const info: Record<string, unknown> = {
        songmid: id,
        id,
        name: song.name,
        singer,
        source: lxSource,
        albumName: song.album?.name ?? '',
        interval: song.durationMs > 0 ? Math.round(song.durationMs / 1000) : 0,
        img: song.album?.coverUrl ?? '',
    };
    if (lxSource === 'kg') info.hash = id;
    if (lxSource === 'mg') info.copyrightId = id;
    return info as unknown as LxMusicInfo;
};

/** 取一首洛雪歌曲的 lx 音源 id 与其原始信息；原始信息缺失时按指定音源重建一份。 */
export const resolveLuoxueSource = (song: SongResult, fallback: string): { lxSource: string; info: LxMusicInfo | null } => {
    const extra = readLuoxueExtra(song);
    if (extra) return { lxSource: extra.lxSource, info: extra.lx };
    return { lxSource: fallback, info: rebuildLxMusicInfo(song, fallback) };
};
