// electron/lxSource/lxPlaylistCodec.cjs
// 洛雪音乐（lx-music-desktop）列表文件 `.lxmc` 的编解码。
// 关键事实：洛雪导出的 `.lxmc` 内容是 **gzip 压缩过的 JSON**（其主进程 saveLxConfigFile /
// readLxConfigFile 负责压缩与解压，壳外看就是一段标准 gzip 流，无自定义前缀）。
// 因此这里导出写成 gzip（能被洛雪读回），导入则两种都接受：gzip 压缩 JSON 与未压缩纯 JSON。
// 独立成模块，便于单测与复用；除 zlib 外零依赖。
const zlib = require('node:zlib');

// gzip 魔数 1F 8B。
const GZIP_MAGIC = 0x1f8b;

/** 判断缓冲区是否是 gzip 流（按魔数，不看扩展名）。 */
const isGzip = (buffer) => buffer.length >= 2 && buffer.readUInt16BE(0) === GZIP_MAGIC;

/** 去掉开头的 UTF-8 BOM（部分编辑器另存会写入，会让 JSON.parse 报错）。 */
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** 文本 → 洛雪 `.lxmc` 文件内容（gzip 压缩，与洛雪导出的格式一致）。 */
const encodeLxPlaylistFile = (text) => zlib.gzipSync(Buffer.from(String(text ?? ''), 'utf8'));

/** 文件内容 → 文本：gzip 先解压、纯 JSON 文本原样返回；统一剥掉 BOM。 */
const decodeLxPlaylistFile = (buffer) => {
  const raw = isGzip(buffer) ? zlib.gunzipSync(buffer) : buffer;
  return stripBom(raw.toString('utf8'));
};

module.exports = { encodeLxPlaylistFile, decodeLxPlaylistFile, isGzip };
