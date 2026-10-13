// electron/lxSource/musicSdk/platforms/kg/musicSearch.cjs
// 酷狗（kg）单曲搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kg/musicSearch.js，
// 逻辑保持一致；`this.limit/total/page` 这些可变实例状态收敛成局部变量。

const { httpFetch } = require('../../request.cjs');
const { decodeName, formatPlayTime, sizeFormate, formatSingerName, formatKugouCover } = require('../../utils.cjs');

const DEFAULT_LIMIT = 30;

// 把搜索接口返回的一条记录转成洛雪 music-info。`Grp` 子项自身不带封面，用主记录的图片兜底。
const filterData = (rawData, fallbackImg = null) => {
  const types = [];
  const _types = {};
  if (rawData.FileSize !== 0) {
    const size = sizeFormate(rawData.FileSize);
    types.push({ type: '128k', size, hash: rawData.FileHash });
    _types['128k'] = { size, hash: rawData.FileHash };
  }
  if (rawData.HQFileSize !== 0) {
    const size = sizeFormate(rawData.HQFileSize);
    types.push({ type: '320k', size, hash: rawData.HQFileHash });
    _types['320k'] = { size, hash: rawData.HQFileHash };
  }
  if (rawData.SQFileSize !== 0) {
    const size = sizeFormate(rawData.SQFileSize);
    types.push({ type: 'flac', size, hash: rawData.SQFileHash });
    _types.flac = { size, hash: rawData.SQFileHash };
  }
  if (rawData.ResFileSize !== 0) {
    const size = sizeFormate(rawData.ResFileSize);
    types.push({ type: 'flac24bit', size, hash: rawData.ResFileHash });
    _types.flac24bit = { size, hash: rawData.ResFileHash };
  }
  return {
    singer: decodeName(formatSingerName(rawData.Singers, 'name')),
    name: decodeName(`${rawData.OriSongName}${rawData.Suffix ? ` ${rawData.Suffix}` : ''}`),
    albumName: decodeName(rawData.AlbumName),
    albumId: rawData.AlbumID,
    songmid: rawData.Audioid,
    albumAudioId: rawData.MixSongID,
    source: 'kg',
    interval: formatPlayTime(rawData.Duration),
    _interval: rawData.Duration,
    img: formatKugouCover(rawData.Image) ?? fallbackImg,
    lrc: null,
    otherSource: null,
    hash: rawData.FileHash,
    types,
    _types,
    typeUrl: {},
  };
};

// 结果按「主记录 + Grp 子项」展开并按 Audioid+FileHash 去重。
const handleResult = (rawData) => {
  const ids = new Set();
  const list = [];
  rawData.forEach((item) => {
    const key = item.Audioid + item.FileHash;
    if (ids.has(key)) return;
    ids.add(key);
    list.push(filterData(item));
    for (const childItem of item.Grp) {
      const childKey = childItem.Audioid + childItem.FileHash;
      if (ids.has(childKey)) continue;
      ids.add(childKey);
      list.push(filterData(childItem, formatKugouCover(item.Image)));
    }
  });
  return list;
};

const requestSearch = (str, page, limit) => httpFetch(
  'http://songsearch.kugou.com/song_search_v2?platform=AndroidFilter&iscorrection=1'
  + `&keyword=${encodeURIComponent(str)}&hifiquality=0&pagesize=${limit}&PrivilegeFilter=0&page=${page}`,
).promise;

// 搜索联想：酷狗官方的 searchtip 接口，返回按关键词匹配的提示词。
const requestTip = (str) => httpFetch(
  'http://searchtip.kugou.com/getSearchTip?MusicTipCount=10&KugouTipCount=0&radiotip=0&mvtip=0&albumtip=0&filtrate=0'
  + `&keyword=${encodeURIComponent(str)}`,
).promise;

module.exports = {
  DEFAULT_LIMIT,
  musicSearch(str, page, limit) {
    return requestSearch(str, page, limit).then(({ body }) => body);
  },
  /** 搜索联想词。失败时由上层回退到本地搜索历史。 */
  tipSearch(str) {
    return requestTip(str).then(({ body }) => {
      const groups = body?.data;
      if (!Array.isArray(groups)) return [];
      const list = [];
      for (const group of groups) {
        for (const item of group?.RecordDatas ?? []) {
          if (item?.HintInfo) list.push(String(item.HintInfo));
        }
      }
      return list;
    });
  },
  /** 搜索单曲。page 从 1 起。 */
  search(str, page = 1, limit = DEFAULT_LIMIT, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'));
    return this.musicSearch(str, page, limit).then((result) => {
      if (!result || result.error_code !== 0) return this.search(str, page, limit, retryNum);
      const list = handleResult(result.data.lists);
      if (list == null) return this.search(str, page, limit, retryNum);

      const total = result.data.total;
      return {
        list,
        allPage: Math.ceil(total / limit),
        limit,
        total,
        page,
        source: 'kg',
      };
    });
  },
  _internal: { filterData, handleResult },
};
