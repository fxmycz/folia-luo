// electron/lxSource/musicSdk/platforms/kw/musicSearch.cjs
// 酷我（kw）单曲搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kw/musicSearch.js，
// 逻辑保持一致；`this.limit/total/page` 这些可变实例状态收敛成局部变量。

const { httpFetch } = require('../../request.cjs');
const { formatPlayTime, decodeName } = require('../../utils.cjs');
const { formatSinger } = require('./util.cjs');

const DEFAULT_LIMIT = 30;

const regExps = {
  mInfo: /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/,
};

// 把搜索接口返回的一条记录转成洛雪 music-info；N_MINFO 缺失时原版返回 null 触发重试。
const handleResult = (rawData) => {
  const result = [];
  if (!rawData) return result;
  for (const info of rawData) {
    const songId = String(info.MUSICRID ?? '').replace('MUSIC_', '');
    if (!info.N_MINFO) return null;

    const types = [];
    const _types = {};
    info.N_MINFO.split(';').forEach((entry) => {
      const matched = entry.match(regExps.mInfo);
      if (!matched) return;
      const size = matched[4].toLocaleUpperCase();
      switch (matched[2]) {
        case '4000': types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }; break;
        case '2000': types.push({ type: 'flac', size }); _types.flac = { size }; break;
        case '320': types.push({ type: '320k', size }); _types['320k'] = { size }; break;
        case '128': types.push({ type: '128k', size }); _types['128k'] = { size }; break;
        default: break;
      }
    });
    types.reverse();

    const interval = parseInt(info.DURATION, 10);
    result.push({
      name: decodeName(info.SONGNAME),
      singer: formatSinger(decodeName(info.ARTIST)),
      source: 'kw',
      songmid: songId,
      albumId: decodeName(info.ALBUMID || ''),
      interval: Number.isNaN(interval) ? 0 : formatPlayTime(interval),
      albumName: info.ALBUM ? decodeName(info.ALBUM) : '',
      lrc: null,
      img: null,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    });
  }
  return result;
};

const requestSearch = (str, page, limit) => httpFetch(
  'http://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent(str)
  + `&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1`
  + '&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8'
  + '&rformat=json&vermerge=1&mobi=1&issubtitle=1',
).promise;

// 搜索联想：酷我没有公开的联想接口，改用搜索接口的首批命中歌名作为补全候选。
const requestTip = (str) => httpFetch(
  'http://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent(str)
  + '&pn=0&rn=10&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1'
  + '&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8'
  + '&rformat=json&vermerge=1&mobi=1&issubtitle=1',
).promise;

module.exports = {
  DEFAULT_LIMIT,
  /** 搜索联想词。 */
  tipSearch(str) {
    return requestTip(str).then(({ body }) => {
      const list = body?.abslist;
      if (!Array.isArray(list)) return [];
      return list.map(item => decodeName(item?.SONGNAME)).filter(Boolean);
    });
  },
  /** 搜索单曲。page 从 1 起。 */
  search(str, page = 1, limit = DEFAULT_LIMIT, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'));
    return requestSearch(str, page, limit).then(({ body: result }) => {
      if (!result || (result.TOTAL !== '0' && result.SHOW === '0')) return this.search(str, page, limit, ++retryNum);
      const list = handleResult(result.abslist);
      if (list == null) return this.search(str, page, limit, ++retryNum);

      const total = parseInt(result.TOTAL, 10);
      return {
        list,
        allPage: Math.ceil(total / limit),
        total,
        limit,
        page,
        source: 'kw',
      };
    });
  },
  _internal: { handleResult },
};
