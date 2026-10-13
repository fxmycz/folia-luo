// electron/lxSource/musicSdk/platforms/tx/utils.cjs
// QQ 音乐（tx）平台的请求封装：带 zzc 签名的搜索请求，以及对象 body 的 JSON POST。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/utils/index.js。
// 适配点：原版用 needle（json: true）自动把对象 body 序列化成 JSON；Folia 的 httpFetch 只发原始字符串，
// 故这里显式 JSON.stringify 并补上 Content-Type: application/json。

const { httpFetch } = require('../../request.cjs');
const { zzcSign } = require('./crypto.cjs');

/** 以 JSON 形式 POST 对象 body。 */
const postJson = (url, data, headers = {}) => httpFetch(url, {
  method: 'post',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(data),
}).promise;

/** 带 zzc 签名的 musicu.fcg 请求。 */
const signRequest = async (data) => {
  const sign = await zzcSign(JSON.stringify(data));
  return httpFetch(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`, {
    method: 'post',
    headers: {
      'User-Agent': 'QQMusic 14090508(android 12)',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  }).promise;
};

module.exports = { postJson, signRequest };
