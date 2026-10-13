import type { SongResult } from '../../types';
import type { JsonValue } from '../../types/onlineMusic';
import type { LxFavoriteList } from '../../stores/useLxFavoritesStore';
import { normalizeLxSong } from './lxNormalize';

// src/services/lxSource/lxPlaylistFile.ts
// 收藏列表的「导入 / 导出」：文件格式与洛雪音乐（lx-music-desktop）的 `.lxmc` 完全互通。
// 新旧格式互转规则参考 lx-music-desktop 的 src/common/utils/tools.ts（Apache-2.0）：
//   - 旧格式（v1 / 本模块内部 raw musicInfo）字段：songmid / types / _types / img / albumId …
//   - 新格式（v2，`.lxmc` 内的 MusicInfo）字段：id / meta.songId / meta.qualitys / meta.picUrl …
// 纯函数、零副作用，便于单测；解析后的歌曲与在线浏览得到的 SongResult 同构。

const text = (value: unknown): string => (value == null ? '' : String(value));

/**
 * 归一化文件文本，兼容各来源的换行与编码差异：
 * - 去掉 UTF-8 BOM（部分编辑器 / Windows 记事本另存会写入 `\uFEFF`，会让 JSON.parse 报错）；
 * - 把 CRLF / 单独的 CR 统一成 LF（洛雪音乐导出的文件是 Unix（LF））。
 * JSON 本身对空白不敏感，归一化只是让解析对 BOM 与换行差异更稳健。
 */
const normalizeFileText = (input: string): string => input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

const asRecord = (value: unknown): Record<string, JsonValue> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {}
);

/** 只在值存在（非空字符串）时写入，避免产出 undefined / 空字段污染文件。 */
const assignIf = (target: Record<string, JsonValue>, key: string, value: unknown): void => {
    if (value == null || (typeof value === 'string' && !value)) return;
    target[key] = value as JsonValue;
};

/** 洛雪 `.lxmc` 内的一条 MusicInfo（v2 新格式）；meta 保存平台特有字段。 */
export type LxMusicInfo = {
    id: string;
    name: string;
    singer: string;
    source: string;
    interval: string;
    meta: Record<string, JsonValue>;
};

/**
 * 旧格式 raw musicInfo → v2 MusicInfo。
 * 无法识别（缺 source / 缺 id）时返回 null，交给调用方计入「忽略」。
 */
export const lxMusicInfoFromRaw = (raw: unknown): LxMusicInfo | null => {
    const item = asRecord(raw);
    const source = text(item.source);
    if (!source) return null;
    const songmid = text(item.songmid ?? item.songId ?? item.hash ?? item.id);
    if (!songmid) return null;
    const hash = text(item.hash);

    const rawTypes = Array.isArray(item.types) ? item.types : [];
    const qualitys = asRecord(item._types);
    let types = rawTypes;
    // 新版洛雪用 flac24bit，旧版写作 flac32bit：按洛雪的兼容规则改名。
    // 与洛雪 toNewMusicInfo 一致，`_qualitys` 的键和 `qualitys` 里的 type 都要改。
    if (qualitys.flac32bit && !qualitys.flac24bit) {
        qualitys.flac24bit = qualitys.flac32bit;
        delete qualitys.flac32bit;
        types = rawTypes.map(quality => {
            const entry = asRecord(quality);
            return (entry.type === 'flac32bit' ? { ...entry, type: 'flac24bit' } : entry) as JsonValue;
        });
    }

    const meta: Record<string, JsonValue> = {
        songId: songmid,
        albumName: text(item.albumName),
        picUrl: text(item.img) || null,
        albumId: text(item.albumId),
        qualitys: types,
        _qualitys: qualitys,
    };

    switch (source) {
        case 'kg':
            assignIf(meta, 'hash', hash);
            assignIf(meta, 'albumAudioId', item.albumAudioId);
            break;
        case 'tx':
            assignIf(meta, 'strMediaMid', item.strMediaMid);
            assignIf(meta, 'albumMid', item.albumMid);
            assignIf(meta, 'id', item.songId);
            break;
        case 'mg':
            assignIf(meta, 'copyrightId', item.copyrightId);
            assignIf(meta, 'lrcUrl', item.lrcUrl);
            assignIf(meta, 'mrcUrl', item.mrcUrl);
            assignIf(meta, 'trcUrl', item.trcUrl);
            break;
        default:
            break;
    }

    // kg 的 id 是 `${songmid}_${hash}`；其余平台是 `${source}_${songmid}`。
    const id = source === 'kg' && hash ? `${songmid}_${hash}` : `${source}_${songmid}`;

    return { id, name: text(item.name), singer: text(item.singer), source, interval: text(item.interval), meta };
};

/** v2 MusicInfo → 旧格式 raw musicInfo（本模块与脚本共用的形态）；缺 meta 时返回 null。 */
export const lxRawFromMusicInfo = (raw: unknown): Record<string, JsonValue> | null => {
    const item = asRecord(raw);
    const source = text(item.source);
    if (!source || !item.meta || typeof item.meta !== 'object') return null;
    const meta = asRecord(item.meta);
    const songmid = text(meta.songId ?? item.id);
    if (!songmid) return null;

    const out: Record<string, JsonValue> = {
        name: text(item.name),
        singer: text(item.singer),
        source,
        songmid,
    };
    assignIf(out, 'albumName', meta.albumName);
    assignIf(out, 'albumId', meta.albumId);
    assignIf(out, 'img', meta.picUrl);
    assignIf(out, 'interval', item.interval);
    if (Array.isArray(meta.qualitys)) out.types = meta.qualitys;
    if (meta._qualitys) out._types = asRecord(meta._qualitys);

    switch (source) {
        case 'kg':
            assignIf(out, 'hash', meta.hash);
            assignIf(out, 'albumAudioId', meta.albumAudioId);
            break;
        case 'tx':
            assignIf(out, 'strMediaMid', meta.strMediaMid);
            assignIf(out, 'albumMid', meta.albumMid);
            assignIf(out, 'songId', meta.id);
            break;
        case 'mg':
            assignIf(out, 'copyrightId', meta.copyrightId);
            assignIf(out, 'lrcUrl', meta.lrcUrl);
            assignIf(out, 'mrcUrl', meta.mrcUrl);
            assignIf(out, 'trcUrl', meta.trcUrl);
            break;
        default:
            break;
    }
    return out;
};

export type LxPlaylistFileBuild = {
    /** 已序列化的 `.lxmc` 文本。 */
    text: string;
    /** 列表里的歌曲总数。 */
    total: number;
    /** 成功写入文件的歌曲数。 */
    exported: number;
    /** 跳过（不是自定义音源歌曲 / 无法转换）的歌曲数。 */
    skipped: number;
};

/** 把自建收藏列表打包成洛雪 `.lxmc`（playListPart_v2）文本。 */
export const buildLxPlaylistFile = (list: Pick<LxFavoriteList, 'id' | 'name' | 'songs'>): LxPlaylistFileBuild => {
    const items: LxMusicInfo[] = [];
    let skipped = 0;
    for (const song of list.songs) {
        const ref = song.sourceRef;
        const providerData = ref?.kind === 'online' ? ref.providerData : undefined;
        const musicInfo = providerData?.musicInfo;
        const converted = musicInfo ? lxMusicInfoFromRaw(musicInfo) : null;
        if (!converted) {
            skipped += 1;
            continue;
        }
        items.push(converted);
    }
    const file = {
        type: 'playListPart_v2',
        // 普通自建列表没有 source / sourceListId（那是「收藏的在线歌单」才有）。
        data: { id: list.id, name: list.name, locationUpdateTime: null, list: items },
    };
    return { text: JSON.stringify(file), total: list.songs.length, exported: items.length, skipped };
};

export type LxPlaylistParseFailure = 'invalid-json' | 'unsupported-type';

export type LxPlaylistParseResult =
    | { ok: true; name: string; songs: SongResult[]; skipped: number }
    | { ok: false; reason: LxPlaylistParseFailure };

/**
 * 解析洛雪列表文件文本。同时接受 v2（`playListPart_v2`）与 v1（`playListPart`）。
 * 结果按歌曲 id 去重；无法识别 / 重复的条目计入 skipped。
 */
export const parseLxPlaylistFile = (source: string): LxPlaylistParseResult => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(normalizeFileText(source));
    } catch {
        return { ok: false, reason: 'invalid-json' };
    }

    const file = asRecord(parsed);
    const type = text(file.type);
    if (type !== 'playListPart_v2' && type !== 'playListPart') {
        return { ok: false, reason: 'unsupported-type' };
    }

    const data = asRecord(file.data);
    const rawList = Array.isArray(data.list) ? data.list : [];
    const name = text(data.name).trim();

    const songs: SongResult[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const item of rawList) {
        const record = asRecord(item);
        // v2 条目带 meta：先转回旧格式再归一化；v1 条目本身即旧格式。
        const candidate = record.meta ? lxRawFromMusicInfo(record) : record;
        if (!candidate) {
            skipped += 1;
            continue;
        }
        try {
            const song = normalizeLxSong(candidate);
            const key = song?.id == null ? '' : String(song.id);
            if (!key || seen.has(key)) {
                skipped += 1;
                continue;
            }
            seen.add(key);
            songs.push(song);
        } catch {
            skipped += 1;
        }
    }
    return { ok: true, name, songs, skipped };
};
