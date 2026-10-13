import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/lxSource/lxProvider.test.ts
// 洛雪 provider 的离线单测：归一化、榜单/歌单/搜索的 page↔offset 适配与集合映射。
// 全程 mock 掉 IPC 桥（callLxSource），不联网。

vi.mock('@/services/lxSource/lxSourceTransport', () => ({
    callLxSource: vi.fn(),
    getLxSourceAvailability: () => ({ configured: true }),
}));

import { callLxSource } from '@/services/lxSource/lxSourceTransport';
import { createLxProvider } from '@/services/lxSource/lxProvider';
import {
    lxCoverUrl,
    lxMusicInfoFromSourceRef,
    lxProviderIdForSource,
    normalizeLxSong,
    parseLxIntervalMs,
} from '@/services/lxSource/lxNormalize';

const mockedCall = vi.mocked(callLxSource);

const kwTrack = {
    singer: 'A、B',
    name: '夜曲',
    albumName: '十一月的萧邦',
    albumId: '100',
    songmid: '77',
    source: 'kw',
    interval: '03:35',
    img: '//img.kuwo.cn/cover.jpg',
};

type BridgeCall = { method: string; payload: Record<string, unknown> | null };
let bridgeCalls: BridgeCall[] = [];
let canned: Record<string, unknown> = {};

beforeEach(() => {
    bridgeCalls = [];
    canned = {};
    mockedCall.mockReset();
    // 用假桥替换真实 IPC：每个方法记录调用并返回预置的洛雪分页结果。
    mockedCall.mockImplementation(async (_providerId, call) => {
        const bridge = {
            getBoards: async (source: unknown) => {
                bridgeCalls.push({ method: 'getBoards', payload: (source as Record<string, unknown>) ?? null });
                return canned.getBoards;
            },
            getBoardTracks: async (payload: Record<string, unknown>) => {
                bridgeCalls.push({ method: 'getBoardTracks', payload });
                return canned.getBoardTracks;
            },
            getPlaylistTracks: async (payload: Record<string, unknown>) => {
                bridgeCalls.push({ method: 'getPlaylistTracks', payload });
                return canned.getPlaylistTracks;
            },
            searchSongs: async (payload: Record<string, unknown>) => {
                bridgeCalls.push({ method: 'searchSongs', payload });
                return canned.searchSongs;
            },
            searchPlaylists: async (payload: Record<string, unknown>) => {
                bridgeCalls.push({ method: 'searchPlaylists', payload });
                return canned.searchPlaylists;
            },
        };
        // callLxSource 会把 Result 拆包成 data；这里让假桥直接返回 data。
        return (call as unknown as (value: typeof bridge) => Promise<unknown>)(bridge);
    });
});

describe('lxNormalize', () => {
    it('maps an LX platform id to a prefixed provider id', () => {
        expect(lxProviderIdForSource('kw')).toBe('lx-kw');
        expect(lxProviderIdForSource('mg')).toBe('lx-mg');
    });

    it('parses formatted and invalid intervals', () => {
        expect(parseLxIntervalMs('03:35')).toBe(215000);
        expect(parseLxIntervalMs('10:07')).toBe(607000);
        expect(parseLxIntervalMs('--/--')).toBe(0);
    });

    it('upgrades protocol-relative and platform-http covers to https', () => {
        expect(lxCoverUrl('//img.kuwo.cn/a.jpg')).toBe('https://img.kuwo.cn/a.jpg');
        expect(lxCoverUrl('http://img.migu.cn/a.jpg')).toBe('https://img.migu.cn/a.jpg');
        expect(lxCoverUrl('http://cdn.example.com/a.jpg')).toBe('http://cdn.example.com/a.jpg');
        expect(lxCoverUrl('')).toBeUndefined();
    });

    it('normalizes an LX record into a UnifiedSong carrying script metadata', () => {
        const song = normalizeLxSong(kwTrack);
        expect(song).toMatchObject({
            id: 'kw:77',
            name: '夜曲',
            durationMs: 215000,
            album: { id: '100', name: '十一月的萧邦', coverUrl: 'https://img.kuwo.cn/cover.jpg' },
        });
        expect(song.artists.map(artist => artist.name)).toEqual(['A', 'B']);
        expect(song.sourceRef).toMatchObject({ kind: 'online', providerId: 'lx-kw', mediaId: '77' });
        expect(lxMusicInfoFromSourceRef(song.sourceRef.kind === 'online' ? song.sourceRef.providerData : undefined))
            .toEqual({ source: 'kw', musicInfo: kwTrack });
    });

    it('rejects records without a platform or an id', () => {
        expect(() => normalizeLxSong({ ...kwTrack, source: undefined })).toThrow();
        expect(() => normalizeLxSong({ ...kwTrack, songmid: undefined, id: undefined })).toThrow();
    });
});

describe('createLxProvider', () => {
    it('declares browse/play capabilities without auth', () => {
        const provider = createLxProvider('kw');
        expect(provider.capabilities).toMatchObject({
            search: true,
            playback: true,
            lyrics: true,
            leaderboards: true,
            playlists: true,
            auth: false,
        });
    });

    it('maps platform boards into leaderboard collections keyed by bangid', async () => {
        canned.getBoards = { list: [{ id: 'kw__93', name: '飙升榜', bangid: '93' }], source: 'kw' };
        const boards = await createLxProvider('kw').leaderboards!.getLeaderboards();
        expect(boards).toEqual([{
            providerId: 'lx-kw',
            id: '93',
            name: '飙升榜',
            type: 'leaderboard',
            providerData: { source: 'kw', boardId: '93' },
        }]);
        expect(bridgeCalls[0]).toEqual({ method: 'getBoards', payload: 'kw' });
    });

    it('converts offset to the 1-based LX page for board tracks', async () => {
        canned.getBoardTracks = { list: [kwTrack], total: 120, page: 2, limit: 50, source: 'kw' };
        const board = { providerId: 'lx-kw', id: '93', name: '飙升榜', type: 'leaderboard', providerData: { source: 'kw', boardId: '93' } };
        const page = await createLxProvider('kw').leaderboards!.getLeaderboardTracks('93', 50, 50, board);

        expect(bridgeCalls[0]).toEqual({
            method: 'getBoardTracks',
            payload: { source: 'kw', boardId: '93', page: 2, limit: 50 },
        });
        expect(page.items).toHaveLength(1);
        expect(page.items[0].id).toBe('kw:77');
        expect(page).toMatchObject({ total: 120, nextOffset: 51, hasMore: true });
    });

    it('stops paging when a page comes back empty even if total is inflated', async () => {
        canned.getBoardTracks = { list: [], total: 500, page: 1, limit: 50, source: 'kw' };
        const page = await createLxProvider('kw').leaderboards!.getLeaderboardTracks('93', 50, 0);
        expect(page).toMatchObject({ items: [], hasMore: false, nextOffset: 0 });
    });

    it('searches songs through the LX SDK', async () => {
        canned.searchSongs = { list: [kwTrack], total: 1, source: 'kw' };
        const page = await createLxProvider('kw').search!.searchSongs('夜曲', 30, 0);
        expect(bridgeCalls[0]).toEqual({ method: 'searchSongs', payload: { source: 'kw', query: '夜曲', page: 1, limit: 30 } });
        expect(page.items[0].id).toBe('kw:77');
        expect(page.hasMore).toBe(false);
    });

    it('maps playlist search hits into playlist collections and loads their tracks', async () => {
        canned.searchPlaylists = {
            list: [{ id: 'p1', name: '精选', total: '5', img: '//img.kuwo.cn/p.jpg', author: 'u', desc: 'd', source: 'kw' }],
            total: '1',
            source: 'kw',
        };
        const provider = createLxProvider('kw');
        const page = await provider.search!.searchPlaylists!('精选', 20, 0);
        expect(page.items[0]).toMatchObject({
            providerId: 'lx-kw',
            id: 'p1',
            name: '精选',
            type: 'playlist',
            coverUrl: 'https://img.kuwo.cn/p.jpg',
            description: 'd',
            trackCount: 5,
            publisher: 'u',
        });

        canned.getPlaylistTracks = { list: [kwTrack], total: 1, page: 1, limit: 50, source: 'kw' };
        const tracks = await provider.catalog!.getPlaylistTracks!('p1', 50, 0);
        expect(bridgeCalls.at(-1)).toEqual({ method: 'getPlaylistTracks', payload: { source: 'kw', id: 'p1', page: 1, limit: 50 } });
        expect(tracks.items[0].id).toBe('kw:77');
    });
});
