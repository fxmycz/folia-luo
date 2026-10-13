// electron/lxSource/musicSdk/platforms/kg/songList.cjs
// 酷狗（kg）歌单：歌单详情曲目 + 歌单搜索。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kg/songList.js。
// 只保留 Phase 2 用得到的部分：详情曲目（getListDetail）与歌单搜索（search）。
// 原版的「歌单广场」分页（getList / getTags）、分享链 / 酷狗码 / gcid 等入口依赖 HTML 抓取与额外签名，
// 本版不移植；Folia 的歌单入口来自搜索，id 形如 `id_<specialid>`。

const { httpFetch } = require('../../request.cjs');
const { decodeName, formatPlayTime, sizeFormate, formatPlayCount } = require('../../utils.cjs');

const LIMIT_SONG = 100;

const regExps = {
  listData: /global\.data = (\[.+\]);/,
  listInfo: /global = {[\s\S]+?name: "(.+)"[\s\S]+?pic: "(.+)"[\s\S]+?};/,
  // https://www.kugou.com/yy/special/single/1067062.html
  listDetailLink: /^.+\/(\d+)\.html(?:\?.*|&.*$|#.*$|$)/,
};

const getSongListDetailUrl = (id) => `http://www2.kugou.kugou.com/yueku/v9/special/single/${id}-5-9999.html`;

const parseHtmlDesc = (html) => {
  const prefix = '<div class="pc_specail_text pc_singer_tab_content" id="specailIntroduceWrap">';
  let index = html.indexOf(prefix);
  if (index < 0) return null;
  const afterStr = html.substring(index + prefix.length);
  index = afterStr.indexOf('</div>');
  if (index < 0) return null;
  return decodeName(afterStr.substring(0, index));
};

// 带重试的请求：响应码非 200 或业务码非 0 时按次数重试；成功时解包成 data / info。
// 移植自 LX songList.js 的 createHttp。原版用 needle 自动把对象 body 序列化成 JSON，
// Folia 的 httpFetch 只发原始字符串，故调用处显式 JSON.stringify 并带 Content-Type。
const createHttp = async (url, options, retryNum = 0) => {
  if (retryNum > 2) throw new Error('try max num');
  let result;
  try {
    result = await httpFetch(url, options).promise;
  } catch {
    return createHttp(url, options, ++retryNum);
  }
  const errcode = result.body.error_code ?? result.body.errcode ?? result.body.err_code;
  if (result.statusCode !== 200 || errcode !== 0) return createHttp(url, options, ++retryNum);
  if (result.body.data) return result.body.data;
  if (Array.isArray(result.body.info)) return result.body;
  return result.body.info;
};

// 用 hash 批量换取完整音频信息，每 100 个一批。
const createTask = (hashs) => {
  const data = {
    area_code: '1',
    show_privilege: 1,
    show_album_info: '1',
    is_publish: '',
    appid: 1005,
    clientver: 11451,
    mid: '1',
    dfid: '-',
    clienttime: Date.now(),
    key: 'OIlwieks28dk2k092lksi2UIkp',
    fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
  };
  let list = hashs;
  const tasks = [];
  while (list.length) {
    tasks.push(Object.assign({ data: list.slice(0, 100) }, data));
    if (list.length < 100) break;
    list = list.slice(100);
  }
  const url = 'http://gateway.kugou.com/v2/album_audio/audio';
  return tasks.map(task => createHttp(url, {
    method: 'POST',
    body: JSON.stringify(task),
    headers: {
      'KG-THash': '13a3164',
      'KG-RC': '1',
      'KG-Fake': '0',
      'KG-RF': '00869891',
      'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
      'x-router': 'kmr.service.kugou.com',
      'Content-Type': 'application/json',
    },
  }).then(result => result.map(s => s[0])));
};

const deDuplication = (datas) => {
  const ids = new Set();
  return datas.filter(({ hash }) => {
    if (ids.has(hash)) return false;
    ids.add(hash);
    return true;
  });
};

// hash 列表 → 归一化后的 music-info 列表。
const filterData2 = (rawList) => {
  const ids = new Set();
  const list = [];
  rawList.forEach((item) => {
    if (!item) return;
    if (ids.has(item.audio_info.audio_id)) return;
    ids.add(item.audio_info.audio_id);
    const types = [];
    const _types = {};
    if (item.audio_info.filesize !== '0') {
      const size = sizeFormate(parseInt(item.audio_info.filesize, 10));
      types.push({ type: '128k', size, hash: item.audio_info.hash });
      _types['128k'] = { size, hash: item.audio_info.hash };
    }
    if (item.audio_info.filesize_320 !== '0') {
      const size = sizeFormate(parseInt(item.audio_info.filesize_320, 10));
      types.push({ type: '320k', size, hash: item.audio_info.hash_320 });
      _types['320k'] = { size, hash: item.audio_info.hash_320 };
    }
    if (item.audio_info.filesize_flac !== '0') {
      const size = sizeFormate(parseInt(item.audio_info.filesize_flac, 10));
      types.push({ type: 'flac', size, hash: item.audio_info.hash_flac });
      _types.flac = { size, hash: item.audio_info.hash_flac };
    }
    if (item.audio_info.filesize_high !== '0') {
      const size = sizeFormate(parseInt(item.audio_info.filesize_high, 10));
      types.push({ type: 'flac24bit', size, hash: item.audio_info.hash_high });
      _types.flac24bit = { size, hash: item.audio_info.hash_high };
    }
    list.push({
      singer: decodeName(item.author_name),
      name: decodeName(item.songname),
      albumName: decodeName(item.album_info.album_name),
      albumId: item.album_info.album_id,
      songmid: item.audio_info.audio_id,
      albumAudioId: item.audio_info.audio_group_id,
      source: 'kg',
      interval: formatPlayTime(parseInt(item.audio_info.timelength, 10) / 1000),
      img: null,
      lrc: null,
      hash: item.audio_info.hash,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    });
  });
  return list;
};

const getMusicInfos = async (list) => filterData2(
  await Promise.all(
    createTask(deDuplication(list).map(item => ({ hash: item.hash }))),
  ).then(datas => datas.flat()),
);

// 把用户可能传入的歌单链接 / `id_<specialid>` 收敛成纯数字的 specialid。
const resolvePlaylistId = (id) => {
  const str = String(id);
  if (str.includes('special/single/')) return str.replace(regExps.listDetailLink, '$1');
  return str.replace(/^id_/, '');
};

// 歌单搜索结果条目 → 洛雪歌单记录。
const filterList = (rawData) => rawData.map(item => ({
  play_count: item.total_play_count || formatPlayCount(item.play_count),
  id: 'id_' + item.specialid,
  author: item.nickname,
  name: item.specialname,
  img: item.img || item.imgurl,
  total: item.songcount,
  grade: item.grade,
  desc: item.intro,
  source: 'kg',
}));

module.exports = {
  LIMIT_SONG,
  filterList,
  /** 按 specialid 拉取整张歌单（yueku 单页 HTML）。 */
  async getListDetailBySpecialId(id, page, tryNum = 0) {
    if (tryNum > 2) throw new Error('try max num');

    const { body } = await httpFetch(getSongListDetailUrl(id)).promise;
    const listData = body.match(regExps.listData);
    const listInfo = body.match(regExps.listInfo);
    if (!listData) return this.getListDetailBySpecialId(id, page, ++tryNum);
    const list = await getMusicInfos(JSON.parse(listData[1]));
    let name;
    let pic;
    if (listInfo) {
      name = listInfo[1];
      pic = listInfo[2];
    }
    const desc = parseHtmlDesc(body);
    return {
      list,
      page: 1,
      limit: list.length,
      total: list.length,
      source: 'kg',
      info: { name, img: pic, desc },
    };
  },
  /** 拉取歌单曲目。page 从 1 起；上游一次返回整张，这里按 page/limit 切片让 Omni 分页语义一致。 */
  async getListDetail(id, page = 1, limit = LIMIT_SONG, tryNum = 0) {
    const specialId = resolvePlaylistId(id);
    const result = await this.getListDetailBySpecialId(specialId, page, tryNum);
    const start = (page - 1) * limit;
    return {
      ...result,
      list: result.list.slice(start, start + limit),
      page,
      limit,
    };
  },
  /** 搜索歌单（不是单曲）。page 从 1 起。 */
  search(text, page = 1, limit = 20) {
    return httpFetch(
      'http://msearchretry.kugou.com/api/v3/search/special?keyword=' + encodeURIComponent(text)
      + `&page=${page}&pagesize=${limit}&showtype=10&filter=0&version=7910&sver=2`,
    ).promise.then(({ body }) => {
      if (body.errcode != 0) throw new Error('filed');
      return {
        list: body.data.info.map(item => ({
          play_count: formatPlayCount(item.playcount),
          id: 'id_' + item.specialid,
          author: item.nickname,
          name: item.specialname,
          img: item.imgurl,
          grade: item.grade,
          desc: item.intro,
          total: item.songcount,
          source: 'kg',
        })),
        limit,
        total: body.data.total,
        source: 'kg',
      };
    });
  },
  _internal: { filterList, filterData2, resolvePlaylistId },
};
