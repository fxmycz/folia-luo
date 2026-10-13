// electron/lxSource/musicSdk/platforms/wy/songList.cjs
// 网易云（wy）歌单：歌单详情曲目 + 歌单搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/wy/songList.js，
// 只保留 Phase 2 用得到的部分：详情曲目（getListDetail）与歌单搜索（search）。
// 原版的「歌单广场」分页（getList / getTags）、分享链重定向解析本版不移植；Folia 的歌单入口来自搜索。

const { httpFetch } = require('../../request.cjs');
const { weapi, linuxapi } = require('./crypto.cjs');
const { eapiRequest } = require('./utils.cjs');
const musicDetailApi = require('./musicDetail.cjs');
const { decodeName, formatPlayTime, sizeFormate, formatPlayCount, formatSingerName } = require('../../utils.cjs');

const LIMIT_SONG = 100000;
const DEFAULT_LIMIT = 100;
const successCode = 200;

const regExps = {
  listDetailLink: /^.+(?:\?|&)id=(\d+)(?:&.*$|#.*$|$)/,
  listDetailLink2: /^.+\/playlist\/(\d+)\/\d+\/.+$/,
};

// 把用户可能传入的歌单链接 / `id###token` 收敛成纯数字歌单 id。
const resolvePlaylistId = (id) => {
  let str = String(id);
  if (str.includes('###')) str = str.split('###')[0];
  if (regExps.listDetailLink.test(str)) return str.replace(regExps.listDetailLink, '$1');
  if (regExps.listDetailLink2.test(str)) return str.replace(regExps.listDetailLink2, '$1');
  return str;
};

// playlist.tracks + privileges → 洛雪 music-info；音质按 maxbr 逐档回退（原版依赖 switch fallthrough）。
const filterListDetail = ({ playlist: { tracks }, privileges }) => {
  const list = [];
  tracks.forEach((item, index) => {
    const types = [];
    const _types = {};
    let size;
    let privilege = privileges[index];
    if (privilege.id !== item.id) privilege = privileges.find(p => p.id === item.id);
    if (!privilege) return;

    if (privilege.maxBrLevel == 'hires') {
      size = item.hr ? sizeFormate(item.hr.size) : null;
      types.push({ type: 'flac24bit', size });
      _types.flac24bit = { size };
    }
    switch (privilege.maxbr) {
      case 999000:
        size = null;
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

    if (item.pc) {
      list.push({
        singer: item.pc.ar ?? '',
        name: item.pc.sn ?? '',
        albumName: item.pc.alb ?? '',
        albumId: item.al?.id,
        source: 'wy',
        interval: formatPlayTime(item.dt / 1000),
        songmid: item.id,
        img: item.al?.picUrl ?? '',
        lrc: null,
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      });
    } else {
      list.push({
        singer: formatSingerName(item.ar, 'name'),
        name: item.name ?? '',
        albumName: item.al?.name,
        albumId: item.al?.id,
        source: 'wy',
        interval: formatPlayTime(item.dt / 1000),
        songmid: item.id,
        img: item.al?.picUrl,
        lrc: null,
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      });
    }
  });
  return list;
};

module.exports = {
  LIMIT_SONG,
  /** 拉取歌单曲目。page 从 1 起；上游一次返回整张，这里按 page/limit 切片。 */
  async getListDetail(rawId, page = 1, limit = DEFAULT_LIMIT, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'));

    const id = resolvePlaylistId(rawId);
    const { statusCode, body } = await httpFetch('https://music.163.com/api/linux/forward', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      },
      form: linuxapi({
        method: 'POST',
        url: 'https://music.163.com/api/v3/playlist/detail',
        params: { id, n: LIMIT_SONG, s: 8 },
      }),
    }).promise;
    if (statusCode !== 200 || body.code !== successCode) return this.getListDetail(id, page, limit, ++tryNum);

    const start = (page - 1) * limit;
    const total = body.playlist.trackIds.length;
    let list;
    if (body.playlist.trackIds.length === body.privileges.length) {
      list = filterListDetail(body).slice(start, start + limit);
    } else {
      try {
        list = (await musicDetailApi.getList(
          body.playlist.trackIds.slice(start, start + limit).map(trackId => trackId.id),
        )).list;
      } catch (err) {
        if (err.message === 'try max num') throw err;
        return this.getListDetail(id, page, limit, ++tryNum);
      }
    }
    return {
      list,
      page,
      limit,
      total,
      source: 'wy',
      info: {
        play_count: formatPlayCount(body.playlist.playCount),
        name: body.playlist.name,
        img: body.playlist.coverImgUrl,
        desc: body.playlist.description,
        author: body.playlist.creator.nickname,
      },
    };
  },
  // 歌单搜索结果条目 → 洛雪歌单记录。
  filterList(rawData) {
    return rawData.map(item => ({
      play_count: formatPlayCount(item.playCount),
      id: String(item.id),
      author: item.creator.nickname,
      name: item.name,
      img: item.coverImgUrl,
      grade: item.grade,
      total: item.trackCount,
      desc: item.description,
      source: 'wy',
    }));
  },
  /** 搜索歌单（不是单曲）。page 从 1 起。 */
  search(text, page = 1, limit = 20) {
    return eapiRequest('/api/cloudsearch/pc', {
      s: text,
      type: 1000, // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
      limit,
      total: page == 1,
      offset: limit * (page - 1),
    }).promise.then(({ body }) => {
      if (body.code != successCode) throw new Error('filed');
      return {
        list: module.exports.filterList(body.result.playlists),
        limit,
        total: body.result.playlistCount,
        source: 'wy',
      };
    });
  },
  _internal: { filterListDetail, resolvePlaylistId },
};
