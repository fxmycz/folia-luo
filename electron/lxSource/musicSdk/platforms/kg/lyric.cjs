// electron/lxSource/musicSdk/platforms/kg/lyric.cjs
// 酷狗（kg）歌词获取。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kg/lyric.js，
// 把 `{ promise, cancelHttp }` 的调用契约展平成直接返回 Promise。

const { httpFetch } = require('../../request.cjs');
const { decodeKrc } = require('./decodeKrc.cjs');

const headers = {
  'KG-RC': 1,
  'KG-THash': 'expand_search_manager.cpp:852736169:451',
  'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
};

// "mm:ss" → 秒。（酷狗接口需要 timelength 为秒数）
const getIntv = (interval) => {
  if (!interval) return 0;
  const intvArr = interval.split(':');
  let intv = 0;
  let unit = 1;
  while (intvArr.length) {
    intv += (intvArr.pop()) * unit;
    unit *= 60;
  }
  return parseInt(intv);
};

// 搜索歌词，拿到可供下载的 id / accessKey / fmt。
const searchLyric = (name, hash, time, tryNum = 0) => httpFetch(
  `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(name)}&hash=${hash}&timelength=${time}&lrctxt=1`,
  { headers },
).promise.then(({ body, statusCode }) => {
  if (statusCode !== 200) {
    if (tryNum > 5) return Promise.reject(new Error('歌词获取失败'));
    return searchLyric(name, hash, time, ++tryNum);
  }
  if (body.candidates.length) {
    const info = body.candidates[0];
    return { id: info.id, accessKey: info.accesskey, fmt: (info.krctype == 1 && info.contenttype != 1) ? 'krc' : 'lrc' };
  }
  return null;
});

// 下载歌词并解码。洛雪原代码在 statusCode!==200 时误调用 `this.getLyric(...)`，
// 这里修正为递归调用自身 getLyricDownload(id, accessKey, fmt, tryNum+1)，避免无限递归与参数错乱。
const getLyricDownload = (id, accessKey, fmt, tryNum = 0) => httpFetch(
  `http://lyrics.kugou.com/download?ver=1&client=pc&id=${id}&accesskey=${accessKey}&fmt=${fmt}&charset=utf8`,
  { headers },
).promise.then(({ body, statusCode }) => {
  if (statusCode !== 200) {
    if (tryNum > 5) return Promise.reject(new Error('歌词获取失败'));
    return getLyricDownload(id, accessKey, fmt, ++tryNum);
  }

  switch (body.fmt) {
    case 'krc':
      return decodeKrc(body.content);
    case 'lrc':
      return {
        lyric: Buffer.from(body.content, 'base64').toString('utf-8'),
        tlyric: '',
        rlyric: '',
        lxlyric: '',
      };
    default:
      return Promise.reject(new Error(`未知歌词格式: ${body.fmt}`));
  }
});

const getLyric = (songInfo) => searchLyric(
  songInfo.name,
  songInfo.hash,
  songInfo._interval || getIntv(songInfo.interval),
).then((result) => {
  if (!result) return Promise.reject(new Error('Get lyric failed'));

  return getLyricDownload(result.id, result.accessKey, result.fmt);
});

module.exports = { getLyric };
