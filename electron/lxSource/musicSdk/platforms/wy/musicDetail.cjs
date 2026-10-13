// electron/lxSource/musicSdk/platforms/wy/musicDetail.cjs
// 网易云（wy）歌曲详情归一化：按 id 批量取详情。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/wy/musicDetail.js
// （参考 Binaryify/NeteaseCloudMusicApi module/song_detail.js），只保留批量 getList 与解析。

const { httpFetch } = require('../../request.cjs');
const { weapi } = require('./crypto.cjs');
const { formatPlayTime, sizeFormate } = require('../../utils.cjs');

const getSinger = (singers) => {
  const arr = [];
  singers?.forEach((singer) => {
    arr.push(singer.name);
  });
  return arr.join('、');
};

// songs + privileges → 洛雪 music-info；音质按 maxbr 逐档回退（原版依赖 switch fallthrough）。
const filterList = ({ songs, privileges }) => {
  const list = [];
  songs.forEach((item, index) => {
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
        singer: getSinger(item.ar),
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

/** 按 id 列表批量取歌曲详情。 */
const getList = async (ids = [], retryNum = 0) => {
  if (retryNum > 2) return Promise.reject(new Error('try max num'));

  const requestObj = httpFetch('https://music.163.com/weapi/v3/song/detail', {
    method: 'post',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      origin: 'https://music.163.com',
    },
    form: weapi({
      c: '[' + ids.map(id => (`{"id":${id}}`)).join(',') + ']',
      ids: '[' + ids.join(',') + ']',
    }),
  });
  const { body, statusCode } = await requestObj.promise;
  if (statusCode != 200 || body.code !== 200) throw new Error('获取歌曲详情失败');
  return { source: 'wy', list: filterList(body) };
};

module.exports = { getSinger, filterList, getList };
