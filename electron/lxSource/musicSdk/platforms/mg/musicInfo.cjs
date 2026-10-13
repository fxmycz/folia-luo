// electron/lxSource/musicSdk/platforms/mg/musicInfo.cjs
// 咪咕（mg）歌曲记录归一化 + 歌词所需的资源信息查询。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/mg/musicInfo.js，
// 保留纯解析函数，并补上歌词模块依赖的 getMusicInfo（批量 getMusicInfos Phase 2 用不到）。

const { sizeFormate, formatPlayTime, formatSingerName } = require('../../utils.cjs');
const { httpFetch } = require('../../request.cjs');

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

const RESOURCE_INFO_URL = 'https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2';

/**
 * 按歌曲 id 拉取资源信息，只取歌词所需的最小字段（songId / lrcUrl / mrcUrl / trcUrl）。
 * 洛雪用自建的 createHttpFetch（返回体形状不同），这里改用项目 httpFetch 的 form 选项，
 * 自行从 `body.resource` 列表里取首个结果，缺失字段给 null。
 */
const getMusicInfo = async (id) => {
  const { body } = await httpFetch(RESOURCE_INFO_URL, {
    method: 'POST',
    form: { resourceId: id },
  }).promise;
  const item = body?.resource?.[0];
  if (!item) {
    return { songId: null, lrcUrl: null, mrcUrl: null, trcUrl: null };
  }
  return {
    songId: item.songId ?? null,
    lrcUrl: item.lrcUrl ?? null,
    mrcUrl: item.mrcUrl ?? null,
    trcUrl: item.trcUrl ?? null,
  };
};

module.exports = { filterMusicInfoList, filterMusicInfoListV5, getMusicInfo };
