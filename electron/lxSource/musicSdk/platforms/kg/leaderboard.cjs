// electron/lxSource/musicSdk/platforms/kg/leaderboard.cjs
// 酷狗（kg）排行榜：榜单列表与榜单曲目。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kg/leaderboard.js。
// 相对原版只做两处适配：把固定的 `this.listDetailLimit` 提成参数（供 Omni 分页），并去掉与榜单无关的工具/网络动态榜单。

const { httpFetch } = require('../../request.cjs');
const { decodeName, formatPlayTime, sizeFormate, formatSingerName, kugouCoverFromTransParam } = require('../../utils.cjs');

// 榜单清单（原版 getBoards 用的就是这份固定表，走接口的动态版本已被上游注释掉）。
const boardList = [
  { id: 'kg__8888', name: 'TOP500', bangid: '8888' },
  { id: 'kg__6666', name: '飙升榜', bangid: '6666' },
  { id: 'kg__59703', name: '蜂鸟流行音乐榜', bangid: '59703' },
  { id: 'kg__52144', name: '抖音热歌榜', bangid: '52144' },
  { id: 'kg__52767', name: '快手热歌榜', bangid: '52767' },
  { id: 'kg__24971', name: 'DJ热歌榜', bangid: '24971' },
  { id: 'kg__23784', name: '网络红歌榜', bangid: '23784' },
  { id: 'kg__44412', name: '说唱先锋榜', bangid: '44412' },
  { id: 'kg__31308', name: '内地榜', bangid: '31308' },
  { id: 'kg__33160', name: '电音榜', bangid: '33160' },
  { id: 'kg__31313', name: '香港地区榜', bangid: '31313' },
  { id: 'kg__51341', name: '民谣榜', bangid: '51341' },
  { id: 'kg__54848', name: '台湾地区榜', bangid: '54848' },
  { id: 'kg__31310', name: '欧美榜', bangid: '31310' },
  { id: 'kg__33162', name: 'ACG新歌榜', bangid: '33162' },
  { id: 'kg__31311', name: '韩国榜', bangid: '31311' },
  { id: 'kg__31312', name: '日本榜', bangid: '31312' },
  { id: 'kg__49225', name: '80后热歌榜', bangid: '49225' },
  { id: 'kg__49223', name: '90后热歌榜', bangid: '49223' },
  { id: 'kg__49224', name: '00后热歌榜', bangid: '49224' },
  { id: 'kg__33165', name: '粤语金曲榜', bangid: '33165' },
  { id: 'kg__33166', name: '欧美金曲榜', bangid: '33166' },
  { id: 'kg__33163', name: '影视金曲榜', bangid: '33163' },
  { id: 'kg__51340', name: '伤感榜', bangid: '51340' },
  { id: 'kg__35811', name: '会员专享榜', bangid: '35811' },
  { id: 'kg__37361', name: '雷达榜', bangid: '37361' },
  { id: 'kg__21101', name: '分享榜', bangid: '21101' },
  { id: 'kg__46910', name: '综艺新歌榜', bangid: '46910' },
  { id: 'kg__30972', name: '酷狗音乐人原创榜', bangid: '30972' },
  { id: 'kg__60170', name: '闽南语榜', bangid: '60170' },
  { id: 'kg__65234', name: '儿歌榜', bangid: '65234' },
  { id: 'kg__4681', name: '美国BillBoard榜', bangid: '4681' },
  { id: 'kg__25028', name: 'Beatport电子舞曲榜', bangid: '25028' },
  { id: 'kg__4680', name: '英国单曲榜', bangid: '4680' },
  { id: 'kg__38623', name: '韩国Melon音乐榜', bangid: '38623' },
  { id: 'kg__42807', name: 'joox本地热歌榜', bangid: '42807' },
  { id: 'kg__36107', name: '小语种热歌榜', bangid: '36107' },
  { id: 'kg__4673', name: '日本公信榜', bangid: '4673' },
  { id: 'kg__46868', name: '日本SPACE SHOWER榜', bangid: '46868' },
  { id: 'kg__42808', name: 'KKBOX风云榜', bangid: '42808' },
  { id: 'kg__60171', name: '越南语榜', bangid: '60171' },
  { id: 'kg__60172', name: '泰语榜', bangid: '60172' },
  { id: 'kg__59895', name: 'R&B榜', bangid: '59895' },
  { id: 'kg__59896', name: '摇滚榜', bangid: '59896' },
  { id: 'kg__59897', name: '爵士榜', bangid: '59897' },
  { id: 'kg__59898', name: '乡村音乐榜', bangid: '59898' },
  { id: 'kg__59900', name: '纯音乐榜', bangid: '59900' },
  { id: 'kg__59899', name: '古典榜', bangid: '59899' },
  { id: 'kg__22603', name: '5sing音乐榜', bangid: '22603' },
  { id: 'kg__21335', name: '繁星音乐榜', bangid: '21335' },
  { id: 'kg__33161', name: '古风新歌榜', bangid: '33161' },
];

const DEFAULT_LIMIT = 100;

// 把榜单接口的原始条目归一化成洛雪统一的 music-info 记录。
const filterData = (rawList) => rawList.map((item) => {
  const types = [];
  const _types = {};
  if (item.filesize !== 0) {
    const size = sizeFormate(item.filesize);
    types.push({ type: '128k', size, hash: item.hash });
    _types['128k'] = { size, hash: item.hash };
  }
  if (item['320filesize'] !== 0) {
    const size = sizeFormate(item['320filesize']);
    types.push({ type: '320k', size, hash: item['320hash'] });
    _types['320k'] = { size, hash: item['320hash'] };
  }
  if (item.sqfilesize !== 0) {
    const size = sizeFormate(item.sqfilesize);
    types.push({ type: 'flac', size, hash: item.sqhash });
    _types.flac = { size, hash: item.sqhash };
  }
  if (item.filesize_high !== 0) {
    const size = sizeFormate(item.filesize_high);
    types.push({ type: 'flac24bit', size, hash: item.hash_high });
    _types.flac24bit = { size, hash: item.hash_high };
  }
  return {
    singer: formatSingerName(item.authors, 'author_name'),
    name: decodeName(item.songname),
    albumName: decodeName(item.remark),
    albumId: item.album_id,
    songmid: item.audio_id,
    albumAudioId: item.album_audio_id,
    source: 'kg',
    interval: formatPlayTime(item.duration),
    img: kugouCoverFromTransParam(item.trans_param),
    lrc: null,
    hash: item.hash,
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
    return { list: boardList, source: 'kg' };
  },
  getUrl(page, bangid, limit) {
    return `http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=${limit}&area_code=1&page=${page}&rankid=${bangid}&with_res_tag=0&show_portrait_mv=1`;
  },
  /**
   * 拉取某榜单的曲目。
   * @param {string|number} bangid 榜单 id（bangid）
   * @param {number} page 1 起的页码
   * @param {number} limit 每页条数
   */
  getList(bangid, page = 1, limit = DEFAULT_LIMIT, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'));
    return httpFetch(this.getUrl(page, bangid, limit)).promise.then(({ body }) => {
      if (body.errcode != 0) return this.getList(bangid, page, limit, retryNum);
      return {
        total: body.data.total,
        list: filterData(body.data.info),
        limit,
        page,
        source: 'kg',
      };
    });
  },
  getDetailPageUrl(id) {
    if (typeof id === 'string') id = id.replace('kg__', '');
    return `https://www.kugou.com/yy/rank/home/1-${id}.html`;
  },
  // 供离线单测直接断言解析结果。
  _internal: { filterData },
};
