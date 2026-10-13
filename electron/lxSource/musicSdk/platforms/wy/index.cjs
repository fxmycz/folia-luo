// electron/lxSource/musicSdk/platforms/wy/index.cjs
// 网易云（wy）平台聚合入口。
// 对应 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/wy/index.js，
// 只聚合 Phase 2 需要的 leaderboard / songList / musicSearch。

const leaderboard = require('./leaderboard.cjs');
const songList = require('./songList.cjs');
const musicSearch = require('./musicSearch.cjs');

module.exports = {
  source: 'wy',
  leaderboard,
  songList,
  musicSearch,
};
