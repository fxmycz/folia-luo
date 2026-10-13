import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Covers the offline-testable parts of the LX download queue: filename sanitizing, quality
// downgrade, extension inference, and the FIFO / two-at-a-time scheduler. Network and the host
// window are replaced by injected fakes so the test never touches the real world.

const require = createRequire(import.meta.url);
const {
    createLxDownload,
    sanitizeFileName,
    buildDownloadFileName,
    pickDownloadQuality,
    extensionForQuality,
} = require('../../../electron/lxSource/lxDownload.cjs') as {
    createLxDownload: (options: unknown) => {
        getDownloadDir: () => string;
        setDownloadDir: (dir: string) => string;
        start: (payload: unknown) => { taskId: string; status: string };
        cancel: (taskId: string) => boolean;
        list: () => Array<{ taskId: string; name: string; status: string; quality: string | null; degraded: boolean; progress: number; filePath: string | null }>;
    };
    sanitizeFileName: (value: unknown) => string;
    buildDownloadFileName: (artist: unknown, name: unknown, extension: unknown) => string;
    pickDownloadQuality: (preference: string, supported: unknown) => string;
    extensionForQuality: (quality: string, url: unknown) => string;
};

type FakeFetchResponse = {
    ok: boolean;
    status: number;
    body: ReadableStream<Uint8Array>;
    headers: { get: (key: string) => string | null };
};

let tmpDir = '';

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-download-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

const makeResponse = (chunks: Uint8Array[], contentLength?: number): FakeFetchResponse => {
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
        },
    });
    return {
        ok: true,
        status: 200,
        body,
        headers: {
            get: (key) => (key.toLowerCase() === 'content-length' && contentLength != null
                ? String(contentLength)
                : null),
        },
    };
};

const makeHost = (qualitys: string[]) => ({
    getStatus: () => ({
        activeApiId: 'api',
        loaded: true,
        message: '',
        sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys } },
    }),
    request: async () => ({ data: { type: '320k', url: 'https://example.com/song.mp3' } }),
});

const makeStore = () => {
    const map = new Map<string, unknown>();
    return {
        get: (key: string) => map.get(key),
        set: (key: string, value: unknown) => { map.set(key, value); },
        delete: (key: string) => { map.delete(key); },
    };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 4000): Promise<void> => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};

describe('sanitizeFileName', () => {
    it('replaces path separators and reserved characters', () => {
        expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    });

    it('collapses whitespace and trims trailing dots/spaces', () => {
        expect(sanitizeFileName('  多   余   空格 ... ')).toBe('多 余 空格');
    });
});

describe('buildDownloadFileName', () => {
    it('formats as "{artist} - {name}.{ext}"', () => {
        expect(buildDownloadFileName('周杰伦', '晴天', 'flac')).toBe('周杰伦 - 晴天.flac');
    });

    it('falls back to placeholders for missing fields', () => {
        expect(buildDownloadFileName('', '', 'mp3')).toBe('未知歌手 - 未知歌曲.mp3');
    });

    it('sanitizes illegal characters coming from metadata', () => {
        expect(buildDownloadFileName('A/B', 'C:D', 'mp3')).toBe('A_B - C_D.mp3');
    });
});

describe('pickDownloadQuality', () => {
    it('returns the requested tier when supported', () => {
        expect(pickDownloadQuality('lossless', ['128k', '320k', 'flac', 'flac24bit'])).toBe('flac');
    });

    it('downgrades to the highest supported tier below the request', () => {
        expect(pickDownloadQuality('lossless', ['128k', '320k'])).toBe('320k');
    });

    it('falls back to the lowest tier when nothing is at or below the request', () => {
        expect(pickDownloadQuality('standard', ['320k', 'flac'])).toBe('320k');
    });

    it('keeps the desired tier when the host declares no qualities', () => {
        expect(pickDownloadQuality('hires', [])).toBe('flac24bit');
    });
});

describe('extensionForQuality', () => {
    it('prefers a known audio extension from the URL', () => {
        expect(extensionForQuality('320k', 'https://cdn.example.com/x.m4a?token=1')).toBe('m4a');
    });

    it('infers the extension from quality when the URL has none', () => {
        expect(extensionForQuality('flac24bit', 'https://cdn.example.com/stream')).toBe('flac');
        expect(extensionForQuality('128k', 'https://cdn.example.com/stream')).toBe('mp3');
    });
});

describe('download queue', () => {
    const startPayload = (name: string) => ({
        track: { source: 'kw', musicInfo: { songmid: name }, name, artist: '歌手' },
        quality: 'high',
    });

    it('writes the file and reports completion', async () => {
        const download = createLxDownload({
            host: makeHost(['128k', '320k']),
            store: makeStore(),
            defaultDir: tmpDir,
            fetchImpl: async () => makeResponse([bytes('hello')]),
        });

        const task = download.start(startPayload('晴天'));
        await waitFor(() => download.list()[0]?.status === 'done');

        const [record] = download.list();
        expect(record.taskId).toBe(task.taskId);
        expect(record.progress).toBe(1);
        expect(record.filePath).toBe(path.join(tmpDir, '歌手 - 晴天.mp3'));
        expect(fs.readFileSync(record.filePath as string, 'utf8')).toBe('hello');
    });

    it('downgrades quality and reports it when the target tier is unavailable', async () => {
        const download = createLxDownload({
            host: makeHost(['128k']),
            store: makeStore(),
            defaultDir: tmpDir,
            fetchImpl: async () => makeResponse([bytes('data')]),
        });

        download.start({ ...startPayload('屋顶'), quality: 'lossless' });
        await waitFor(() => download.list()[0]?.status === 'done');

        const [record] = download.list();
        expect(record.quality).toBe('128k');
        expect(record.degraded).toBe(true);
    });

    it('runs at most two tasks concurrently and preserves FIFO order', async () => {
        const startedOrder: string[] = [];
        const gates: Array<() => void> = [];
        const gate = new Promise<void>(resolve => gates.push(resolve));

        const download = createLxDownload({
            host: makeHost(['128k', '320k']),
            store: makeStore(),
            defaultDir: tmpDir,
            onProgress: (task: { status: string; name: string }) => {
                if (task.status === 'downloading' && !startedOrder.includes(task.name)) startedOrder.push(task.name);
            },
            fetchImpl: async () => { await gate; return makeResponse([bytes('x')]); },
        });

        download.start(startPayload('one'));
        download.start(startPayload('two'));
        download.start(startPayload('three'));

        await waitFor(() => startedOrder.length === 2);
        expect(startedOrder).toEqual(['one', 'two']);
        expect(download.list().filter(item => item.status === 'downloading').length).toBe(2);

        gates.forEach(resolve => resolve());
        await waitFor(() => download.list().every(item => item.status === 'done'));
        expect(startedOrder).toEqual(['one', 'two', 'three']);
    });

    it('cancels a queued task before it starts', async () => {
        const gates: Array<() => void> = [];
        const gate = new Promise<void>(resolve => gates.push(resolve));
        const download = createLxDownload({
            host: makeHost(['320k']),
            store: makeStore(),
            defaultDir: tmpDir,
            fetchImpl: async () => { await gate; return makeResponse([bytes('x')]); },
        });

        download.start(startPayload('a'));
        download.start(startPayload('b'));
        const third = download.start(startPayload('c'));

        expect(download.cancel(third.taskId)).toBe(true);
        await waitFor(() => download.list().some(item => item.taskId === third.taskId && item.status === 'canceled'));

        gates.forEach(resolve => resolve());
        await waitFor(() => download.list().filter(item => item.status === 'done').length === 2);
        expect(download.list().find(item => item.taskId === third.taskId)?.status).toBe('canceled');
    });

    it('remembers a custom download directory', () => {
        const download = createLxDownload({
            host: makeHost(['320k']),
            store: makeStore(),
            defaultDir: '/default/dir',
            fetchImpl: async () => makeResponse([bytes('x')]),
        });
        expect(download.getDownloadDir()).toBe('/default/dir');
        expect(download.setDownloadDir('/custom/dir')).toBe('/custom/dir');
        expect(download.getDownloadDir()).toBe('/custom/dir');
    });
});
