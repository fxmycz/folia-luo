// electron/lxSource/musicSdk/platforms/mg/leaderboard.cjs
// 咪咕（mg）排行榜：榜单列表与榜单曲目。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/mg/leaderboard.js。
// 上游接口一次返回整榜、不认页码，这里在本地按 page/limit 切片，让 Omni 分页语义一致。

const { httpFetch } = require('../../request.cjs');
const { filterMusicInfoList } = require('./musicInfo.cjs');

const boardList = [
  { id: 'mg__27553319', name: '新歌榜', bangid: '27553319', source: 'mg' },
  { id: 'mg__27186466', name: '热歌榜', bangid: '27186466', source: 'mg' },
  { id: 'mg__27553408', name: '原创榜', bangid: '27553408', source: 'mg' },
  { id: 'mg__75959118', name: '音乐风向榜', bangid: '75959118', source: 'mg' },
  { id: 'mg__76557036', name: '彩铃分贝榜', bangid: '76557036', source: 'mg' },
  { id: 'mg__76557745', name: '会员臻爱榜', bangid: '76557745', source: 'mg' },
  { id: 'mg__23189800', name: '港台榜', bangid: '23189800', source: 'mg' },
  { id: 'mg__23189399', name: '内地榜', bangid: '23189399', source: 'mg' },
  { id: 'mg__19190036', name: '欧美榜', bangid: '19190036', source: 'mg' },
  { id: 'mg__83176390', name: '国风金曲榜', bangid: '83176390', source: 'mg' },
];

const SUCCESS_CODE = '000000';

module.exports = {
  boardList,
  getBoards() {
    return { list: boardList, source: 'mg' };
  },
  getUrl(bangid) {
    return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${bangid}&needAll=0`;
  },
  /** 拉取某榜单曲目；上游返回整榜，这里按 page/limit 切片。 */
  getList(bangid, page = 1, limit = 200, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'));
    return httpFetch(this.getUrl(bangid)).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || body.code !== SUCCESS_CODE) return this.getList(bangid, page, limit, retryNum);
      const all = filterMusicInfoList(body.columnInfo.contents.map(m => m.objectInfo));
      const start = (page - 1) * limit;
      return {
        total: all.length,
        list: all.slice(start, start + limit),
        limit,
        page,
        source: 'mg',
      };
    });
  },
  getDetailPageUrl(id) {
    const bangid = typeof id === 'string' ? id.replace('mg__', '') : id;
    const board = boardList.find(item => item.bangid === bangid);
    return board ? `https://music.migu.cn/v3/music/top/${board.bangid}` : null;
  },
};
