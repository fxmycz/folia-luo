// electron/lxSource/musicSdk/platforms/mg/songList.cjs
// 咪咕（mg）歌单：歌单详情曲目 + 歌单搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/mg/songList.js，
// 只保留 Phase 2 需要的部分：详情曲目（getListDetail）与歌单搜索（search）。
// 原版的「歌单广场」分页（getList / getTags）本版不移植；Folia 的歌单入口来自搜索。

const { httpFetch } = require('../../request.cjs');
const { formatPlayCount } = require('../../utils.cjs');
const { filterMusicInfoListV5 } = require('./musicInfo.cjs');
const { createHttpFetch } = require('./utils.cjs');
const { createSignature } = require('./musicSearch.cjs');

const LIMIT_SONG = 50;
const SUCCESS_CODE = '000000';

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  Referer: 'https://m.music.migu.cn/',
};

const getSongListDetailUrl = (id, page, limit) => (
  `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${limit}&playlistId=${id}`
);

// 把用户可能传入的歌单链接收敛成纯数字的歌单 id。
const resolvePlaylistId = (id) => {
  const match = /(?:playlistId|id)=(\d+)/.exec(String(id))
    ?? /\/playlist\/(\d+)/.exec(String(id));
  return match ? match[1] : String(id);
};

module.exports = {
  LIMIT_SONG,
  /** 拉取歌单曲目。page 从 1 起。 */
  async getListDetail(id, page = 1, limit = LIMIT_SONG, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'));
    const playlistId = resolvePlaylistId(id);

    const listRequest = httpFetch(getSongListDetailUrl(playlistId, page, limit), { headers: defaultHeaders }).promise;
    const infoRequest = httpFetch(
      `https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${playlistId}`,
      { headers: defaultHeaders },
    ).promise;

    const [listResult, infoResult] = await Promise.all([listRequest, infoRequest]).catch(() => [null, null]);
    if (!listResult || listResult.body.code !== SUCCESS_CODE) return this.getListDetail(id, page, limit, ++retryNum);

    const info = infoResult?.body?.code === SUCCESS_CODE
      ? {
        name: infoResult.body.data.title,
        img: infoResult.body.data.imgItem?.img,
        desc: infoResult.body.data.summary,
        author: infoResult.body.data.ownerName,
        play_count: formatPlayCount(infoResult.body.data.opNumItem?.playNum),
      }
      : null;

    return {
      list: filterMusicInfoListV5(listResult.body.data.songList),
      page,
      limit,
      total: listResult.body.data.totalCount,
      source: 'mg',
      info,
    };
  },

  // 歌单搜索结果条目 → 洛雪歌单记录。
  filterSongListResult(raw) {
    const list = [];
    raw.forEach((item) => {
      if (!item.id) return;
      const playCount = parseInt(item.playNum, 10);
      list.push({
        play_count: Number.isNaN(playCount) ? 0 : formatPlayCount(playCount),
        id: item.id,
        author: item.userName,
        name: item.name,
        img: item.musicListPicUrl,
        total: item.musicNum,
        source: 'mg',
      });
    });
    return list;
  },

  /** 搜索歌单（不是单曲）。page 从 1 起。 */
  search(text, page = 1, limit = 20) {
    const timeStr = Date.now().toString();
    const signResult = createSignature(timeStr, text);
    return createHttpFetch(
      'https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1'
      + '&searchSwitch=%7B%22song%22%3A0%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A0'
      + '%2C%22mvSong%22%3A0%2C%22bestShow%22%3A0%2C%22songlist%22%3A1%2C%22lyricSong%22%3A0%7D'
      + `&pageSize=${limit}&text=${encodeURIComponent(text)}&pageNo=${page}&sort=0&sid=USS`,
      {
        headers: {
          uiVersion: 'A_music_3.6.1',
          deviceId: signResult.deviceId,
          timestamp: timeStr,
          sign: signResult.sign,
          channel: '0146921',
          'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
        },
      },
    ).then((body) => {
      if (!body.songListResultData) throw new Error('get song list failed.');
      return {
        list: this.filterSongListResult(body.songListResultData.result),
        limit,
        total: parseInt(body.songListResultData.totalCount, 10),
        source: 'mg',
      };
    });
  },
  _internal: { resolvePlaylistId },
};
