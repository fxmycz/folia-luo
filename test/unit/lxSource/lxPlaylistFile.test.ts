import { describe, expect, it } from 'vitest';
import {
    buildLxPlaylistFile,
    lxMusicInfoFromRaw,
    lxRawFromMusicInfo,
    parseLxPlaylistFile,
} from '@/services/lxSource/lxPlaylistFile';
import { normalizeLxSong } from '@/services/lxSource/lxNormalize';
import type { SongResult } from '@/types';

// test/unit/lxSource/lxPlaylistFile.test.ts
// 收藏列表导入 / 导出的纯函数单测：洛雪（LX Music）新旧格式互转、`.lxmc` 构建与解析
// （v1 / v2 兼容、非法输入、去重）。运行环境是 node，不依赖 window。

const kwRaw = {
    source: 'kw',
    songmid: '12345',
    name: '测试歌曲',
    singer: '歌手甲、歌手乙',
    albumName: '测试专辑',
    albumId: '999',
    interval: '03:45',
    img: 'http://img4.kuwo.cn/a.jpg',
    types: [{ type: '128k', size: '3.5M' }],
    _types: { '128k': { size: '3.5M' }, flac32bit: { size: '20M' } },
};

const kgRaw = {
    source: 'kg',
    songmid: 'abcd',
    hash: 'HASH01',
    name: '酷狗歌',
    singer: '小A',
    albumName: '酷狗专辑',
    albumId: '11',
    interval: '04:00',
    albumAudioId: '77',
    types: [{ type: '320k', size: '8M' }],
    _types: { '320k': { size: '8M' } },
};

const txRaw = {
    source: 'tx',
    songmid: 'TXMID',
    songId: 4321,
    strMediaMid: 'STRMID',
    albumMid: 'ALBUMMID',
    name: 'QQ歌',
    singer: '小Q',
    interval: '02:30',
    types: [],
    _types: {},
};

const localSong: SongResult = {
    id: 'local:1',
    name: '本地歌',
    artists: [{ id: '0', name: '本地歌手' }],
    album: { id: '', name: '' },
    durationMs: 1000,
};

describe('lxMusicInfoFromRaw · 旧格式 → v2 MusicInfo', () => {
    it('converts a kw record and maps the shared meta fields', () => {
        const info = lxMusicInfoFromRaw(kwRaw);
        expect(info).not.toBeNull();
        expect(info!.id).toBe('kw_12345');
        expect(info!.source).toBe('kw');
        expect(info!.meta.songId).toBe('12345');
        expect(info!.meta.albumName).toBe('测试专辑');
        expect(info!.meta.albumId).toBe('999');
        expect(info!.meta.picUrl).toBe('http://img4.kuwo.cn/a.jpg');
        expect(info!.meta.qualitys).toEqual([{ type: '128k', size: '3.5M' }]);
    });

    it('builds the kg id from songmid + hash and keeps platform-specific fields', () => {
        const info = lxMusicInfoFromRaw(kgRaw)!;
        expect(info.id).toBe('abcd_HASH01');
        expect(info.meta.hash).toBe('HASH01');
        expect(info.meta.albumAudioId).toBe('77');
    });

    it('carries tx-specific meta fields', () => {
        const meta = lxMusicInfoFromRaw(txRaw)!.meta;
        expect(meta.strMediaMid).toBe('STRMID');
        expect(meta.albumMid).toBe('ALBUMMID');
        expect(meta.id).toBe(4321);
    });

    it('renames the legacy flac32bit quality to flac24bit', () => {
        const qualitys = lxMusicInfoFromRaw(kwRaw)!.meta._qualitys as Record<string, unknown>;
        expect(qualitys.flac24bit).toEqual({ size: '20M' });
        expect(qualitys.flac32bit).toBeUndefined();
    });

    it('renames flac32bit inside the qualitys array too, like LX does', () => {
        const raw = {
            source: 'wy',
            songmid: '1',
            name: 'x',
            singer: 'y',
            types: [{ type: 'flac32bit', size: '20M' }],
            _types: { flac32bit: { size: '20M' } },
        };
        const info = lxMusicInfoFromRaw(raw)!;
        expect(info.meta.qualitys).toEqual([{ type: 'flac24bit', size: '20M' }]);
    });

    it('returns null when source or id is missing', () => {
        expect(lxMusicInfoFromRaw({ name: 'x' })).toBeNull();
        expect(lxMusicInfoFromRaw({ source: 'kw' })).toBeNull();
    });
});

describe('lxRawFromMusicInfo · v2 → 旧格式', () => {
    it('round-trips a kg record, keeping the fields the script needs', () => {
        const back = lxRawFromMusicInfo(lxMusicInfoFromRaw(kgRaw));
        expect(back).toMatchObject({
            source: 'kg',
            songmid: 'abcd',
            hash: 'HASH01',
            albumAudioId: '77',
            name: '酷狗歌',
            singer: '小A',
            interval: '04:00',
        });
    });

    it('returns null when meta is absent', () => {
        expect(lxRawFromMusicInfo({ source: 'kw', id: 'kw_1' })).toBeNull();
    });
});

describe('buildLxPlaylistFile', () => {
    it('writes a playListPart_v2 file with the list name and converted songs', () => {
        const built = buildLxPlaylistFile({ id: 'l1', name: '我的收藏', songs: [normalizeLxSong(kwRaw), normalizeLxSong(kgRaw)] });
        expect(built.exported).toBe(2);
        expect(built.skipped).toBe(0);

        const file = JSON.parse(built.text) as {
            type: string;
            data: { id: string; name: string; locationUpdateTime: null; list: Array<{ id: string }> };
        };
        expect(file.type).toBe('playListPart_v2');
        expect(file.data.id).toBe('l1');
        expect(file.data.name).toBe('我的收藏');
        expect(file.data.locationUpdateTime).toBeNull();
        expect(file.data.list.map(item => item.id)).toEqual(['kw_12345', 'abcd_HASH01']);
    });

    it('skips songs that do not come from a custom source', () => {
        const built = buildLxPlaylistFile({ id: 'l2', name: '混合列表', songs: [normalizeLxSong(kwRaw), localSong] });
        expect(built.exported).toBe(1);
        expect(built.skipped).toBe(1);
    });
});

describe('parseLxPlaylistFile', () => {
    it('round-trips an exported v2 file back into normalized songs', () => {
        const built = buildLxPlaylistFile({ id: 'l1', name: '我的收藏', songs: [normalizeLxSong(kwRaw)] });
        const parsed = parseLxPlaylistFile(built.text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.name).toBe('我的收藏');
        expect(parsed.skipped).toBe(0);
        expect(parsed.songs).toHaveLength(1);
        expect(parsed.songs[0].id).toBe('kw:12345');
        expect(parsed.songs[0].name).toBe('测试歌曲');
        expect(parsed.songs[0].artists.map(artist => artist.name)).toEqual(['歌手甲', '歌手乙']);
        const ref = parsed.songs[0].sourceRef;
        expect(ref?.kind === 'online' ? ref.providerData?.musicInfo : null).toMatchObject({ source: 'kw', songmid: '12345' });
    });

    it('accepts legacy v1 files that already hold old-format records', () => {
        const file = { type: 'playListPart', data: { id: 'x', name: '旧列表', list: [kwRaw] } };
        const parsed = parseLxPlaylistFile(JSON.stringify(file));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.songs).toHaveLength(1);
        expect(parsed.songs[0].id).toBe('kw:12345');
    });

    it('de-duplicates songs by id and counts the duplicate as skipped', () => {
        const file = {
            type: 'playListPart_v2',
            data: { name: 'dup', list: [lxMusicInfoFromRaw(kwRaw), lxMusicInfoFromRaw(kwRaw)] },
        };
        const parsed = parseLxPlaylistFile(JSON.stringify(file));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.songs).toHaveLength(1);
        expect(parsed.skipped).toBe(1);
    });

    it('reports invalid json', () => {
        expect(parseLxPlaylistFile('this is not json')).toEqual({ ok: false, reason: 'invalid-json' });
    });

    it('reports container types it does not support', () => {
        const file = { type: 'myList', data: {} };
        expect(parseLxPlaylistFile(JSON.stringify(file))).toEqual({ ok: false, reason: 'unsupported-type' });
    });

    it('accepts a real LX export: compact JSON without line breaks', () => {
        const file = { type: 'playListPart_v2', data: { name: '洛雪列表', list: [lxMusicInfoFromRaw(kwRaw)] } };
        const parsed = parseLxPlaylistFile(JSON.stringify(file));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.songs).toHaveLength(1);
        expect(parsed.songs[0].id).toBe('kw:12345');
    });

    it('accepts Unix (LF) line endings', () => {
        const file = { type: 'playListPart_v2', data: { name: 'LF 列表', list: [lxMusicInfoFromRaw(kwRaw)] } };
        // 洛雪（Unix）导出：以 LF 换行；JSON 本身对空白不敏感。
        const lfText = JSON.stringify(file, null, 2);
        expect(lfText).not.toContain('\r');
        const parsed = parseLxPlaylistFile(lfText);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.name).toBe('LF 列表');
    });

    it('tolerates a UTF-8 BOM and CRLF line endings', () => {
        const file = { type: 'playListPart_v2', data: { name: '带 BOM', list: [lxMusicInfoFromRaw(kwRaw)] } };
        const text = `\uFEFF${JSON.stringify(file, null, 2).replace(/\n/g, '\r\n')}`;
        const parsed = parseLxPlaylistFile(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.name).toBe('带 BOM');
        expect(parsed.songs).toHaveLength(1);
    });
});
