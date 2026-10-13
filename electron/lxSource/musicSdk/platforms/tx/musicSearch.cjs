// electron/lxSource/musicSdk/platforms/tx/musicSearch.cjs
// QQ 音乐（tx）单曲搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/musicSearch.js，
// 保留 zzc 签名、searchid 生成、结果归一化与重试。

const { signRequest } = require('./utils.cjs');
const { httpFetch } = require('../../request.cjs');
const { formatPlayTime, sizeFormate, formatSingerName } = require('../../utils.cjs');

const DEFAULT_LIMIT = 50;

// 把搜索结果的一条记录转成洛雪 music-info；缺 media_mid 的条目跳过。
const handleResult = (rawList) => {
  if (!rawList || !Array.isArray(rawList)) return [];
  const list = [];
  rawList.forEach((item) => {
    if (!item.file?.media_mid) return;

    const types = [];
    const _types = {};
    const file = item.file;
    if (file.size_128mp3 != 0) {
      const size = sizeFormate(file.size_128mp3);
      types.push({ type: '128k', size });
      _types['128k'] = { size };
    }
    if (file.size_320mp3 !== 0) {
      const size = sizeFormate(file.size_320mp3);
      types.push({ type: '320k', size });
      _types['320k'] = { size };
    }
    if (file.size_flac !== 0) {
      const size = sizeFormate(file.size_flac);
      types.push({ type: 'flac', size });
      _types.flac = { size };
    }
    if (file.size_hires !== 0) {
      const size = sizeFormate(file.size_hires);
      types.push({ type: 'flac24bit', size });
      _types.flac24bit = { size };
    }

    let albumId = '';
    let albumName = '';
    if (item.album) {
      albumName = item.album.name;
      albumId = item.album.mid;
    }
    list.push({
      singer: formatSingerName(item.singer, 'name'),
      name: item.title,
      albumName,
      albumId,
      source: 'tx',
      interval: item.interval ? formatPlayTime(item.interval) : null,
      songId: item.id,
      albumMid: item.album?.mid ?? '',
      strMediaMid: item.file.media_mid,
      songmid: item.mid,
      img: (albumId === '' || albumId === '空')
        ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : ''
        : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
      types,
      _types,
      typeUrl: {},
    });
  });
  return list;
};

/**
 * PC 客户端版 searchid：32 位大写十六进制 GUID + 5 位补零随机数 = 37 字符。
 * 对应 QQ 音乐 PC 端 searchid 形状（服务端只需要唯一的会话 ID，形状一致即可）。
 */
const getSearchId = () => {
  let guid = '';
  for (let i = 0; i < 32; i++) guid += Math.floor(Math.random() * 16).toString(16);
  return guid.toUpperCase() + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
};

/** smartbox 返回的歌名偶尔带 `<em>` 高亮标签，去掉后再用。 */
const stripMarkup = (value) => String(value ?? '').replace(/<[^>]+>/g, '').trim();

module.exports = {
  DEFAULT_LIMIT,
  getSearchId,
  /** 搜索联想词：QQ 音乐官方的 smartbox 接口，取歌曲候选名。 */
  tipSearch(str) {
    return httpFetch(
      'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&inCharset=utf-8&outCharset=utf-8'
      + `&key=${encodeURIComponent(str)}`,
    ).promise.then(({ body }) => {
      const itemlist = body?.data?.song?.itemlist;
      if (!Array.isArray(itemlist)) return [];
      return itemlist.map(item => stripMarkup(item?.name)).filter(Boolean);
    });
  },
  musicSearch(str, page, limit, retryNum = 0) {
    if (retryNum > 5) return Promise.reject(new Error('搜索失败'));
    return signRequest({
      comm: {
        _channelid: '0',
        _os_version: '6.2.9200-2',
        ct: '19',
        cv: '2151',
        guid: '1F70E520B2EAA7D25E11760783C53CA9',
        patch: '118',
        psrf_access_token_expiresAt: 0,
        psrf_qqaccess_token: '',
        psrf_qqopenid: '',
        psrf_qqunionid: '',
        tmeAppID: 'qqmusic',
        tmeLoginType: 0,
        uin: '0',
        wid: '7223299733393904640',
      },
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: limit,
          page_num: page,
          query: str,
          remoteplace: 'txt.newclient.top',
          search_type: 0,
          searchid: getSearchId(),
        },
      },
    }).then(({ body }) => {
      const req = body?.['music.search.SearchCgiService'] ?? body?.req;
      if (!req || body.code != 0 || req.code != 0) return this.musicSearch(str, page, limit, ++retryNum);
      return req.data;
    });
  },
  /** 搜索单曲。page 从 1 起。 */
  search(str, page = 1, limit = DEFAULT_LIMIT) {
    return this.musicSearch(str, page, limit).then(({ body, meta }) => {
      const list = handleResult(body.song.list);
      const total = meta.sum;
      return {
        list,
        allPage: Math.ceil(total / limit),
        limit,
        total,
        page,
        source: 'tx',
      };
    });
  },
  _internal: { handleResult, getSearchId },
};
