// electron/lxSource/musicSdk/platforms/tx/songList.cjs
// QQ 音乐（tx）歌单：歌单详情曲目 + 歌单搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/songList.js，
// 只保留 Phase 2 用得到的部分：详情曲目（getListDetail）与歌单搜索（search）。
// 原版的「歌单广场」分页（getList / getTags / getRecommendList）与分享链重定向解析本版不移植；
// Folia 的歌单入口来自搜索（返回纯数字歌单 id）。

const { httpFetch } = require('../../request.cjs');
const { postJson } = require('./utils.cjs');
const { decodeName, formatPlayTime, sizeFormate, formatPlayCount, formatSingerName } = require('../../utils.cjs');

const LIMIT_SONG = 100000;
const DEFAULT_LIMIT = 100;

const regExps = {
  // https://y.qq.com/n/yqq/playlist/7217720898.html
  // https://i.y.qq.com/n2/m/share/details/taoge.html?...&id=7217720898&...
  listDetailLink: /\/playlist\/(\d+)/,
  listDetailLink2: /id=(\d+)/,
};

const getListDetailUrl = (id) => `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`;

// 把用户可能传入的歌单链接收敛成纯数字的歌单 id。
const resolvePlaylistId = (id) => {
  const str = String(id);
  const result = regExps.listDetailLink.exec(str) ?? regExps.listDetailLink2.exec(str);
  return result ? result[1] : str;
};

// 歌单条目 → 洛雪 music-info。
const filterListDetail = (rawList) => rawList.map((item) => {
  const types = [];
  const _types = {};
  if (item.file.size_128mp3 !== 0) {
    const size = sizeFormate(item.file.size_128mp3);
    types.push({ type: '128k', size });
    _types['128k'] = { size };
  }
  if (item.file.size_320mp3 !== 0) {
    const size = sizeFormate(item.file.size_320mp3);
    types.push({ type: '320k', size });
    _types['320k'] = { size };
  }
  if (item.file.size_flac !== 0) {
    const size = sizeFormate(item.file.size_flac);
    types.push({ type: 'flac', size });
    _types.flac = { size };
  }
  if (item.file.size_hires !== 0) {
    const size = sizeFormate(item.file.size_hires);
    types.push({ type: 'flac24bit', size });
    _types.flac24bit = { size };
  }
  return {
    singer: formatSingerName(item.singer, 'name'),
    name: item.title,
    albumName: item.album.name,
    albumId: item.album.mid,
    source: 'tx',
    interval: formatPlayTime(item.interval),
    songId: item.id,
    albumMid: item.album.mid,
    strMediaMid: item.file.media_mid,
    songmid: item.mid,
    img: (item.album.name === '' || item.album.name === '空')
      ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : ''
      : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`,
    lrc: null,
    otherSource: null,
    types,
    _types,
    typeUrl: {},
  };
});

module.exports = {
  LIMIT_SONG,
  /** 拉取歌单曲目。page 从 1 起；上游一次返回整张，这里按 page/limit 切片。 */
  async getListDetail(id, page = 1, limit = DEFAULT_LIMIT, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'));

    const playlistId = resolvePlaylistId(id);
    const { body } = await httpFetch(getListDetailUrl(playlistId), {
      headers: {
        Origin: 'https://y.qq.com',
        Referer: `https://y.qq.com/n/yqq/playsquare/${playlistId}.html`,
      },
    }).promise;

    if (body.code !== 0) return this.getListDetail(id, page, limit, ++tryNum);
    if (body.subcode !== 0 || !body.cdlist) return this.getListDetail2(playlistId, page, limit);
    const cdlist = body.cdlist[0];
    const all = filterListDetail(cdlist.songlist);
    const start = (page - 1) * limit;
    return {
      list: all.slice(start, start + limit),
      page,
      limit,
      total: all.length,
      source: 'tx',
      info: {
        name: cdlist.dissname,
        img: cdlist.logo,
        desc: decodeName(cdlist.desc).replace(/<br>/g, '\n'),
        author: cdlist.nickname,
        play_count: formatPlayCount(cdlist.visitnum),
      },
    };
  },
  /** getListDetail 的后备接口（musicu.fcg）。 */
  async getListDetail2(id, page = 1, limit = DEFAULT_LIMIT, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'));

    const { body } = await postJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      comm: {
        cv: 4747474,
        ct: 24,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        platform: 'yqq.json',
        needNewCode: 1,
        uin: 0,
      },
      req_1: {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: {
          disstid: parseInt(id, 10),
          userinfo: 1,
          tag: 1,
          orderlist: 1,
          song_begin: 0,
          song_num: LIMIT_SONG,
          onlysonglist: 0,
          enc_host_uin: '',
        },
      },
    }, {
      Origin: 'https://y.qq.com',
      Referer: `https://y.qq.com/n/yqq/playsquare/${id}.html`,
    });

    if (body.code !== 0) return this.getListDetail2(id, page, limit, ++tryNum);
    if (body.req_1.code !== 0) throw new Error('failed');

    const result = body.req_1.data;
    const dirinfo = result.dirinfo;
    const all = filterListDetail(result.songlist);
    const start = (page - 1) * limit;
    return {
      list: all.slice(start, start + limit),
      page,
      limit,
      total: result.total_song_num ?? all.length,
      source: 'tx',
      info: {
        name: dirinfo.title,
        img: dirinfo.picurl,
        desc: decodeName(dirinfo.desc ?? '').replace(/<br>/g, '\n'),
        author: dirinfo.host_nick,
        play_count: formatPlayCount(dirinfo.listennum),
      },
    };
  },
  /** 搜索歌单（不是单曲）。page 从 1 起。 */
  search(text, page = 1, limit = 20, retryNum = 0) {
    if (retryNum > 5) throw new Error('max retry');
    return httpFetch(
      'http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist'
      + `?page_no=${page - 1}&num_per_page=${limit}&format=json&query=${encodeURIComponent(text)}`
      + '&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
          Referer: 'http://y.qq.com/portal/search.html',
        },
      },
    ).promise.then(({ body }) => {
      if (body.code != 0) return this.search(text, page, limit, ++retryNum);
      return {
        list: body.data.list.map(item => ({
          play_count: formatPlayCount(item.listennum),
          id: String(item.dissid),
          author: decodeName(item.creator.name),
          name: decodeName(item.dissname),
          img: item.imgurl,
          total: item.song_count,
          desc: decodeName(decodeName(item.introduction)).replace(/<br>/g, '\n'),
          source: 'tx',
        })),
        limit,
        total: body.data.sum,
        source: 'tx',
      };
    });
  },
  _internal: { filterListDetail, resolvePlaylistId },
};
