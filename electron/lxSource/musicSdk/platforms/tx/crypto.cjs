// electron/lxSource/musicSdk/platforms/tx/crypto.cjs
// QQ 音乐（tx）搜索接口的 zzc 签名。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/utils/crypto.js，
// 原版即基于 node:crypto，此处仅把 ESM 改为 CommonJS。

const crypto = require('node:crypto');

const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

const hashSHA1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

const pickHashByIdx = (hash, indexes) => indexes.map(idx => hash[idx]).join('');

const base64Encode = (data) => Buffer.from(data)
  .toString('base64')
  .replace(/[\\/+=]/g, '');

const zzcSign = (text) => {
  const hash = hashSHA1(text);
  const part1 = pickHashByIdx(hash, PART_1_INDEXES);
  const part2 = pickHashByIdx(hash, PART_2_INDEXES);
  const part3 = SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  const b64Part = base64Encode(part3).replace(/[\\/+=]/g, '');
  return `zzc${part1}${b64Part}${part2}`.toLowerCase();
};

module.exports = { zzcSign };
