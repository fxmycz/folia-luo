'use strict';

const fs = require('fs');
const path = require('path');

// electron/luoxueSource/tags.cjs
// 把标题 / 艺术家 / 专辑 / 歌词 / 封面嵌入音频文件（自研最小实现，不依赖 node-id3 等第三方库）。
// 只支持 .mp3（ID3v2.3）与 .flac（Vorbis comment + PICTURE），其它后缀返回 supported:false 且不写标签。
// 封面字节由调用方（index.cjs）在主进程取好后通过 fetchCover 注入，本模块只负责解析尺寸与拼帧。
// 参考：ikun-music-desktop 的 src/common/utils/musicMeta/{mp3Meta,flacMeta}.js 与 flac-metadata。

const UNSUPPORTED_REASON = '该音频格式暂不支持嵌入标签';

// ---- 封面字节解析（MIME 与尺寸） ----

// 从图片字节里判 MIME 与像素尺寸：JPEG 看 FF D8 FF，PNG 看 89 50 4E 47。识别不了返回 null。
const detectImage = (buf) => {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    // PNG：IHDR 数据从偏移 16 开始依次是 4 字节宽、4 字节高（大端）。
    if (buf.length >= 24) {
      return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitsPerPixel: 32 };
    }
    return null;
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // JPEG：顺序扫描段，找到 SOFn 段里的高 / 宽（各 2 字节大端）。
    const size = readJpegSize(buf);
    return { mime: 'image/jpeg', width: size.width, height: size.height, bitsPerPixel: 24 };
  }
  return null;
};

const readJpegSize = (buf) => {
  let offset = 2;
  while (offset + 3 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // 无独立长度的标记：填充 0xFF、RST0-RST7、SOI/EOI。
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // SOS 之后是熵编码数据，不再有尺寸段。
    const segLength = buf.readUInt16BE(offset + 2);
    // SOF0-SOF15（排除 DHT=C4、JPG=C8、DAC=CC）里带高 / 宽。
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 >= buf.length) break;
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + segLength;
  }
  return { width: 0, height: 0 };
};

// ---- MP3 / ID3v2.3 ----

const UTF16_BOM = Buffer.from([0xff, 0xfe]);

// 把 28 位长度写成 4 字节 syncsafe（每字节只用低 7 位），ID3v2 标签体长度用。
const syncSafe = (size) => Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);

// 拼一个 ID3v2.3 帧：10 字节帧头（4 字节 ID + 4 字节大端 size + 2 字节 flags=0）+ 帧体。
const buildFrame = (id, data) => {
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'latin1');
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
};

// 文本帧：编码字节 0x01（UTF-16 带 BOM）+ BOM + UTF-16LE 正文。
const buildTextFrame = (id, value) =>
  buildFrame(id, Buffer.concat([Buffer.from([0x01]), UTF16_BOM, Buffer.from(String(value), 'utf16le')]));

// USLT 帧：编码字节 + 3 字节语言码 + 空内容描述符终止符 + BOM + 歌词正文。
const buildUsltFrame = (value) =>
  buildFrame(
    'USLT',
    Buffer.concat([
      Buffer.from([0x01]),
      Buffer.from('zho', 'latin1'),
      Buffer.from([0x00, 0x00]), // UTF-16 下空描述符的 2 字节终止符
      UTF16_BOM,
      Buffer.from(String(value), 'utf16le'),
    ]),
  );

// APIC 帧：编码字节 0x00（描述符用 ISO-8859-1）+ MIME + 终止符 + 封面类型 0x03 + 空描述符终止符 + 图片。
const buildApicFrame = (cover) =>
  buildFrame(
    'APIC',
    Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from(cover.mime, 'latin1'),
      Buffer.from([0x00, 0x03, 0x00]),
      cover.data,
    ]),
  );

// 剥掉文件头已有的 ID3v2 标签，返回音频数据起始偏移（没有标签则返回 0）。ID3v1 尾部不动。
const id3v2End = (buf) => {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0;
  const version = buf[3];
  const flags = buf[5];
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  let total = 10 + size;
  if (version >= 4 && (flags & 0x10)) total += 10; // ID3v2.4 footer 占额外 10 字节
  return Math.min(total, buf.length);
};

// 构造新的 ID3v2.3 标签体并拼到剥掉旧标签后的音频数据前面。
const buildMp3 = (input, meta, cover) => {
  const frames = [];
  if (meta.title) frames.push(buildTextFrame('TIT2', meta.title));
  if (meta.artist) frames.push(buildTextFrame('TPE1', meta.artist));
  if (meta.album) frames.push(buildTextFrame('TALB', meta.album));
  if (meta.lyrics) frames.push(buildUsltFrame(meta.lyrics));
  if (cover) frames.push(buildApicFrame(cover));

  const body = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'latin1');
  header[3] = 0x03; // 版本 2.3
  header[4] = 0x00;
  header[5] = 0x00; // flags 全 0
  syncSafe(body.length).copy(header, 6);
  return Buffer.concat([header, body, input.slice(id3v2End(input))]);
};

// ---- FLAC ----

const FLAC_VENDOR = 'reference libFLAC 1.2.1 20070917';

// Vorbis comment 块体：vendor + 若干 KEY=VALUE（全 UTF-8，长度字段为小端）。
const buildVorbisComment = (meta) => {
  const pairs = [];
  if (meta.title) pairs.push(`TITLE=${meta.title}`);
  if (meta.artist) pairs.push(`ARTIST=${meta.artist}`);
  if (meta.album) pairs.push(`ALBUM=${meta.album}`);
  if (meta.lyrics) pairs.push(`LYRICS=${meta.lyrics}`);

  const vendorBuf = Buffer.from(FLAC_VENDOR, 'utf8');
  const parts = [Buffer.alloc(4), vendorBuf, Buffer.alloc(4)];
  parts[0].writeUInt32LE(vendorBuf.length, 0);
  parts[2].writeUInt32LE(pairs.length, 0);
  for (const pair of pairs) {
    const buf = Buffer.from(pair, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(buf.length, 0);
    parts.push(len, buf);
  }
  return Buffer.concat(parts);
};

// PICTURE 块体：类型 / MIME / 空描述 / 宽高与像素信息 / 图片数据，长度字段均为大端。
const buildPicture = (cover) => {
  const mimeBuf = Buffer.from(cover.mime, 'utf8');
  const type = Buffer.alloc(4);
  type.writeUInt32BE(3, 0); // pictureType 3 = front cover
  const mimeLen = Buffer.alloc(4);
  mimeLen.writeUInt32BE(mimeBuf.length, 0);
  const descLen = Buffer.alloc(4); // 描述符为空，长度为 0
  const dims = Buffer.alloc(16);
  dims.writeUInt32BE(cover.width >>> 0, 0);
  dims.writeUInt32BE(cover.height >>> 0, 4);
  dims.writeUInt32BE(cover.bitsPerPixel, 8);
  dims.writeUInt32BE(0, 12); // colors
  const dataLen = Buffer.alloc(4);
  dataLen.writeUInt32BE(cover.data.length, 0);
  return Buffer.concat([type, mimeLen, mimeBuf, descLen, dims, dataLen, cover.data]);
};

// 按 fLaC 头后 metadata block 链重排：保留原块（丢 VORBIS_COMMENT / PICTURE），
// STREAMINFO 保持第一位，新的 VORBIS_COMMENT / PICTURE 插在 audio frames 之前，末尾 audio 原样拷贝。
const buildFlac = (input, meta, cover) => {
  if (input.length < 4 || input.toString('latin1', 0, 4) !== 'fLaC') {
    throw new Error('不是有效的 FLAC 文件');
  }
  let pos = 4;
  const blocks = [];
  while (pos + 4 <= input.length) {
    const header = input.readUInt32BE(pos);
    const isLast = (header & 0x80000000) !== 0;
    const type = (header >>> 24) & 0x7f;
    const length = header & 0xffffff;
    const dataStart = pos + 4;
    const dataEnd = dataStart + length;
    if (dataEnd > input.length) break;
    blocks.push({ type, data: input.slice(dataStart, dataEnd) });
    pos = dataEnd;
    if (isLast) break;
  }
  const audio = input.slice(pos);

  const kept = blocks.filter((block) => block.type !== 4 && block.type !== 6);
  const next = kept.slice();
  next.push({ type: 4, data: buildVorbisComment(meta) });
  if (cover) next.push({ type: 6, data: buildPicture(cover) });

  const parts = [Buffer.from('fLaC', 'latin1')];
  for (let i = 0; i < next.length; i += 1) {
    const isLast = i === next.length - 1;
    const header = Buffer.alloc(4);
    let word = next[i].data.length & 0xffffff;
    word |= next[i].type << 24;
    if (isLast) word = (word | 0x80000000) >>> 0;
    header.writeUInt32BE(word >>> 0, 0);
    parts.push(header, next[i].data);
  }
  parts.push(audio);
  return Buffer.concat(parts);
};

// ---- 落盘与入口 ----

// 先写同目录临时文件再 rename 覆盖，避免写一半失败把原文件写坏；失败时清掉临时文件。
const writeFileAtomic = async (filePath, buffer) => {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
};

/**
 * 写标签入口。filePath 按后缀分派；meta 取 title/artist/album/coverUrl/lyrics；
 * coverUrl 的字节由 fetchCover(url, timeoutMs) 提供（失败返回 null/空则跳过封面）。
 */
const writeTags = async ({ filePath, meta, timeoutMs, fetchCover } = {}) => {
  if (typeof filePath !== 'string' || !filePath) throw new Error('音频文件路径无效');
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.mp3' && ext !== '.flac') {
    return { supported: false, format: ext, written: false, reason: UNSUPPORTED_REASON };
  }

  let stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch (_) {
    throw new Error('音频文件不存在');
  }
  if (!stats.isFile()) throw new Error('音频文件不存在');

  const info = meta && typeof meta === 'object' ? meta : {};

  // 封面：交给调用方在主进程取（渲染层会被 CORS 拦），取不到就跳过，不影响其它标签。
  let cover = null;
  if (typeof info.coverUrl === 'string' && info.coverUrl && typeof fetchCover === 'function') {
    try {
      const data = await fetchCover(info.coverUrl, timeoutMs);
      if (data && data.length) {
        const parsed = detectImage(data);
        if (parsed) cover = { ...parsed, data };
      }
    } catch (_) {
      cover = null;
    }
  }

  try {
    const input = await fs.promises.readFile(filePath);
    const output = ext === '.mp3' ? buildMp3(input, info, cover) : buildFlac(input, info, cover);
    await writeFileAtomic(filePath, output);
    return { supported: true, format: ext, written: true };
  } catch (err) {
    throw new Error(`写入标签失败：${err && err.message ? err.message : String(err)}`);
  }
};

module.exports = { writeTags, detectImage };
