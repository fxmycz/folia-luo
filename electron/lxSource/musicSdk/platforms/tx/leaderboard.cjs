// electron/lxSource/musicSdk/platforms/tx/leaderboard.cjs
// QQ 音乐（tx）排行榜：榜单列表与榜单曲目。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/leaderboard.js。
// 上游 GetDetail 一次返回固定条数、不认页码，这里在本地按 page/limit 切片，让 Omni 分页语义与 mg 一致。

const { httpFetch } = require('../../request.cjs');
const { postJson } = require('./utils.cjs');
const { formatPlayTime, sizeFormate, formatSingerName } = require('../../utils.cjs');

const boardList = [
  { id: 'tx__4', name: '流行指数榜', bangid: '4' },
  { id: 'tx__26', name: '热歌榜', bangid: '26' },
  { id: 'tx__27', name: '新歌榜', bangid: '27' },
  { id: 'tx__62', name: '飙升榜', bangid: '62' },
  { id: 'tx__58', name: '说唱榜', bangid: '58' },
  { id: 'tx__57', name: '喜力电音榜', bangid: '57' },
  { id: 'tx__28', name: '网络歌曲榜', bangid: '28' },
  { id: 'tx__5', name: '内地榜', bangid: '5' },
  { id: 'tx__3', name: '欧美榜', bangid: '3' },
  { id: 'tx__59', name: '香港地区榜', bangid: '59' },
  { id: 'tx__16', name: '韩国榜', bangid: '16' },
  { id: 'tx__60', name: '抖快榜', bangid: '60' },
  { id: 'tx__29', name: '影视金曲榜', bangid: '29' },
  { id: 'tx__17', name: '日本榜', bangid: '17' },
  { id: 'tx__52', name: '腾讯音乐人原创榜', bangid: '52' },
  { id: 'tx__36', name: 'K歌金曲榜', bangid: '36' },
  { id: 'tx__61', name: '台湾地区榜', bangid: '61' },
  { id: 'tx__63', name: 'DJ舞曲榜', bangid: '63' },
  { id: 'tx__64', name: '综艺新歌榜', bangid: '64' },
  { id: 'tx__65', name: '国风热歌榜', bangid: '65' },
  { id: 'tx__67', name: '听歌识曲榜', bangid: '67' },
  { id: 'tx__72', name: '动漫音乐榜', bangid: '72' },
  { id: 'tx__73', name: '游戏音乐榜', bangid: '73' },
  { id: 'tx__75', name: '有声榜', bangid: '75' },
  { id: 'tx__131', name: '校园音乐人排行榜', bangid: '131' },
];

// 与 LX 的 leaderboard.limit 一致：一次拉这么多再本地切片。
const DEFAULT_LIMIT = 300;

const regExps = {
  periodList: /<i class="play_cover__btn c_tx_link js_icon_play" data-listkey=".+?" data-listname=".+?" data-tid=".+?" data-date=".+?" .+?<\/i>/g,
  period: /data-listname="(.+?)" data-tid=".*?\/(.+?)" data-date="(.+?)" .+?<\/i>/,
};

const periods = {};
const periodUrl = 'https://c.y.qq.com/node/pc/wk_v15/top.html';

// 榜单接口条目 → 洛雪 music-info。
const filterData = (rawList) => rawList.map((item) => {
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
  boardList,
  DEFAULT_LIMIT,
  getBoards() {
    return { list: boardList, source: 'tx' };
  },
  listDetailRequest(id, period, limit) {
    return postJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      toplist: {
        module: 'musicToplist.ToplistInfoServer',
        method: 'GetDetail',
        param: { topid: id, num: limit, period },
      },
      comm: { uin: 0, format: 'json', ct: 20, cv: 1859 },
    }, {
      'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
    });
  },
  getData(url) {
    return httpFetch(url).promise;
  },
  getPeriods(bangid) {
    return this.getData(periodUrl).then(({ body: html }) => {
      const result = html.match(regExps.periodList);
      if (!result) return Promise.reject(new Error('get data failed'));
      result.forEach((item) => {
        const matched = item.match(regExps.period);
        if (!matched) return;
        periods[matched[2]] = {
          name: matched[1],
          bangid: matched[2],
          period: matched[3],
        };
      });
      const info = periods[bangid];
      return info && info.period;
    });
  },
  /** 拉取某榜单曲目；上游返回固定条数，这里按 page/limit 切片。 */
  getList(bangid, page = 1, limit = DEFAULT_LIMIT, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'));
    bangid = parseInt(bangid, 10);
    const info = periods[bangid];
    const periodTask = info ? Promise.resolve(info.period) : this.getPeriods(bangid);
    return periodTask.then(period => this.listDetailRequest(bangid, period, DEFAULT_LIMIT).then((resp) => {
      if (resp.body.code !== 0) return this.getList(bangid, page, limit, retryNum);
      const all = filterData(resp.body.toplist.data.songInfoList);
      const start = (page - 1) * limit;
      return {
        total: all.length,
        list: all.slice(start, start + limit),
        limit,
        page,
        source: 'tx',
      };
    }));
  },
  getDetailPageUrl(id) {
    if (typeof id === 'string') id = id.replace('tx__', '');
    return `https://y.qq.com/n/ryqq/toplist/${id}`;
  },
  // 供离线单测直接断言解析结果。
  _internal: { filterData },
};
