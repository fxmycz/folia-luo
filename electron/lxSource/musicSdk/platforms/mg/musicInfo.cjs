// electron/lxSource/musicSdk/platforms/mg/musicInfo.cjs
// 咪咕（mg）歌曲记录归一化：榜单/歌单/搜索三处共用。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/mg/musicInfo.js，
// 只保留纯解析函数（getMusicInfos 依赖的 POST 批量接口 Phase 2 用不到）。

const { sizeFormate, formatPlayTime, formatSingerName } = require('../../utils.cjs');

// 把咪咕的 formatType 映射成洛雪音质标识。
const pushFormat = (types, _types, type, size) => {
  switch (type.formatType) {
    case 'PQ': types.push({ type: '128k', size }); _types['128k'] = { size }; break;
    case 'HQ': types.push({ type: '320k', size }); _types['320k'] = { size }; break;
    case 'SQ': types.push({ type: 'flac', size }); _types.flac = { size }; break;
    case 'ZQ':
    case 'ZQ24': types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }; break;
    default: break;
  }
};

/** 榜单接口（newRateFormats + length 字符串）。 */
const filterMusicInfoList = (rawList) => {
  const ids = new Set();
  const list = [];
  rawList.forEach((item) => {
    if (!item.songId || ids.has(item.songId)) return;
    ids.add(item.songId);
    const types = [];
    const _types = {};
    item.newRateFormats?.forEach((type) => {
      pushFormat(types, _types, type, sizeFormate(type.size ?? type.androidSize));
    });

    const intervalTest = /(\d\d:\d\d)$/.test(item.length ?? '');
    list.push({
      singer: formatSingerName(item.artists, 'name'),
      name: item.songName,
      albumName: item.album,
      albumId: item.albumId,
      songmid: item.songId,
      copyrightId: item.copyrightId,
      source: 'mg',
      interval: intervalTest ? RegExp.$1 : null,
      img: item.albumImgs?.length ? item.albumImgs[0].img : null,
      lrc: null,
      lrcUrl: item.lrcUrl,
      mrcUrl: item.mrcUrl,
      trcUrl: item.trcUrl,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    });
  });
  return list;
};

/** V5 接口（audioFormats + duration 秒数），歌单详情用。 */
const filterMusicInfoListV5 = (rawList) => {
  const ids = new Set();
  const list = [];
  rawList.forEach((item) => {
    if (!item.songId || ids.has(item.songId)) return;
    ids.add(item.songId);
    const types = [];
    const _types = {};
    item.audioFormats?.forEach((type) => {
      pushFormat(types, _types, type, sizeFormate(type.size ?? type.androidSize));
    });

    list.push({
      singer: formatSingerName(item.singerList, 'name'),
      name: item.songName,
      albumName: item.album,
      albumId: item.albumId,
      songmid: item.songId,
      copyrightId: item.copyrightId,
      source: 'mg',
      interval: formatPlayTime(item.duration),
      img: item.img3 || item.img2 || item.img1 || null,
      lrc: null,
      lrcUrl: item.lrcUrl,
      mrcUrl: item.mrcUrl,
      trcUrl: item.trcUrl,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    });
  });
  return list;
};

module.exports = { filterMusicInfoList, filterMusicInfoListV5 };
