// electron/lxSource/musicSdk/platforms/kw/index.cjs
// 酷我（kw）平台聚合入口。
// 对应 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kw/index.js，
// 只聚合 Phase 2 需要的 leaderboard / songList / musicSearch（播放地址由用户音源脚本解析，不在此处理）。

const leaderboard = require('./leaderboard.cjs');
const songList = require('./songList.cjs');
const musicSearch = require('./musicSearch.cjs');
const lyric = require('./lyric.cjs');

module.exports = {
  source: 'kw',
  leaderboard,
  songList,
  musicSearch,
  lyric,
};
