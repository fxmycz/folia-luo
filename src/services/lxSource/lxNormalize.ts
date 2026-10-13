import type { Artist, UnifiedSong } from '../../types';
import type { JsonValue } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/lxSource/lxNormalize.ts
// 把洛雪 musicSdk 产出的歌曲记录（LX 内部 "music info" 形态）归一化成 Folia 的 UnifiedSong。
// 记录形态参考 lx-music-desktop 的 src/renderer/utils/musicSdk/<平台>/songList.js（Apache-2.0）。

/** LX 平台标识（'kw' / 'mg' …）→ Folia provider id（'lx-kw' / 'lx-mg'），避免与内置 provider 冲突。 */
export const lxProviderIdForSource = (source: string): string => `lx-${source}`;

/** 该 provider 是否来自自定义音源（`lx-xxx`）。用于把 LX 平台从 Folia 首页的平台列表里排除。 */
export const isLxProviderId = (providerId: string): boolean => providerId.startsWith('lx-');

const text = (value: unknown): string => (value == null ? '' : String(value));

const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

// 封面可能缺失，或以 `//host/...` 协议相对形式出现；统一补成 https。
export const lxCoverUrl = (value: unknown): string | undefined => {
    const url = text(value).trim();
    if (!url) return undefined;
    if (url.startsWith('//')) return `https:${url}`;
    return url.replace(/^http:\/\/(?=[\w-]+\.(?:kuwo|migu|music|kugou)\.)/i, 'https://');
};

/** LX 的 `interval` 是已格式化的 "mm:ss"（无效时为 "--/--"）；转成毫秒。 */
export const parseLxIntervalMs = (interval: unknown): number => {
    const match = /^(\d+):(\d{1,2})$/.exec(text(interval).trim());
    if (!match) return 0;
    return (Number(match[1]) * 60 + Number(match[2])) * 1000;
};

// LX 的 singer 是以「、」或「&」连接的单串（kw 的 formatSinger 会把 & 换成 、）。
const splitArtists = (singer: unknown): Artist[] => {
    const names = text(singer).split(/[、&/]/).map(name => name.trim()).filter(Boolean);
    return names.map((name, index) => ({ id: `${index}`, name }));
};

/**
 * 归一化一首洛雪歌曲。
 * `sourceRef.providerData` 保留平台标识与原始 musicInfo：播放时脚本按这些字段去解析直链。
 */
export const normalizeLxSong = (raw: unknown): UnifiedSong => {
    const item = record(raw);
    const source = text(item.source);
    if (!source) throw new OnlineProviderError('invalid-response', '洛雪歌曲缺少平台标识', 'lx');
    const providerId = lxProviderIdForSource(source);
    const songmid = text(item.songmid ?? item.songId ?? item.hash ?? item.id);
    if (!songmid) throw new OnlineProviderError('invalid-response', '洛雪歌曲缺少 id', providerId);

    // 原样透传 musicInfo 给脚本；JSON 往返一次保证只含可序列化字段。
    const musicInfo = JSON.parse(JSON.stringify(item)) as Record<string, JsonValue>;

    return {
        id: `${source}:${songmid}`,
        name: text(item.name),
        artists: splitArtists(item.singer),
        album: { id: text(item.albumId), name: text(item.albumName), coverUrl: lxCoverUrl(item.img) },
        durationMs: parseLxIntervalMs(item.interval),
        sourceRef: {
            kind: 'online',
            providerId,
            mediaId: songmid,
            providerData: { source, musicInfo },
        },
    };
};

/** 从 sourceRef 里取回脚本要的 `{ source, musicInfo }`。 */
export const lxMusicInfoFromSourceRef = (
    providerData: Record<string, JsonValue> | undefined,
): { source: string; musicInfo: Record<string, JsonValue> } => {
    const source = typeof providerData?.source === 'string' ? providerData.source : '';
    const musicInfo = record(providerData?.musicInfo) as Record<string, JsonValue>;
    return { source, musicInfo };
};
