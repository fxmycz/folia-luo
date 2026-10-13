// electron/lxSource/musicSdk/platforms/kw/util.cjs
// 酷我（kw）平台专用工具：榜单接口的 AES-128-ECB 加解密与请求签名。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kw/util.js，
// 只保留 Phase 2 需要用到的部分（歌词解码、lrcTools 走用户脚本，不在此移植）。

const { createCipheriv, createDecipheriv } = require('node:crypto');
const { toMD5 } = require('../../utils.cjs');

const createAesEncrypt = (buffer, mode, key, iv) => {
  const cipher = createCipheriv(mode, key, iv);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
};

const createAesDecrypt = (buffer, mode, key, iv) => {
  const decipher = createDecipheriv(mode, key, iv);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
};

const wbdCrypto = {
  aesMode: 'aes-128-ecb',
  aesKey: Buffer.from([112, 87, 39, 61, 199, 250, 41, 191, 57, 68, 45, 114, 221, 94, 140, 228], 'binary'),
  aesIv: '',
  appId: 'y67sprxhhpws',
  decodeData(base64Result) {
    const data = Buffer.from(decodeURIComponent(base64Result), 'base64');
    return JSON.parse(createAesDecrypt(data, this.aesMode, this.aesKey, this.aesIv).toString());
  },
  createSign(data, time) {
    return toMD5(`${this.appId}${data}${time}`).toUpperCase();
  },
  buildParam(jsonData) {
    const data = Buffer.from(JSON.stringify(jsonData));
    const time = Date.now();
    const encodeData = createAesEncrypt(data, this.aesMode, this.aesKey, this.aesIv).toString('base64');
    const sign = this.createSign(encodeData, time);
    return `data=${encodeURIComponent(encodeData)}&time=${time}&appId=${this.appId}&sign=${sign}`;
  },
};

/** 酷我把多歌手用 `&` 连接，统一换成「、」好让归一化按分隔符拆。 */
const formatSinger = (rawData) => String(rawData ?? '').replace(/&/g, '、');

/** 酷我搜索接口返回的是单引号包裹的类 JSON，先转成标准 JSON。 */
const objStr2JSON = (str) => JSON.parse(str.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"'));

module.exports = { wbdCrypto, formatSinger, objStr2JSON };
