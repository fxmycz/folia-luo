// electron/lxSource/musicSdk/platforms/kw/songList.cjs
// 酷我（kw）歌单：歌单详情曲目 + 歌单搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kw/songList.js，
// 只保留 Phase 2 用得到的部分：详情曲目（getListDetail）与歌单搜索（search）。
// 原版的「歌单广场」分页（getList / getTags）依赖 HTML 抓取，本版不移植；Folia 的歌单入口来自搜索。

const { httpFetch } = require('../../request.cjs');
const { formatPlayTime, decodeName, formatPlayCount } = require('../../utils.cjs');
const { formatSinger, objStr2JSON } = require('./util.cjs');

const LIMIT_SONG = 100;

const regExps = {
  mInfo: /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/,
  listDetailLink: /^.+\/playlist(?:_detail)?\/(\d+)(?:\?.*|&.*$|#.*$|$)/,
};

const getListDetailUrl = (id, page, limit) => (
  `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page - 1}&rn=${limit}`
  + '&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1'
);

// 歌单详情条目的音质解析；与原版 filterListDetail 一致。
const filterListDetail = (rawData) => rawData.map((item) => {
  const types = [];
  const _types = {};
  item.N_MINFO.split(';').forEach((entry) => {
    const info = entry.match(regExps.mInfo);
    if (!info) return;
    const size = info[4].toLocaleUpperCase();
    switch (info[2]) {
      case '4000': types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }; break;
      case '2000': types.push({ type: 'flac', size }); _types.flac = { size }; break;
      case '320': types.push({ type: '320k', size }); _types['320k'] = { size }; break;
      case '128': types.push({ type: '128k', size }); _types['128k'] = { size }; break;
      default: break;
    }
  });
  types.reverse();

  return {
    singer: formatSinger(decodeName(item.artist)),
    name: decodeName(item.name),
    albumName: decodeName(item.album),
    albumId: item.albumid,
    songmid: item.id,
    source: 'kw',
    interval: formatPlayTime(parseInt(item.duration, 10)),
    img: null,
    lrc: null,
    otherSource: null,
    types,
    _types,
    typeUrl: {},
  };
});

// 把用户可能传入的各种歌单链接/标识收敛成纯数字的歌单 id。
const resolvePlaylistId = (id) => {
  if (typeof id === 'string' && /[?&:/]/.test(id)) return id.replace(regExps.listDetailLink, '$1');
  if (typeof id === 'string' && id.startsWith('digest-')) return id.split('__')[1] ?? id;
  return id;
};

module.exports = {
  LIMIT_SONG,
  /** 拉取歌单曲目。page 从 1 起。 */
  getListDetail(id, page = 1, limit = LIMIT_SONG, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'));
    const playlistId = resolvePlaylistId(id);
    return httpFetch(getListDetailUrl(playlistId, page, limit)).promise.then(({ body }) => {
      if (body.result !== 'ok') return this.getListDetail(id, page, limit, ++retryNum);
      return {
        list: filterListDetail(body.musiclist),
        page,
        limit: body.rn ?? limit,
        total: body.total,
        source: 'kw',
        info: {
          name: body.title,
          img: body.pic,
          desc: body.info,
          author: body.uname,
          play_count: formatPlayCount(body.playnum),
        },
      };
    });
  },
  /** 搜索歌单（不是单曲）。page 从 1 起。 */
  search(text, page = 1, limit = 20) {
    return httpFetch(
      'http://search.kuwo.cn/r.s?all=' + encodeURIComponent(text)
      + `&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8&ver=mbox`
      + '&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=playlist&pay=0&needliveshow=0',
    ).promise.then(({ body }) => {
      const parsed = objStr2JSON(body);
      return {
        list: parsed.abslist.map(item => ({
          play_count: formatPlayCount(item.playcnt),
          id: String(item.playlistid),
          author: decodeName(item.nickname),
          name: decodeName(item.name),
          total: item.songnum,
          img: item.pic,
          desc: decodeName(item.intro),
          source: 'kw',
        })),
        limit,
        total: parseInt(parsed.TOTAL, 10),
        source: 'kw',
      };
    });
  },
  _internal: { filterListDetail, resolvePlaylistId },
};
