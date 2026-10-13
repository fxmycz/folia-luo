// electron/lxSource/musicSdk/index.cjs
// 洛雪 musicSdk（kw 酷我 / mg 咪咕 / kg 酷狗 / tx QQ音乐 / wy 网易云）在主进程里的对外入口。
// 平台代码移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/，保留其许可与出处。
//
// 提供四类在线数据查询，供 `lx-source:*` IPC 调用：
//   getBoards      榜单列表
//   getBoardTracks 榜单曲目
//   getPlaylistTracks 歌单曲目
//   searchSongs / searchPlaylists 单曲 / 歌单搜索
//   searchSuggestions 搜索联想（仅有联想接口的平台支持，其余返回空数组）
// 播放直链与歌词不在这里解析——那仍然走用户音源脚本（Phase 1）。

const kw = require('./platforms/kw/index.cjs');
const mg = require('./platforms/mg/index.cjs');
const kg = require('./platforms/kg/index.cjs');
const tx = require('./platforms/tx/index.cjs');
const wy = require('./platforms/wy/index.cjs');

const platforms = { kw, mg, kg, tx, wy };
const SUPPORTED_SOURCES = Object.keys(platforms);

const requirePlatform = (source) => {
  const platform = platforms[source];
  if (!platform) throw new Error(`不支持的平台：${source}`);
  return platform;
};

// 各平台上游的默认每页条数与洛雪一致。
const DEFAULT_LIMITS = {
  boards: { kw: 100, mg: 200, kg: 100, tx: 300, wy: 200 },
  playlist: { kw: 100, mg: 50, kg: 100, tx: 100, wy: 100 },
  song: { kw: 30, mg: 20, kg: 30, tx: 50, wy: 30 },
  playlistSearch: { kw: 20, mg: 20, kg: 20, tx: 20, wy: 20 },
};

const limitFor = (kind, source, limit) => limit ?? DEFAULT_LIMITS[kind][source] ?? 20;

module.exports = {
  SUPPORTED_SOURCES,

  getBoards(source) {
    return requirePlatform(source).leaderboard.getBoards();
  },

  getBoardTracks({ source, boardId, page = 1, limit } = {}) {
    return requirePlatform(source).leaderboard.getList(boardId, page, limitFor('boards', source, limit));
  },

  getPlaylistTracks({ source, id, page = 1, limit } = {}) {
    return requirePlatform(source).songList.getListDetail(id, page, limitFor('playlist', source, limit));
  },

  searchSongs({ source, query, page = 1, limit } = {}) {
    return requirePlatform(source).musicSearch.search(query, page, limitFor('song', source, limit));
  },

  searchPlaylists({ source, query, page = 1, limit } = {}) {
    return requirePlatform(source).songList.search(query, page, limitFor('playlistSearch', source, limit));
  },

  /**
   * 搜索联想。平台没有联想接口（如咪咕）时返回空数组，由渲染层回退到本地搜索历史。
   * 请求失败也吞成空数组：联想只是锦上添花，不该让输入框报错。
   */
  async searchSuggestions({ source, query } = {}) {
    const keyword = typeof query === 'string' ? query.trim() : '';
    if (!keyword) return [];
    const tipSearch = requirePlatform(source).musicSearch?.tipSearch;
    if (typeof tipSearch !== 'function') return [];
    try {
      const list = await tipSearch(keyword);
      if (!Array.isArray(list)) return [];
      const seen = new Set();
      const result = [];
      for (const item of list) {
        const value = typeof item === 'string' ? item.trim() : '';
        if (!value || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
        if (result.length >= 10) break;
      }
      return result;
    } catch {
      return [];
    }
  },

  /**
   * 内置歌词。洛雪里歌词由 musicSdk 各平台的 lyric 模块提供（自定义音源脚本只负责直链），
   * 本项目此前只把歌词转发给脚本，脚本没实现 lyric 的歌曲就会无歌词；这里补上同源的兜底实现。
   * 返回 `{ lyric, tlyric, rlyric, lxlyric }`；不支持或取不到时 reject。
   */
  getLyric(source, musicInfo) {
    const lyric = requirePlatform(source).lyric;
    if (!lyric || typeof lyric.getLyric !== 'function') {
      return Promise.reject(new Error(`平台 ${source} 不支持内置歌词`));
    }
    return lyric.getLyric(musicInfo);
  },

  // 供离线单测直接断言各平台的纯解析函数。
  _internal: { kw, mg, kg, tx, wy },
};
