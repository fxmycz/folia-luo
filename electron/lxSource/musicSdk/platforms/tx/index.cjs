// electron/lxSource/musicSdk/platforms/tx/index.cjs
// QQ 音乐（tx）平台聚合入口。
// 对应 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/index.js，
// 只聚合 Phase 2 需要的 leaderboard / songList / musicSearch。

const leaderboard = require('./leaderboard.cjs');
const songList = require('./songList.cjs');
const musicSearch = require('./musicSearch.cjs');
const lyric = require('./lyric.cjs');

module.exports = {
  source: 'tx',
  leaderboard,
  songList,
  musicSearch,
  lyric,
};
