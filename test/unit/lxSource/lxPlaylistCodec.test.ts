import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// test/unit/lxSource/lxPlaylistCodec.test.ts
// 洛雪 `.lxmc` 的实际内容是 gzip 压缩的 JSON（其主进程 saveLxConfigFile / readLxConfigFile 负责压缩）。
// 这里直接测主进程用的编解码模块：导出必须写成 gzip（洛雪才能读回），导入必须 gzip 与纯 JSON 都吃。

const nodeRequire = createRequire(import.meta.url);
const { encodeLxPlaylistFile, decodeLxPlaylistFile, isGzip } = nodeRequire('../../../electron/lxSource/lxPlaylistCodec.cjs') as {
    encodeLxPlaylistFile: (text: string) => Buffer;
    decodeLxPlaylistFile: (buffer: Buffer) => string;
    isGzip: (buffer: Buffer) => boolean;
};

const sample = '{"type":"playListPart_v2","data":{"id":"love","name":"我的音乐","list":[]}}';

describe('lxPlaylistCodec · 洛雪 .lxmc 编解码', () => {
    it('writes a gzip stream so LX can read it back', () => {
        const encoded = encodeLxPlaylistFile(sample);
        expect(isGzip(encoded)).toBe(true);
        expect(decodeLxPlaylistFile(encoded)).toBe(sample);
    });

    it('decodes a gzip file produced by LX itself', () => {
        expect(decodeLxPlaylistFile(gzipSync(Buffer.from(sample, 'utf8')))).toBe(sample);
    });

    it('keeps plain JSON text unchanged (向前兼容旧的未压缩导出)', () => {
        const plain = Buffer.from(sample, 'utf8');
        expect(isGzip(plain)).toBe(false);
        expect(decodeLxPlaylistFile(plain)).toBe(sample);
    });

    it('strips a UTF-8 BOM', () => {
        expect(decodeLxPlaylistFile(Buffer.from(`\uFEFF${sample}`, 'utf8'))).toBe(sample);
    });
});
