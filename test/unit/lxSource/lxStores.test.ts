import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/lxSource/lxStores.test.ts
// 自定义音源版块两个 renderer store 的离线单测：
//   - useLxFavoritesStore：歌单条目收藏（去重 / 切换 / 移除 / 持久化 / 旧数据迁移）
//   - useLxBrowseMemoryStore：按平台隔离的会话快照、一次性 pendingOpen、持久化的标签与平台
// 运行环境是 node，没有 window：这里装一个内存版 localStorage，并在每个用例前 resetModules，
// 让 store 重新执行模块顶层的 load()，从而验证持久化 / 迁移行为。

const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    const storage = {
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        setItem: (key: string, value: string) => { map.set(key, String(value)); },
        removeItem: (key: string) => { map.delete(key); },
        clear: () => { map.clear(); },
        key: (index: number) => Array.from(map.keys())[index] ?? null,
        get length() { return map.size; },
    };
    return storage as Storage;
};

const FAVORITES_KEY = 'lx-source:favorites:v1';
const MEMORY_KEY = 'lx-source:browse-memory:v2';

const kwCollection = { providerId: 'lx-kw', id: 'p1', name: '精选歌单', type: 'playlist' };

let storage: Storage;

beforeEach(() => {
    storage = makeStorage();
    (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: storage };
    vi.resetModules();
});

const favoritesStore = async () => (await import('@/stores/useLxFavoritesStore')).useLxFavoritesStore;
const memoryStore = async () => (await import('@/stores/useLxBrowseMemoryStore')).useLxBrowseMemoryStore;

describe('useLxFavoritesStore · playlist entries', () => {
    it('adds a playlist once and de-duplicates by provider + id', async () => {
        const store = await favoritesStore();
        store.getState().addPlaylist(kwCollection);
        store.getState().addPlaylist({ ...kwCollection, name: '重复项应被忽略' });

        const { playlists } = store.getState();
        expect(playlists).toHaveLength(1);
        expect(playlists[0]).toMatchObject({ providerId: 'lx-kw', id: 'p1' });
        expect(typeof playlists[0].favoritedAt).toBe('number');
    });

    it('toggles a playlist on and off and reports the resulting state', async () => {
        const store = await favoritesStore();
        expect(store.getState().togglePlaylist(kwCollection)).toBe(true);
        expect(store.getState().isPlaylistFavorited(kwCollection)).toBe(true);
        expect(store.getState().togglePlaylist(kwCollection)).toBe(false);
        expect(store.getState().isPlaylistFavorited(kwCollection)).toBe(false);
    });

    it('removes only the matching playlist, leaving saved lists untouched', async () => {
        const store = await favoritesStore();
        store.getState().createList('我的列表');
        store.getState().addPlaylist(kwCollection);
        store.getState().removePlaylist({ providerId: 'lx-kw', id: 'p1' });

        expect(store.getState().playlists).toEqual([]);
        expect(store.getState().lists).toHaveLength(1);
    });

    it('persists playlists and restores them on the next load', async () => {
        const store = await favoritesStore();
        store.getState().addPlaylist(kwCollection);

        vi.resetModules();
        const reloaded = await favoritesStore();
        expect(reloaded.getState().playlists).toHaveLength(1);
        expect(reloaded.getState().playlists[0].id).toBe('p1');
    });

    it('falls back to an empty playlist list for payloads that predate the feature', async () => {
        storage.setItem(FAVORITES_KEY, JSON.stringify({
            lists: [{ id: 'l1', name: '旧列表', createdAt: 1, songs: [] }],
        }));

        vi.resetModules();
        const store = await favoritesStore();
        expect(store.getState().lists).toHaveLength(1);
        expect(store.getState().playlists).toEqual([]);
    });
});

describe('useLxBrowseMemoryStore · per-platform snapshots', () => {
    it('keeps snapshots isolated per platform', async () => {
        const store = await memoryStore();
        store.getState().patchSnapshot('lx-kw', { mode: 'search', query: '夜曲', searched: true });
        store.getState().patchSnapshot('lx-mg', { mode: 'boards', boardsLoaded: true });

        expect(store.getState().getSnapshot('lx-kw')).toMatchObject({ mode: 'search', query: '夜曲', searched: true });
        expect(store.getState().getSnapshot('lx-mg')).toMatchObject({ mode: 'boards', boardsLoaded: true });
        // 未被写入的平台字段应保持空快照默认值，证明两份快照互不串扰。
        expect(store.getState().getSnapshot('lx-kw')?.boardsLoaded).toBe(false);
    });

    it('merges successive patches onto the empty snapshot', async () => {
        const store = await memoryStore();
        store.getState().patchSnapshot('lx-kw', { query: 'a' });
        store.getState().patchSnapshot('lx-kw', { searched: true });

        expect(store.getState().getSnapshot('lx-kw')).toMatchObject({ query: 'a', searched: true, mode: 'boards' });
    });

    it('keeps snapshots in-process only, never in storage', async () => {
        const store = await memoryStore();
        // 先做一次会持久化的写入，确认落盘内容里不含进程内快照。
        store.getState().rememberProvider('lx-kw');
        store.getState().patchSnapshot('lx-kw', { query: 'x' });

        const raw = storage.getItem(MEMORY_KEY);
        expect(raw).not.toBeNull();
        expect((JSON.parse(raw as string) as Record<string, unknown>).snapshots).toBeUndefined();
    });

    it('discards a single platform snapshot on demand', async () => {
        const store = await memoryStore();
        store.getState().patchSnapshot('lx-kw', { query: 'x' });
        store.getState().clearSnapshot('lx-kw');

        expect(store.getState().getSnapshot('lx-kw')).toBeUndefined();
    });
});

describe('useLxBrowseMemoryStore · pendingOpen', () => {
    it('hands the collection over exactly once', async () => {
        const store = await memoryStore();
        store.getState().setPendingOpen(kwCollection);

        expect(store.getState().consumePendingOpen()).toMatchObject({ id: 'p1' });
        expect(store.getState().consumePendingOpen()).toBeNull();
    });
});

describe('useLxBrowseMemoryStore · persisted tab and platform', () => {
    it('remembers the last surface tab across reloads', async () => {
        const store = await memoryStore();
        store.getState().setSurfaceTab('favorites');

        vi.resetModules();
        const reloaded = await memoryStore();
        expect(reloaded.getState().surfaceTab).toBe('favorites');
    });

    it('ignores an unknown stored tab and falls back to browse', async () => {
        storage.setItem(MEMORY_KEY, JSON.stringify({ byPlatform: {}, lastProviderId: null, surfaceTab: 'nope' }));

        vi.resetModules();
        const store = await memoryStore();
        expect(store.getState().surfaceTab).toBe('browse');
    });

    it('remembers the last provider across reloads', async () => {
        const store = await memoryStore();
        store.getState().rememberProvider('lx-tx');

        vi.resetModules();
        const reloaded = await memoryStore();
        expect(reloaded.getState().lastProviderId).toBe('lx-tx');
    });
});
