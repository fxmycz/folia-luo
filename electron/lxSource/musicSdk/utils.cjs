// electron/lxSource/musicSdk/utils.cjs
// 洛雪 musicSdk 各平台共用的纯工具函数。
// 移植自 lx-music-desktop（Apache-2.0）：src/renderer/utils/index.ts 与 src/common/utils/common.ts，
// 去掉依赖 window / DOM 的实现（HTML 实体改用正则解），其余逻辑保持一致。

const crypto = require('node:crypto');

const numFix = (n) => (n < 10 ? `0${n}` : String(n));

/** 秒数 → "mm:ss"；0 秒时返回 "--/--"（与洛雪一致，音源脚本按此字符串匹配）。 */
const formatPlayTime = (time) => {
  const m = Math.trunc(time / 60);
  const s = Math.trunc(time % 60);
  return m === 0 && s === 0 ? '--/--' : `${numFix(m)}:${numFix(s)}`;
};

/** 播放次数 → "1.2万" / "3亿"。 */
const formatPlayCount = (num) => {
  if (num > 100000000) return `${Math.trunc(num / 10000000) / 10}亿`;
  if (num > 10000) return `${Math.trunc(num / 1000) / 10}万`;
  return String(num);
};

/** 字节数 → "3.20 MiB"。 */
const sizeFormate = (size) => {
  if (!size) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const number = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`;
};

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 解开平台返回文本里的 HTML 实体（洛雪用 DOMParser，主进程里用正则替代）。 */
const decodeName = (str = '') => {
  if (!str) return '';
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
};

/** 歌手名拼接：数组按 nameKey 取名后连接；返回前统一解实体。 */
const formatSingerName = (singers, nameKey = 'name', join = '、') => {
  if (Array.isArray(singers)) {
    const names = [];
    singers.forEach((item) => {
      const name = item?.[nameKey];
      if (name) names.push(name);
    });
    return decodeName(names.join(join));
  }
  return decodeName(String(singers ?? ''));
};

const toMD5 = (str) => crypto.createHash('md5').update(str).digest('hex');

/** 酷狗封面链接是 `http://imge.kugou.com/stdmusic/{size}/...` 模板，把 `{size}` 换成实际尺寸。 */
const formatKugouCover = (url) => {
  const value = typeof url === 'string' ? url.trim() : '';
  return value ? value.replace('{size}', '400') : null;
};

/** 酷狗榜单/歌单曲目的封面藏在 `trans_param.union_cover`（接口有时给对象、有时给 JSON 字符串）。 */
const kugouCoverFromTransParam = (transParam) => {
  if (!transParam) return null;
  let value = transParam;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? formatKugouCover(value.union_cover) : null;
};

// 洛雪 kw/mg 的榜单接口都用分钟级的 mm:ss 字符串表示时长，这里统一抽出来给归一化用。
const parseLxIntervalSeconds = (interval) => {
  const match = /^(\d+):(\d{1,2})$/.exec(String(interval ?? '').trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
};

module.exports = { formatPlayTime, formatPlayCount, sizeFormate, decodeName, formatSingerName, toMD5, parseLxIntervalSeconds, formatKugouCover, kugouCoverFromTransParam };
