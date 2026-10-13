// electron/lxSource/musicSdk/platforms/mg/musicSearch.cjs
// 咪咕（mg）单曲搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/mg/musicSearch.js，
// 保留签名算法、结果归一化与重试；去掉与本版无关的旧版接口注释代码。

const { httpFetch } = require('../../request.cjs');
const { sizeFormate, formatPlayTime, formatSingerName, toMD5 } = require('../../utils.cjs');

const DEFAULT_LIMIT = 20;

/** 咪咕搜索接口要求的签名头。 */
const createSignature = (time, str) => {
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73';
  const sign = toMD5(`${str}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`);
  return { sign, deviceId };
};

const requestSearch = (str, page, limit) => {
  const time = Date.now().toString();
  const signData = createSignature(time, str);
  return httpFetch(
    'https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1'
    + '&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1'
    + '%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D'
    + `&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0&sid=USS`,
    {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId: signData.deviceId,
        timestamp: time,
        sign: signData.sign,
        channel: '0146921',
        'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      },
    },
  ).promise.then(({ body }) => body);
};

// songResultData.resultList 是「按关键词分组的二维数组」，逐条展开并去重。
const filterData = (rawData) => {
  const list = [];
  const ids = new Set();
  rawData.forEach((group) => {
    group.forEach((data) => {
      if (!data.songId || !data.copyrightId || ids.has(data.copyrightId)) return;
      ids.add(data.copyrightId);

      const types = [];
      const _types = {};
      data.audioFormats?.forEach((type) => {
        const size = sizeFormate(type.asize ?? type.isize);
        switch (type.formatType) {
          case 'PQ': types.push({ type: '128k', size }); _types['128k'] = { size }; break;
          case 'HQ': types.push({ type: '320k', size }); _types['320k'] = { size }; break;
          case 'SQ': types.push({ type: 'flac', size }); _types.flac = { size }; break;
          case 'ZQ24': types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }; break;
          default: break;
        }
      });

      let img = data.img3 || data.img2 || data.img1 || null;
      if (img && !/https?:/.test(img)) img = 'http://d.musicapp.migu.cn' + img;

      list.push({
        singer: formatSingerName(data.singerList),
        name: data.name,
        albumName: data.album,
        albumId: data.albumId,
        songmid: data.songId,
        copyrightId: data.copyrightId,
        source: 'mg',
        interval: formatPlayTime(data.duration),
        img,
        lrc: null,
        lrcUrl: data.lrcUrl,
        mrcUrl: data.mrcurl,
        trcUrl: data.trcUrl,
        types,
        _types,
        typeUrl: {},
      });
    });
  });
  return list;
};

module.exports = {
  DEFAULT_LIMIT,
  createSignature,
  /** 搜索单曲。page 从 1 起。 */
  search(str, page = 1, limit = DEFAULT_LIMIT, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'));
    return requestSearch(str, page, limit).then((result) => {
      if (!result || result.code !== '000000') {
        return Promise.reject(new Error(result ? result.info : '搜索失败'));
      }
      const songResultData = result.songResultData || { resultList: [], totalCount: 0 };
      const list = filterData(songResultData.resultList);
      const total = parseInt(songResultData.totalCount, 10);
      return {
        list,
        allPage: Math.ceil(total / limit),
        limit,
        total,
        page,
        source: 'mg',
      };
    });
  },
  _internal: { filterData, createSignature },
};
