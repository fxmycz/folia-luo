// electron/lxSource/musicSdk/platforms/kw/leaderboard.cjs
// 酷我（kw）排行榜：榜单列表与榜单曲目。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kw/leaderboard.js。
// 相对原版只做两处适配：把固定的 `this.limit` 提成参数（供 Omni 分页），并去掉与榜单无关的工具。

const { httpFetch } = require('../../request.cjs');
const { formatPlayTime, decodeName } = require('../../utils.cjs');
const { formatSinger, wbdCrypto } = require('./util.cjs');

// 榜单清单（原版 getBoards 用的就是这份固定表，走接口的动态版本已被上游注释掉）。
const boardList = [
  { id: 'kw__93', name: '飙升榜', bangid: '93' },
  { id: 'kw__17', name: '新歌榜', bangid: '17' },
  { id: 'kw__16', name: '热歌榜', bangid: '16' },
  { id: 'kw__158', name: '抖音热歌榜', bangid: '158' },
  { id: 'kw__292', name: '铃声榜', bangid: '292' },
  { id: 'kw__284', name: '热评榜', bangid: '284' },
  { id: 'kw__290', name: 'ACG新歌榜', bangid: '290' },
  { id: 'kw__286', name: '台湾KKBOX榜', bangid: '286' },
  { id: 'kw__279', name: '冬日暖心榜', bangid: '279' },
  { id: 'kw__281', name: '巴士随身听榜', bangid: '281' },
  { id: 'kw__255', name: 'KTV点唱榜', bangid: '255' },
  { id: 'kw__280', name: '家务进行曲榜', bangid: '280' },
  { id: 'kw__282', name: '熬夜修仙榜', bangid: '282' },
  { id: 'kw__283', name: '枕边轻音乐榜', bangid: '283' },
  { id: 'kw__278', name: '古风音乐榜', bangid: '278' },
  { id: 'kw__264', name: 'Vlog音乐榜', bangid: '264' },
  { id: 'kw__242', name: '电音榜', bangid: '242' },
  { id: 'kw__187', name: '流行趋势榜', bangid: '187' },
  { id: 'kw__204', name: '现场音乐榜', bangid: '204' },
  { id: 'kw__186', name: 'ACG神曲榜', bangid: '186' },
  { id: 'kw__185', name: '最强翻唱榜', bangid: '185' },
  { id: 'kw__26', name: '经典怀旧榜', bangid: '26' },
  { id: 'kw__104', name: '华语榜', bangid: '104' },
  { id: 'kw__182', name: '粤语榜', bangid: '182' },
  { id: 'kw__22', name: '欧美榜', bangid: '22' },
  { id: 'kw__184', name: '韩语榜', bangid: '184' },
  { id: 'kw__183', name: '日语榜', bangid: '183' },
  { id: 'kw__145', name: '会员畅听榜', bangid: '145' },
  { id: 'kw__153', name: '网红新歌榜', bangid: '153' },
  { id: 'kw__64', name: '影视金曲榜', bangid: '64' },
  { id: 'kw__176', name: 'DJ嗨歌榜', bangid: '176' },
  { id: 'kw__106', name: '真声音', bangid: '106' },
  { id: 'kw__12', name: 'Billboard榜', bangid: '12' },
  { id: 'kw__49', name: 'iTunes音乐榜', bangid: '49' },
  { id: 'kw__180', name: 'beatport电音榜', bangid: '180' },
  { id: 'kw__13', name: '英国UK榜', bangid: '13' },
  { id: 'kw__164', name: '百大DJ榜', bangid: '164' },
  { id: 'kw__246', name: 'YouTube音乐排行榜', bangid: '246' },
  { id: 'kw__265', name: '韩国Genie榜', bangid: '265' },
  { id: 'kw__14', name: '韩国M-net榜', bangid: '14' },
  { id: 'kw__8', name: '香港电台榜', bangid: '8' },
  { id: 'kw__15', name: '日本公信榜', bangid: '15' },
  { id: 'kw__151', name: '腾讯音乐人原创榜', bangid: '151' },
];

const QUALITY_RANK = { flac24bit: 4, flac: 3, '320k': 2, '128k': 1 };

// 音质按由低到高排序，保证 provider 挑档时顺序稳定。
const sortQualityArray = (array) => {
  const ranked = [];
  array.forEach((item, index) => {
    const type = QUALITY_RANK[item.type];
    if (type) ranked.push({ type, index });
  });
  ranked.sort((a, b) => a.type - b.type);
  return ranked.map(item => array[item.index]);
};

const regExps = {
  mInfo: /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/,
};

// 把榜单接口的原始条目归一化成洛雪统一的 music-info 记录。
const filterData = (rawList) => rawList.map((item) => {
  let types = [];
  const _types = {};
  const qualitys = new Set();

  item.n_minfo.split(';').forEach((entry) => {
    const info = entry.match(regExps.mInfo);
    if (!info) return;
    const quality = info[2];
    const size = info[4].toLocaleUpperCase();
    if (qualitys.has(quality)) return;
    qualitys.add(quality);
    switch (quality) {
      case '4000': types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }; break;
      case '2000': types.push({ type: 'flac', size }); _types.flac = { size }; break;
      case '320': types.push({ type: '320k', size }); _types['320k'] = { size }; break;
      case '128': types.push({ type: '128k', size }); _types['128k'] = { size }; break;
      default: break;
    }
  });
  types = sortQualityArray(types);

  return {
    singer: formatSinger(decodeName(item.artist)),
    name: decodeName(item.name),
    albumName: decodeName(item.album),
    albumId: item.albumId,
    songmid: item.id,
    source: 'kw',
    interval: formatPlayTime(parseInt(item.duration, 10)),
    img: item.pic,
    lrc: null,
    otherSource: null,
    types,
    _types,
    typeUrl: {},
  };
});

module.exports = {
  boardList,
  getBoards() {
    return { list: boardList, source: 'kw' };
  },
  /**
   * 拉取某榜单的曲目。
   * @param {string|number} bangid 榜单 id（bangid）
   * @param {number} page 1 起的页码
   * @param {number} limit 每页条数
   */
  getList(bangid, page = 1, limit = 100, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'));

    const requestBody = {
      uid: '', devId: '', sFrom: 'kuwo_sdk', user_type: 'AP',
      carSource: 'kwplayercar_ar_6.0.1.0_apk_keluze.apk',
      id: bangid, pn: page - 1, rn: limit,
    };
    const requestUrl = `https://wbd.kuwo.cn/api/bd/bang/bang_info?${wbdCrypto.buildParam(requestBody)}`;

    return httpFetch(requestUrl).promise.then(({ statusCode, body }) => {
      const rawData = wbdCrypto.decodeData(body);
      const data = rawData.data;
      if (statusCode !== 200 || rawData.code != 200 || !data.musiclist) {
        return this.getList(bangid, page, limit, retryNum);
      }
      return {
        total: parseInt(data.total, 10),
        list: filterData(data.musiclist),
        limit,
        page,
        source: 'kw',
      };
    });
  },
  // 供离线单测直接断言解析结果。
  _internal: { filterData, sortQualityArray },
};
