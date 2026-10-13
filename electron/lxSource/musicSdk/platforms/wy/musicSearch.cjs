// electron/lxSource/musicSdk/platforms/wy/musicSearch.cjs
// 网易云（wy）单曲搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/wy/musicSearch.js，
// 保留 eapi 请求、结果归一化与重试。

const { eapiRequest } = require('./utils.cjs');
const { httpFetch } = require('../../request.cjs');
const { formatPlayTime, sizeFormate } = require('../../utils.cjs');

const DEFAULT_LIMIT = 30;

const getSinger = (singers) => {
  const arr = [];
  singers.forEach((singer) => {
    arr.push(singer.name);
  });
  return arr.join('、');
};

// 搜索结果条目 → 洛雪 music-info；音质按 maxbr 逐档回退（原版依赖 switch fallthrough）。
const handleResult = (rawList) => {
  if (!rawList) return [];
  return rawList.map((raw) => {
    const item = raw.baseInfo.simpleSongData;
    const types = [];
    const _types = {};
    let size;

    if (item.privilege.maxBrLevel == 'hires') {
      size = item.hr ? sizeFormate(item.hr.size) : null;
      types.push({ type: 'flac24bit', size });
      _types.flac24bit = { size };
    }
    switch (item.privilege.maxbr) {
      case 999000:
        size = item.sq ? sizeFormate(item.sq.size) : null;
        types.push({ type: 'flac', size });
        _types.flac = { size };
      // falls through
      case 320000:
        size = item.h ? sizeFormate(item.h.size) : null;
        types.push({ type: '320k', size });
        _types['320k'] = { size };
      // falls through
      case 192000:
      case 128000:
        size = item.l ? sizeFormate(item.l.size) : null;
        types.push({ type: '128k', size });
        _types['128k'] = { size };
      // falls through
      default:
        break;
    }

    types.reverse();

    return {
      singer: getSinger(item.ar),
      name: item.name,
      albumName: item.al.name,
      albumId: item.al.id,
      source: 'wy',
      interval: formatPlayTime(item.dt / 1000),
      songmid: item.id,
      img: item.al.picUrl,
      lrc: null,
      types,
      _types,
      typeUrl: {},
    };
  });
};

module.exports = {
  DEFAULT_LIMIT,
  handleResult,
  /** 搜索联想词：网易云官方的搜索建议接口。 */
  tipSearch(str) {
    return httpFetch(`https://music.163.com/api/search/suggest/keyword?s=${encodeURIComponent(str)}`, {
      headers: { Referer: 'https://music.163.com/' },
    }).promise.then(({ body }) => {
      const all = body?.result?.allMatch;
      if (!Array.isArray(all)) return [];
      return all.map(item => item?.keyword).filter(Boolean);
    });
  },
  musicSearch(str, page, limit) {
    return eapiRequest('/api/search/song/list/page', {
      keyword: str,
      needCorrect: '1',
      channel: 'typing',
      offset: limit * (page - 1),
      scene: 'normal',
      total: page == 1,
      limit,
    }).promise.then(({ body }) => body);
  },
  /** 搜索单曲。page 从 1 起。 */
  search(str, page = 1, limit = DEFAULT_LIMIT, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'));
    return this.musicSearch(str, page, limit).then((result) => {
      if (!result || result.code !== 200) return this.search(str, page, limit, retryNum);
      const list = handleResult(result.data.resources || []);
      if (list == null) return this.search(str, page, limit, retryNum);

      const total = result.data.totalCount || 0;
      return {
        list,
        allPage: Math.ceil(total / limit),
        limit,
        total,
        page,
        source: 'wy',
      };
    });
  },
  _internal: { handleResult, getSinger },
};
