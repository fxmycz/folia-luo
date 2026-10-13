// electron/lxSource/musicSdk/platforms/wy/utils.cjs
// 网易云（wy）平台的请求封装：eapi 批量请求。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/wy/utils/index.js。

const { httpFetch } = require('../../request.cjs');
const { eapi } = require('./crypto.cjs');

/** 发起一次 eapi 批量请求（form 为加密参数）。 */
const eapiRequest = (url, data) => httpFetch('http://interface.music.163.com/eapi/batch', {
  method: 'post',
  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
    origin: 'https://music.163.com',
  },
  form: eapi(url, data),
});

module.exports = { eapiRequest };
