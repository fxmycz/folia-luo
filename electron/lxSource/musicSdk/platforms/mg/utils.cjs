// electron/lxSource/musicSdk/platforms/mg/utils.cjs
// 咪咕（mg）平台的请求封装：把 httpFetch 的响应解包成 body.data，并带重试。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/mg/utils/index.js。

const { httpFetch } = require('../../request.cjs');

/**
 * 发起咪咕请求并解包。响应码非 200 或业务码非 '000000' 时按次数重试。
 * @param {string} url
 * @param {object} [options]
 * @param {number} [retryNum]
 */
const createHttpFetch = async (url, options, retryNum = 0) => {
  if (retryNum > 2) throw new Error('try max num');
  let result;
  try {
    result = await httpFetch(url, options).promise;
  } catch {
    return createHttpFetch(url, options, ++retryNum);
  }
  const code = result.body?.code !== undefined
    ? result.body.code
    : result.body?.returnCode !== undefined
      ? result.body.returnCode
      : result.body?.code;
  if (result.statusCode !== 200 || code !== '000000') {
    return createHttpFetch(url, options, ++retryNum);
  }
  return result.body.data ?? result.body;
};

module.exports = { createHttpFetch };
