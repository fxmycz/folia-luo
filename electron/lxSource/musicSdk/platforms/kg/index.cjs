// electron/lxSource/musicSdk/platforms/kg/index.cjs
// 酷狗（kg）平台聚合入口。
// 对应 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kg/index.js，
// 只聚合 Phase 2 需要的 leaderboard / songList / musicSearch（播放地址由用户音源脚本解析，不在此处理）。

const leaderboard = require('./leaderboard.cjs');
const songList = require('./songList.cjs');
const musicSearch = require('./musicSearch.cjs');

module.exports = {
  source: 'kg',
  leaderboard,
  songList,
  musicSearch,
};
