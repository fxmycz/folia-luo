import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Covers the pure byte-level logic of the dependency-free audio tagger: ID3v2.3 tag/frame layout
// (big-endian frame size vs synchsafe tag size) and FLAC metadata block headers (last-block flag
// and big-endian length). A few embedTags cases exercise the temp-file + rename write path against
// synthetic bytes on disk — never real audio and never the network.

const require = createRequire(import.meta.url);
const audioTag = require('../../../electron/lxSource/audioTag.cjs') as {
    embedTags: (options: Record<string, unknown>) => Promise<{ ok: boolean; format?: string; written?: boolean; reason?: string }>;
    detectAudioFormat: (buffer: Buffer) => string | null;
    buildId3v2Tag: (fields: Record<string, unknown>) => Buffer | null;
    buildId3v2TextFrame: (id: string, value: string) => Buffer;
    buildId3v2ApicFrame: (cover: Buffer, mime: string) => Buffer | null;
    buildId3v2UsltFrame: (fields: Record<string, unknown>) => Buffer | null;
    getId3v2Size: (buffer: Buffer) => number;
    synchsafeEncode: (value: number) => Buffer;
    buildVorbisComment: (fields: Record<string, unknown>) => Buffer;
    buildFlacPicture: (fields: Record<string, unknown>) => Buffer | null;
    buildFlacBlocks: (blocks: Array<{ type: number; data: Buffer }>) => Buffer;
    buildFlacWithTags: (buffer: Buffer, fields: Record<string, unknown>) => Buffer | null;
    splitFlacMetadata: (buffer: Buffer) => { blocks: Array<{ type: number; data: Buffer; isLast: boolean }>; audioOffset: number };
    normalizeImageMime: (mime: unknown, data: Buffer) => string;
};

const synchsafeDecode = (buffer: Buffer, offset = 0): number => (
    ((buffer[offset] & 0x7f) << 21)
    | ((buffer[offset + 1] & 0x7f) << 14)
    | ((buffer[offset + 2] & 0x7f) << 7)
    | (buffer[offset + 3] & 0x7f)
);

/** Minimal PNG header: signature + IHDR size/width/height/bitDepth/colorType（够 readImageInfo 读）。 */
const pngHeader = (width: number, height: number, bitDepth = 8, colorType = 2): Buffer => {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    buf[24] = bitDepth;
    buf[25] = colorType;
    return buf;
};

/** 逐帧遍历 ID3v2.3 tag body，返回 { id, size }。 */
const readId3Frames = (tag: Buffer): Array<{ id: string; size: number }> => {
    const frames: Array<{ id: string; size: number }> = [];
    let offset = 10;
    while (offset + 10 <= tag.length) {
        const id = tag.toString('ascii', offset, offset + 4);
        const size = tag.readUInt32BE(offset + 4);
        frames.push({ id, size });
        offset += 10 + size;
    }
    return frames;
};

let tmpDir = '';

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-audiotag-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectAudioFormat', () => {
    it('recognises flac by magic', () => {
        expect(audioTag.detectAudioFormat(Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(4)]))).toBe('flac');
    });

    it('recognises mp3 by ID3 tag or frame sync', () => {
        expect(audioTag.detectAudioFormat(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)]))).toBe('mp3');
        expect(audioTag.detectAudioFormat(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3');
    });

    it('returns null for unsupported containers', () => {
        expect(audioTag.detectAudioFormat(Buffer.from('RIFF____', 'ascii'))).toBeNull();
        expect(audioTag.detectAudioFormat(Buffer.from([0, 0, 0, 0]))).toBeNull();
    });
});

describe('ID3v2.3 writer', () => {
    it('builds a tag with the ID3 prefix and a synchsafe size', () => {
        const tag = audioTag.buildId3v2Tag({
            title: '晴天', artist: '周杰伦', album: '叶惠美',
            cover: pngHeader(64, 48), mime: 'image/png', lyric: '[00:00]词',
        }) as Buffer;

        expect(tag.subarray(0, 3).toString('ascii')).toBe('ID3');
        expect(tag[3]).toBe(0x03);
        expect(tag[4]).toBe(0x00);
        expect(tag[5]).toBe(0x00);
        expect(synchsafeDecode(tag, 6)).toBe(tag.length - 10);
    });

    it('emits TIT2 / TPE1 / TALB / APIC / USLT frames in order', () => {
        const tag = audioTag.buildId3v2Tag({
            title: 'T', artist: 'A', album: 'B', cover: pngHeader(10, 10), mime: 'image/png', lyric: 'L',
        }) as Buffer;
        expect(readId3Frames(tag).map(frame => frame.id)).toEqual(['TIT2', 'TPE1', 'TALB', 'APIC', 'USLT']);
        expect(readId3Frames(tag).every(frame => frame.size > 0)).toBe(true);
    });

    it('encodes frame sizes as plain big-endian (not synchsafe)', () => {
        const frame = audioTag.buildId3v2TextFrame('TIT2', 'a'.repeat(200));
        const bodyLength = frame.length - 10;
        expect(frame.readUInt32BE(4)).toBe(bodyLength);
        expect(bodyLength).toBeGreaterThan(127);
        // synchsafe 会把最高有效位当符号位丢弃，读回值必然不同。
        expect(synchsafeDecode(frame, 4)).not.toBe(bodyLength);
    });

    it('writes an APIC frame with mime, picture type 3 and the image bytes', () => {
        const cover = pngHeader(32, 16);
        const frame = audioTag.buildId3v2ApicFrame(cover, 'image/png') as Buffer;
        const body = frame.subarray(10);
        expect(body[0]).toBe(0x00);
        const mimeEnd = body.indexOf(0x00, 1);
        expect(body.toString('latin1', 1, mimeEnd)).toBe('image/png');
        expect(body[mimeEnd + 1]).toBe(0x03);
        expect(body.subarray(body.length - cover.length).equals(cover)).toBe(true);
    });

    it('writes a USLT frame carrying encoding, language and lyrics', () => {
        const frame = audioTag.buildId3v2UsltFrame({ lyric: '[00:00]词', language: 'chi' }) as Buffer;
        expect(frame.toString('ascii', 0, 4)).toBe('USLT');
        const body = frame.subarray(10);
        expect(body[0]).toBe(0x01);
        expect(body.subarray(1, 4).toString('latin1')).toBe('chi');
    });

    it('measures an existing ID3v2 tag for replacement', () => {
        const header = Buffer.concat([
            Buffer.from('ID3', 'ascii'), Buffer.from([0x03, 0x00, 0x00]), audioTag.synchsafeEncode(100),
        ]);
        expect(audioTag.getId3v2Size(Buffer.concat([header, Buffer.alloc(100)]))).toBe(110);
        expect(audioTag.getId3v2Size(Buffer.from([0xff, 0xfb, 0x00, 0x00]))).toBe(0);
    });

    it('infers image mime from magic bytes when none is given', () => {
        expect(audioTag.normalizeImageMime('', pngHeader(4, 4))).toBe('image/png');
    });
});

describe('FLAC writer', () => {
    it('sets the last-metadata-block flag and big-endian length per block', () => {
        const streaminfo = Buffer.alloc(34, 0xaa);
        const comment = audioTag.buildVorbisComment({ title: 'T' });
        const out = audioTag.buildFlacBlocks([
            { type: 0, data: streaminfo },
            { type: 4, data: comment },
        ]);
        expect(out.subarray(0, 4).toString('ascii')).toBe('fLaC');
        expect(out[4] & 0x80).toBe(0);       // 非末块
        expect(out[4] & 0x7f).toBe(0);       // STREAMINFO
        expect(out.readUIntBE(5, 3)).toBe(34);
        const second = 4 + 4 + 34;
        expect(out[second] & 0x80).toBe(0x80); // 末块
        expect(out[second] & 0x7f).toBe(4);
        expect(out.readUIntBE(second + 1, 3)).toBe(comment.length);
    });

    it('serialises VorbisComment entries as KEY=value', () => {
        const comment = audioTag.buildVorbisComment({ title: '晴天', artist: '周杰伦', album: '叶惠美', lyric: '[00:00]词' });
        const vendorLength = comment.readUInt32LE(0);
        let offset = 4 + vendorLength;
        const count = comment.readUInt32LE(offset);
        offset += 4;
        expect(count).toBe(4);
        const entries: string[] = [];
        for (let i = 0; i < count; i += 1) {
            const length = comment.readUInt32LE(offset);
            offset += 4;
            entries.push(comment.toString('utf8', offset, offset + length));
            offset += length;
        }
        expect(entries).toEqual(['TITLE=晴天', 'ARTIST=周杰伦', 'ALBUM=叶惠美', 'LYRICS=[00:00]词']);
    });

    it('serialises a PICTURE block with type, mime, dimensions and data', () => {
        const cover = pngHeader(64, 48, 8, 2);
        const picture = audioTag.buildFlacPicture({ cover, mime: 'image/png' }) as Buffer;
        expect(picture.readUInt32BE(0)).toBe(3);
        const mimeLength = picture.readUInt32BE(4);
        expect(picture.toString('latin1', 8, 8 + mimeLength)).toBe('image/png');
        let offset = 8 + mimeLength;
        const descLength = picture.readUInt32BE(offset);
        offset += 4 + descLength;
        expect(picture.readUInt32BE(offset)).toBe(64); offset += 4;
        expect(picture.readUInt32BE(offset)).toBe(48); offset += 4;
        expect(picture.readUInt32BE(offset)).toBe(24); offset += 4;
        expect(picture.readUInt32BE(offset)).toBe(0); offset += 4;
        const dataLength = picture.readUInt32BE(offset);
        offset += 4;
        expect(dataLength).toBe(cover.length);
        expect(picture.subarray(offset).equals(cover)).toBe(true);
    });

    it('inserts new blocks after STREAMINFO and keeps the audio frame bytes', () => {
        const streaminfo = Buffer.alloc(34, 0x11);
        const streaminfoHeader = Buffer.from([0x80, 0x00, 0x00, 34]);
        const audio = Buffer.from([1, 2, 3, 4, 5]);
        const flac = Buffer.concat([Buffer.from('fLaC', 'ascii'), streaminfoHeader, streaminfo, audio]);

        const out = audioTag.buildFlacWithTags(flac, { title: 'T', cover: pngHeader(8, 8), mime: 'image/png' }) as Buffer;
        const { blocks, audioOffset } = audioTag.splitFlacMetadata(out);
        expect(blocks.map(block => block.type)).toEqual([0, 4, 6]);
        expect(blocks[0].isLast).toBe(false);
        expect(blocks[blocks.length - 1].isLast).toBe(true);
        expect(out.subarray(audioOffset).equals(audio)).toBe(true);
    });
});

describe('embedTags', () => {
    it('prepends an ID3v2 tag to an mp3 and preserves the audio bytes', async () => {
        const file = path.join(tmpDir, 'song.mp3');
        const original = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
        fs.writeFileSync(file, original);

        const result = await audioTag.embedTags({ filePath: file, title: 'T', artist: 'A', lyric: 'L' });
        expect(result.ok).toBe(true);
        expect(result.format).toBe('mp3');
        expect(result.written).toBe(true);

        const out = fs.readFileSync(file);
        expect(out.subarray(0, 3).toString('ascii')).toBe('ID3');
        expect(out.subarray(out.length - original.length).equals(original)).toBe(true);
    });

    it('replaces an existing ID3v2 tag instead of stacking a new one', async () => {
        const file = path.join(tmpDir, 'tagged.mp3');
        const oldTag = Buffer.concat([
            Buffer.from('ID3', 'ascii'), Buffer.from([0x03, 0x00, 0x00]), audioTag.synchsafeEncode(20), Buffer.alloc(20),
        ]);
        const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 9, 9]);
        fs.writeFileSync(file, Buffer.concat([oldTag, audio]));

        await audioTag.embedTags({ filePath: file, title: 'New' });
        const out = fs.readFileSync(file);
        // 只应有一个 ID3 头，且音频尾部保持原样。
        expect(out.subarray(0, 3).toString('ascii')).toBe('ID3');
        expect(out.indexOf(Buffer.from('ID3', 'ascii'), 3)).toBe(-1);
        expect(out.subarray(out.length - audio.length).equals(audio)).toBe(true);
    });

    it('embeds into a flac file, keeping the audio bytes', async () => {
        const file = path.join(tmpDir, 'song.flac');
        const streaminfo = Buffer.alloc(34, 0x22);
        const audio = Buffer.from([7, 7, 7, 7]);
        fs.writeFileSync(file, Buffer.concat([
            Buffer.from('fLaC', 'ascii'), Buffer.from([0x80, 0x00, 0x00, 34]), streaminfo, audio,
        ]));

        const result = await audioTag.embedTags({ filePath: file, title: 'T', cover: pngHeader(8, 8), mime: 'image/png' });
        expect(result.ok).toBe(true);
        expect(result.format).toBe('flac');

        const { blocks, audioOffset } = audioTag.splitFlacMetadata(fs.readFileSync(file));
        expect(blocks.map(block => block.type)).toEqual([0, 4, 6]);
        expect(fs.readFileSync(file).subarray(audioOffset).equals(audio)).toBe(true);
    });

    it('leaves unsupported formats untouched', async () => {
        const file = path.join(tmpDir, 'song.m4a');
        const original = Buffer.from('....ftypM4A ', 'ascii');
        fs.writeFileSync(file, original);

        const result = await audioTag.embedTags({ filePath: file, title: 'T' });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('unsupported-format');
        expect(fs.readFileSync(file).equals(original)).toBe(true);
    });

    it('reports written:false when there is nothing to embed', async () => {
        const file = path.join(tmpDir, 'empty.mp3');
        fs.writeFileSync(file, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
        const result = await audioTag.embedTags({ filePath: file });
        expect(result.ok).toBe(true);
        expect(result.written).toBe(false);
    });
});
