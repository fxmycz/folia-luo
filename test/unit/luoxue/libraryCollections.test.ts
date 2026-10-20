import { beforeEach, describe, expect, it } from 'vitest';
import type { SongResult } from '../../../src/types';
import type { ProviderCollection } from '../../../src/types/onlineMusic';
import {
    luoxueCollectionKey,
    useLuoxueLibraryStore,
    type LuoxueSavedCollectionMeta,
} from '../../../src/luoxue/store/useLuoxueLibraryStore';
import {
    SNAPSHOT_MAX_SONGS,
    loadLuoxueCollectionSnapshot,
    toLuoxueCollectionSource,
    type LuoxueCollectionSnapshotFetcher,
} from '../../../src/luoxue/services/collectionSnapshot';

// test/unit/luoxue/libraryCollections.test.ts
// 「收藏歌单」= 收藏歌单本身（存一份不随上游更新的本地快照），以及歌单快照 / 播放历史里的批量删除。
// 这里直接驱动 store 的动作，并用注入的 fetcher 覆盖分页拉全的边界（翻页、终止、中途失败、超长封顶）。

const song = (mediaId: string): SongResult => ({
    id: mediaId,
    name: `歌曲 ${mediaId}`,
    sourceRef: { kind: 'online', providerId: 'luoxue', mediaId },
} as unknown as SongResult);

/** 与 luoxueSongKey 一致的唯一键（洛雪 provider + 音源内的 mediaId）。 */
const keyOf = (mediaId: string): string => `luoxue:${mediaId}`;

const meta = (overrides: Partial<LuoxueSavedCollectionMeta> = {}): LuoxueSavedCollectionMeta => ({
    collectionId: 'digest-8__123',
    lxSource: 'kw',
    kind: 'songlist',
    name: '测试歌单',
    coverUrl: 'https://img.test/cover.jpg',
    publisher: '小明',
    ...overrides,
});

/** 每个用例都从空的库开始（node 环境下 store 只保留内存状态）。 */
beforeEach(() => {
    useLuoxueLibraryStore.setState({ favorites: [], history: [], collections: [] });
});

describe('收藏歌单（本地快照）', () => {
    it('首次收藏落一份快照，快照里的曲目按唯一键去重', () => {
        const result = useLuoxueLibraryStore.getState().saveCollection(meta(), [song('a'), song('b'), song('a')]);
        const collections = useLuoxueLibraryStore.getState().collections;

        expect(result).toMatchObject({ refreshed: false, total: 2 });
        expect(collections).toHaveLength(1);
        expect(collections[0].name).toBe('测试歌单');
        expect(collections[0].lxSource).toBe('kw');
        expect(collections[0].kind).toBe('songlist');
        expect(collections[0].publisher).toBe('小明');
        expect(collections[0].songs.map(item => item.id)).toEqual(['a', 'b']);
        expect(collections[0].updatedAt).toBe(collections[0].savedAt);
    });

    it('再次收藏同一个上游歌单是「更新」：条目不增加，曲目被本次结果整体覆盖', () => {
        const store = useLuoxueLibraryStore.getState();
        store.saveCollection(meta(), [song('a'), song('b')]);
        const first = useLuoxueLibraryStore.getState().collections[0];

        const result = store.saveCollection(meta({ name: '测试歌单（改名）' }), [song('b'), song('c'), song('d')]);
        const collections = useLuoxueLibraryStore.getState().collections;

        expect(result).toMatchObject({ refreshed: true, total: 3 });
        expect(result.id).toBe(first.id);
        expect(collections).toHaveLength(1);
        expect(collections[0].name).toBe('测试歌单（改名）');
        // 上游更新后的曲目覆盖了旧快照（a 没了，b 保留，c/d 是新的）。
        expect(collections[0].songs.map(item => item.id)).toEqual(['b', 'c', 'd']);
    });

    it('不同音源（或不同上游 id）的同名歌单各算一张', () => {
        const store = useLuoxueLibraryStore.getState();
        store.saveCollection(meta(), [song('a')]);
        store.saveCollection(meta({ lxSource: 'wy' }), [song('a')]);
        store.saveCollection(meta({ collectionId: 'digest-8__999' }), [song('a')]);

        expect(useLuoxueLibraryStore.getState().collections).toHaveLength(3);
        // 唯一键取「音源 + 类型 + 上游 id」，与本地 id 无关。
        const collections = useLuoxueLibraryStore.getState().collections;
        expect(collections.map(item => luoxueCollectionKey(item))).toEqual([
            'kw:songlist:digest-8__999',
            'wy:songlist:digest-8__123',
            'kw:songlist:digest-8__123',
        ]);
    });

    it('删除歌单快照只删这一份，其他收藏不受影响', () => {
        const store = useLuoxueLibraryStore.getState();
        const keep = store.saveCollection(meta(), [song('a')]);
        const drop = store.saveCollection(meta({ collectionId: 'digest-8__456' }), [song('b')]);
        store.removeCollection(drop.id);

        const collections = useLuoxueLibraryStore.getState().collections;
        expect(collections.map(item => item.id)).toEqual([keep.id]);
    });

    it('删除歌单内的歌曲按唯一键批量删，且不会动到别的歌单', () => {
        const store = useLuoxueLibraryStore.getState();
        const one = store.saveCollection(meta(), [song('a'), song('b'), song('c')]);
        store.saveCollection(meta({ collectionId: 'digest-8__456' }), [song('a')]);
        store.removeCollectionSongs(one.id, [keyOf('a'), keyOf('c')]);

        const collections = useLuoxueLibraryStore.getState().collections;
        const target = collections.find(item => item.id === one.id);
        expect(target?.songs.map(item => item.id)).toEqual(['b']);
        // 另一张歌单里的 'a' 不受影响。
        expect(collections.find(item => item.collectionId === 'digest-8__456')?.songs.map(item => item.id)).toEqual(['a']);
    });
});

describe('播放历史的批量删除', () => {
    it('按唯一键批量删，键不存在时也不误删', () => {
        const store = useLuoxueLibraryStore.getState();
        store.pushHistory(song('a'));
        store.pushHistory(song('b'));
        store.pushHistory(song('c'));

        store.removeHistorySongs([keyOf('a'), 'luoxue:不存在']);
        expect(useLuoxueLibraryStore.getState().history.map(item => item.id)).toEqual(['c', 'b']);
    });

    it('空列表不下手', () => {
        const store = useLuoxueLibraryStore.getState();
        store.pushHistory(song('a'));
        store.removeHistorySongs([]);
        expect(useLuoxueLibraryStore.getState().history).toHaveLength(1);
    });
});

describe('从打开的集合还原来源信息', () => {
    const collection = (providerData: unknown): ProviderCollection => ({
        providerId: 'luoxue',
        id: 'digest-8__123',
        name: '酷我歌单',
        type: 'playlist',
        coverUrl: 'https://img.test/c.jpg',
        publisher: '小明',
        providerData,
    } as unknown as ProviderCollection);

    it('读得到 kind / lxSource / id 与界面元信息', () => {
        expect(toLuoxueCollectionSource(collection({ kind: 'songlist', lxSource: 'kw', id: 'digest-8__123' }))).toEqual({
            kind: 'songlist',
            id: 'digest-8__123',
            lxSource: 'kw',
            name: '酷我歌单',
            coverUrl: 'https://img.test/c.jpg',
            publisher: '小明',
        });
    });

    it('providerData 缺失或类型非法时返回 null（不把榜单错当歌单收藏）', () => {
        expect(toLuoxueCollectionSource(collection(undefined))).toBeNull();
        expect(toLuoxueCollectionSource(collection({ kind: 'album', lxSource: 'kw', id: 'x' }))).toBeNull();
        expect(toLuoxueCollectionSource(collection({ kind: 'songlist', lxSource: 'kw' }))).toBeNull();
    });
});

describe('把集合的曲目分页拉全', () => {
    const source = { kind: 'songlist', id: 'digest-8__123', lxSource: 'kw', name: '酷我歌单' } as const;

    it('逐页推进 offset，直到 hasMore 为假', async () => {
        const total = 250;
        const fetched: number[] = [];
        const fetcher: LuoxueCollectionSnapshotFetcher = async (_source, page) => {
            fetched.push(page.offset);
            const items = Array.from(
                { length: Math.max(0, Math.min(page.limit, total - page.offset)) },
                (_, index) => song(`s${page.offset + index}`),
            );
            return { items, hasMore: page.offset + items.length < total };
        };

        const songs = await loadLuoxueCollectionSnapshot(source, fetcher);
        expect(fetched).toEqual([0, 100, 200]);
        expect(songs).toHaveLength(total);
        expect(songs[0].id).toBe('s0');
        expect(songs[249].id).toBe('s249');
    });

    it('中途失败时保留已经拿到的曲目，不抛错', async () => {
        let calls = 0;
        const fetcher: LuoxueCollectionSnapshotFetcher = async (_source, page) => {
            calls += 1;
            if (calls > 1) throw new Error('network down');
            return { items: Array.from({ length: page.limit }, (_, index) => song(`s${index}`)), hasMore: true };
        };

        const songs = await loadLuoxueCollectionSnapshot(source, fetcher);
        expect(songs).toHaveLength(100);
    });

    it('超长歌单封顶 SNAPSHOT_MAX_SONGS，不吃满存储', async () => {
        const fetcher: LuoxueCollectionSnapshotFetcher = async (_source, page) => ({
            items: Array.from({ length: page.limit }, (_, index) => song(`s${page.offset + index}`)),
            hasMore: true,
        });
        const songs = await loadLuoxueCollectionSnapshot(source, fetcher);
        expect(songs).toHaveLength(SNAPSHOT_MAX_SONGS);
    });

    it('第一页就没有更多时只拉一次', async () => {
        const fetched: number[] = [];
        const fetcher: LuoxueCollectionSnapshotFetcher = async (_source, page) => {
            fetched.push(page.offset);
            return { items: [], hasMore: false };
        };
        expect(await loadLuoxueCollectionSnapshot(source, fetcher)).toEqual([]);
        expect(fetched).toEqual([0]);
    });
});
