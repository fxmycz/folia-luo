// electron/lxSource/audioTag.cjs
// 无第三方依赖的音频标签写入：下载完成后把标题 / 艺术家 / 专辑 / 歌词 / 封面内嵌进音频文件。
// 支持 MP3（ID3v2.3）与 FLAC（VorbisComment + PICTURE）；其他格式安全降级为原样返回。
//
// 设计要点（与任务约束一致）：
// - ID3v2 帧 size 用普通大端 32 位；tag 总大小用 synchsafe。
// - FLAC 需重算 STREAMINFO 之后每个 METADATA_BLOCK_HEADER 的 last 标志与长度。
// - 写入先落到同目录临时文件再 rename 覆盖，失败时原文件保持不变。
// - 纯逻辑（构造 tag / block 字节）单独导出，便于离线单测。
'use strict';

const fs = require('node:fs');

/** 空安全字符串化。 */
const toText = (value) => (value == null ? '' : String(value));

/** 归一化二进制入参：接受 Buffer / Uint8Array / ArrayBufferView。 */
const toBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.alloc(0);
};

// ---------------------------------------------------------------------------
// 通用整数编码
// ---------------------------------------------------------------------------

/** ID3v2 tag 大小：28 位同步安全整数（每字节 7 位有效）。 */
const synchsafeEncode = (value) => {
  const n = Number(value) >>> 0;
  return Buffer.from([
    (n >>> 21) & 0x7f,
    (n >>> 14) & 0x7f,
    (n >>> 7) & 0x7f,
    n & 0x7f,
  ]);
};

/** 解析 synchsafe 整数。 */
const synchsafeDecode = (buffer, offset = 0) => (
  ((buffer[offset] & 0x7f) << 21)
  | ((buffer[offset + 1] & 0x7f) << 14)
  | ((buffer[offset + 2] & 0x7f) << 7)
  | (buffer[offset + 3] & 0x7f)
);

const uint32be = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(Number(value) >>> 0, 0);
  return buffer;
};

const uint32le = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(Number(value) >>> 0, 0);
  return buffer;
};

// ---------------------------------------------------------------------------
// 图片：mime 归一化与尺寸解析
// ---------------------------------------------------------------------------

const isPng = (data) => data.length >= 8
  && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a;

const isJpeg = (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;

/** 已知图片 mime 优先；否则按魔数推断；再兜底 image/jpeg。 */
const normalizeImageMime = (mime, data) => {
  const raw = toText(mime).toLowerCase().trim();
  if (raw === 'image/jpg') return 'image/jpeg';
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(raw)) return raw;
  if (isPng(data)) return 'image/png';
  if (isJpeg(data)) return 'image/jpeg';
  return raw || 'image/jpeg';
};

/** 从 PNG / JPEG 头解析宽高与色深；失败时给 0（部分播放器容忍）。 */
const readImageInfo = (data) => {
  try {
    if (isPng(data) && data.length >= 26) {
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[data[25]] || 3;
      return {
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
        depth: data[24] * channels,
      };
    }
    if (isJpeg(data)) {
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = data[offset + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const length = data.readUInt16BE(offset + 2);
        // SOF 段（除 DHT/JPG/DAC）携带尺寸与精度。
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return {
            width: data.readUInt16BE(offset + 7),
            height: data.readUInt16BE(offset + 5),
            depth: data[offset + 4] * data[offset + 9],
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // 头部异常时退化为 0 尺寸。
  }
  return { width: 0, height: 0, depth: 0 };
};

// ---------------------------------------------------------------------------
// MP3 / ID3v2.3
// ---------------------------------------------------------------------------

// ID3v2.3 只标准定义 0x00 / 0x01；0x01 = UTF-16（带 BOM），对中日韩最稳妥。
const ID3_TEXT_ENCODING = 0x01;

const encodeId3String = (value, encoding) => {
  const str = toText(value);
  if (!str) return Buffer.alloc(0);
  if (encoding === 0x03) return Buffer.from(str, 'utf8');
  // UTF-16：BOM(FF FE) + little-endian 码元。
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(str, 'utf16le')]);
};

const id3Terminator = (encoding) => (encoding === 0x03 ? Buffer.from([0x00]) : Buffer.from([0x00, 0x00]));

/** 拼一个 ID3v2.3 帧：id(4B) + size(4B 普通大端) + flags(2B) + body。 */
const buildId3Frame = (id, body) => {
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(body.length, 4); // ID3v2.3：普通大端，绝非 synchsafe。
  header.writeUInt16BE(0, 8);
  return Buffer.concat([header, body]);
};

/** 文本帧（TIT2 / TPE1 / TALB）。 */
const buildId3v2TextFrame = (id, value, encoding = ID3_TEXT_ENCODING) => {
  const body = Buffer.concat([
    Buffer.from([encoding]),
    encodeId3String(value, encoding),
    id3Terminator(encoding),
  ]);
  return buildId3Frame(id, body);
};

/** APIC 封面帧：encoding + mime(0x00 结尾) + 图片类型 + 描述(0x00 结尾) + 图片数据。 */
const buildId3v2ApicFrame = (cover, mime) => {
  const data = toBuffer(cover);
  if (!data.length) return null;
  const imageMime = normalizeImageMime(mime, data);
  const body = Buffer.concat([
    Buffer.from([0x00]), // 描述用 ISO-8859-1，空描述只占 1 字节
    Buffer.from(imageMime, 'latin1'),
    Buffer.from([0x00]), // mime 结束符
    Buffer.from([0x03]), // 图片类型 0x03 = 封面
    Buffer.from([0x00]), // 空描述结束符
    data,
  ]);
  return buildId3Frame('APIC', body);
};

/** USLT 歌词帧：encoding + language(3B) + 描述 + 歌词文本。 */
const buildId3v2UsltFrame = ({ lyric, language = 'und', descriptor = '' } = {}) => {
  const text = toText(lyric);
  if (!text) return null;
  const lang = /^[a-z]{3}$/i.test(toText(language)) ? toText(language).toLowerCase() : 'und';
  const body = Buffer.concat([
    Buffer.from([ID3_TEXT_ENCODING]),
    Buffer.from(lang, 'latin1'),
    encodeId3String(descriptor, ID3_TEXT_ENCODING),
    id3Terminator(ID3_TEXT_ENCODING),
    encodeId3String(text, ID3_TEXT_ENCODING),
  ]);
  return buildId3Frame('USLT', body);
};

/** 依据歌词内容猜语言（含 CJK → chi，否则 und）。 */
const guessLanguage = (value) => (
  /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(toText(value)) ? 'chi' : 'und'
);

/** 构造完整 ID3v2.3 tag；无有效字段时返回 null。 */
const buildId3v2Tag = ({ title, artist, album, cover, mime, lyric, language } = {}) => {
  const frames = [];
  if (toText(title)) frames.push(buildId3v2TextFrame('TIT2', title));
  if (toText(artist)) frames.push(buildId3v2TextFrame('TPE1', artist));
  if (toText(album)) frames.push(buildId3v2TextFrame('TALB', album));
  const apic = buildId3v2ApicFrame(cover, mime);
  if (apic) frames.push(apic);
  const uslt = buildId3v2UsltFrame({ lyric, language: language ?? guessLanguage(lyric) });
  if (uslt) frames.push(uslt);
  if (!frames.length) return null;

  const body = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'ascii');
  header[3] = 0x03; // 主版本 2.3
  header[4] = 0x00; // 修订号
  header[5] = 0x00; // flags
  synchsafeEncode(body.length).copy(header, 6);
  return Buffer.concat([header, body]);
};

/** 已有 ID3v2 tag 的总字节数（含 10B 头；2.4 有 footer 时再 +10）。无则 0。 */
const getId3v2Size = (buffer) => {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'ID3') return 0;
  let size = 10 + synchsafeDecode(buffer, 6);
  if (buffer[3] === 0x04 && (buffer[5] & 0x10)) size += 10;
  return size;
};

// ---------------------------------------------------------------------------
// FLAC
// ---------------------------------------------------------------------------

const FLAC_BLOCK_TYPE = { STREAMINFO: 0, VORBIS_COMMENT: 4, PICTURE: 6 };

/** VorbisComment 块数据：vendor + 评论条数 + 每条 "KEY=value"（均小端长度）。 */
const buildVorbisComment = ({ title, artist, album, lyric, vendor = 'Folia' } = {}) => {
  const comments = [];
  if (toText(title)) comments.push(`TITLE=${title}`);
  if (toText(artist)) comments.push(`ARTIST=${artist}`);
  if (toText(album)) comments.push(`ALBUM=${album}`);
  if (toText(lyric)) comments.push(`LYRICS=${lyric}`);
  const vendorBuf = Buffer.from(toText(vendor) || 'Folia', 'utf8');
  const parts = [uint32le(vendorBuf.length), vendorBuf, uint32le(comments.length)];
  for (const comment of comments) {
    const buf = Buffer.from(comment, 'utf8');
    parts.push(uint32le(buf.length), buf);
  }
  return Buffer.concat(parts);
};

/** PICTURE 块数据：类型 + mime + 描述 + 宽高深 + 图片数据（均大端）。 */
const buildFlacPicture = ({ cover, mime, description = '' } = {}) => {
  const data = toBuffer(cover);
  if (!data.length) return null;
  const imageMime = normalizeImageMime(mime, data);
  const { width, height, depth } = readImageInfo(data);
  const mimeBuf = Buffer.from(imageMime, 'latin1');
  const descBuf = Buffer.from(toText(description), 'utf8');
  return Buffer.concat([
    uint32be(3), // 图片类型 3 = 封面
    uint32be(mimeBuf.length), mimeBuf,
    uint32be(descBuf.length), descBuf,
    uint32be(width), uint32be(height), uint32be(depth), uint32be(0),
    uint32be(data.length), data,
  ]);
};

/** 把 (type, data) 列表拼成完整 FLAC 头部（含 "fLaC" 与重算后的块头）。 */
const buildFlacBlocks = (blocks) => {
  const parts = [Buffer.from('fLaC', 'ascii')];
  blocks.forEach((block, index) => {
    const data = toBuffer(block.data);
    const header = Buffer.alloc(4);
    const isLast = index === blocks.length - 1;
    header[0] = (isLast ? 0x80 : 0x00) | (block.type & 0x7f);
    header.writeUIntBE(data.length, 1, 3);
    parts.push(header, data);
  });
  return Buffer.concat(parts);
};

/** 解析 FLAC 元数据块（STREAMINFO 起始），返回块列表与音频数据起始偏移。 */
const splitFlacMetadata = (buffer) => {
  const blocks = [];
  let offset = 4;
  if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'fLaC') {
    return { blocks, audioOffset: buffer.length };
  }
  while (offset + 4 <= buffer.length) {
    const headerByte = buffer[offset];
    const isLast = (headerByte & 0x80) !== 0;
    const type = headerByte & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    const end = Math.min(offset + 4 + length, buffer.length);
    blocks.push({ type, data: buffer.subarray(offset + 4, end), isLast });
    offset = offset + 4 + length;
    if (isLast) break;
  }
  return { blocks, audioOffset: offset };
};

/** 重组 FLAC：保留 STREAMINFO 与其它块，去掉旧 VORBIS_COMMENT/PICTURE，插入新块。 */
const buildFlacWithTags = (buffer, fields = {}) => {
  const { blocks, audioOffset } = splitFlacMetadata(buffer);
  if (!blocks.length || blocks[0].type !== FLAC_BLOCK_TYPE.STREAMINFO) return null;
  const streaminfo = blocks[0];
  const kept = blocks.slice(1).filter(
    block => block.type !== FLAC_BLOCK_TYPE.VORBIS_COMMENT && block.type !== FLAC_BLOCK_TYPE.PICTURE,
  );

  const additions = [];
  const hasText = toText(fields.title) || toText(fields.artist) || toText(fields.album) || toText(fields.lyric);
  if (hasText) additions.push({ type: FLAC_BLOCK_TYPE.VORBIS_COMMENT, data: buildVorbisComment(fields) });
  if (toBuffer(fields.cover).length) {
    const picture = buildFlacPicture(fields);
    if (picture) additions.push({ type: FLAC_BLOCK_TYPE.PICTURE, data: picture });
  }
  if (!additions.length) return null;

  const head = buildFlacBlocks([streaminfo, ...additions, ...kept]);
  return Buffer.concat([head, buffer.subarray(audioOffset)]);
};

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/** 按魔数识别容器：仅识别 mp3 / flac，其余返回 null（安全降级）。 */
const detectAudioFormat = (buffer) => {
  if (!buffer || buffer.length < 4) return null;
  if (buffer.toString('ascii', 0, 4) === 'fLaC') return 'flac';
  if (buffer.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
};

/**
 * 把标签内嵌进音频文件。绝不抛错：任何异常都转为 { ok:false, reason }，原文件保持不变。
 * @param {object} options
 * @param {string} options.filePath 目标音频文件（mp3 / flac）
 * @param {string} [options.title]
 * @param {string} [options.artist]
 * @param {string} [options.album]
 * @param {Buffer|Uint8Array} [options.cover] 封面二进制
 * @param {string} [options.mime] 封面 mime
 * @param {string} [options.lyric] 歌词文本
 * @returns {Promise<{ ok: boolean, format?: string, written?: boolean, reason?: string, error?: string }>}
 */
async function embedTags({ filePath, title, artist, album, cover, mime, lyric } = {}) {
  if (typeof filePath !== 'string' || !filePath) return { ok: false, reason: 'invalid-path' };

  let original;
  try {
    original = await fs.promises.readFile(filePath);
  } catch (error) {
    return { ok: false, reason: 'read-failed', error: error?.message };
  }

  const format = detectAudioFormat(original);
  if (!format) return { ok: false, reason: 'unsupported-format' };

  const hasText = Boolean(toText(title) || toText(artist) || toText(album) || toText(lyric));
  const hasCover = toBuffer(cover).length > 0;
  if (!hasText && !hasCover) return { ok: true, format, written: false };

  let output;
  try {
    if (format === 'mp3') {
      const tag = buildId3v2Tag({ title, artist, album, cover, mime, lyric });
      if (!tag) return { ok: true, format, written: false };
      // 先剥离旧 ID3v2 tag，再写新 tag，避免叠加。
      output = Buffer.concat([tag, original.subarray(getId3v2Size(original))]);
    } else {
      output = buildFlacWithTags(original, { title, artist, album, cover, mime, lyric });
      if (!output) return { ok: true, format, written: false };
    }
  } catch (error) {
    return { ok: false, reason: 'build-failed', error: error?.message };
  }

  const tempPath = `${filePath}.folia-tag.tmp`;
  try {
    await fs.promises.writeFile(tempPath, output);
    await fs.promises.rename(tempPath, filePath);
    return { ok: true, format, written: true };
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    return { ok: false, reason: 'write-failed', error: error?.message };
  }
}

module.exports = {
  embedTags,
  // 纯逻辑导出，供离线单测。
  detectAudioFormat,
  buildId3v2Tag,
  buildId3v2TextFrame,
  buildId3v2ApicFrame,
  buildId3v2UsltFrame,
  getId3v2Size,
  synchsafeEncode,
  synchsafeDecode,
  buildVorbisComment,
  buildFlacPicture,
  buildFlacBlocks,
  buildFlacWithTags,
  splitFlacMetadata,
  normalizeImageMime,
  readImageInfo,
};
