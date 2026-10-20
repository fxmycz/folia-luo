import type { ProviderCollection } from '../../types/onlineMusic';
import type { SongResult } from '../../types';
import { getLuoxueCollectionTracks } from './luoxueCatalog';

// src/luoxue/services/collectionSnapshot.ts
// 「收藏歌单」= 把某个洛雪集合在收藏那一刻的曲目整体存成一份本地快照（不随后续上游更新变动）。
// 这里负责：把面板里打开的 ProviderCollection 还原成「音源 + 类型 + 上游 id」，并把它的曲目分页拉全。

/** 收藏歌单时需要的来源信息（面板里打开的集合 + 界面上的元信息）。 */
export type LuoxueCollectionSource = {
    kind: 'songlist' | 'leaderboard';
    /** 上游集合 id（歌单 id / 榜单 id）。 */
    id: string;
    /** 集合所属音源（kw / wy / user_api_xxx…）。 */
    lxSource: string;
    name: string;
    coverUrl?: string;
    publisher?: string;
};

/** 从面板里打开的集合读出它的来源信息（providerData 里记着 kind / lxSource / id）。 */
export const toLuoxueCollectionSource = (collection: ProviderCollection): LuoxueCollectionSource | null => {
    const data = collection.providerData as unknown as { kind?: string; lxSource?: string; id?: string } | undefined;
    if (!data || typeof data.id !== 'string' || typeof data.lxSource !== 'string') return null;
    if (data.kind !== 'songlist' && data.kind !== 'leaderboard') return null;
    return {
        kind: data.kind,
        id: data.id,
        lxSource: data.lxSource,
        name: collection.name,
        coverUrl: collection.coverUrl ?? undefined,
        publisher: collection.publisher ?? undefined,
    };
};

/** 拉取一页曲目（可注入，便于测试分页逻辑）。 */
export type LuoxueCollectionSnapshotFetcher = (
    source: LuoxueCollectionSource,
    page: { limit: number; offset: number },
) => Promise<{ items: SongResult[]; hasMore: boolean }>;

/** 每页拉多少（与面板列表一致）。 */
export const SNAPSHOT_PAGE_LIMIT = 100;

/** 上限保护：避免超大歌单把 localStorage 撑爆。 */
export const SNAPSHOT_MAX_SONGS = 3000;

const rebuildCollection = (source: LuoxueCollectionSource): ProviderCollection => ({
    providerId: 'luoxue',
    id: String(source.id),
    name: source.name,
    type: 'playlist',
    coverUrl: source.coverUrl,
    ...(source.publisher ? { publisher: source.publisher } : {}),
    providerData: { kind: source.kind, lxSource: source.lxSource, id: String(source.id) } as unknown as ProviderCollection['providerData'],
});

const defaultFetcher: LuoxueCollectionSnapshotFetcher = async (source, page) => {
    const result = await getLuoxueCollectionTracks(rebuildCollection(source), page);
    return { items: result.items as unknown as SongResult[], hasMore: Boolean(result.hasMore) };
};

/**
 * 把集合的曲目分页拉全（收藏歌单时用；「更新收藏」也走这里重新拉一次）。
 * 只读接口，失败时把已拿到的部分返回，不抛错。
 */
export const loadLuoxueCollectionSnapshot = async (
    source: LuoxueCollectionSource,
    fetcher: LuoxueCollectionSnapshotFetcher = defaultFetcher,
): Promise<SongResult[]> => {
    const songs: SongResult[] = [];
    let offset = 0;
    try {
        while (offset < SNAPSHOT_MAX_SONGS) {
            const page = await fetcher(source, { limit: SNAPSHOT_PAGE_LIMIT, offset });
            songs.push(...page.items);
            if (!page.hasMore || page.items.length === 0) break;
            offset += page.items.length;
        }
    } catch {
        // 中途失败时保留已拿到的曲目，避免整次收藏白跑
    }
    return songs;
};
