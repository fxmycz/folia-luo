// electron/lxSource/musicSdk/platforms/kg/decodeKrc.cjs
// 酷狗（kg）KRC 歌词解码。
// 移植自 lx-music-desktop（Apache-2.0）src/common/utils/lyricUtils/kg.js 与 src/renderer/utils/musicSdk/kg/lyric.js，
// decodeLyric / parseLyric / decodeKrc 逻辑与正则、密钥保持一致，inflate 改用 node:zlib。

const { inflate } = require('node:zlib');
const { decodeName } = require('../../utils.cjs');

// https://github.com/lyswhut/lx-music-desktop/issues/296#issuecomment-683285784
const enc_key = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69], 'binary');
const decodeLyric = (str) => new Promise((resolve, reject) => {
  if (!str.length) return;
  const buf_str = Buffer.from(str, 'base64').subarray(4);
  for (let i = 0, len = buf_str.length; i < len; i++) {
    buf_str[i] = buf_str[i] ^ enc_key[i % 16];
  }
  inflate(buf_str, (err, result) => {
    if (err) return reject(err);
    resolve(result.toString());
  });
});

const headExp = /^.*\[id:\$\w+\]\n/;

const parseLyric = (str) => {
  str = str.replace(/\r/g, '');
  if (headExp.test(str)) str = str.replace(headExp, '');
  const trans = str.match(/\[language:([\w=\\/+]+)\]/);
  let lyric;
  let rlyric;
  let tlyric;
  if (trans) {
    str = str.replace(/\[language:[\w=\\/+]+\]\n/, '');
    const json = JSON.parse(Buffer.from(trans[1], 'base64').toString());
    for (const item of json.content) {
      switch (item.type) {
        case 0:
          rlyric = item.lyricContent;
          break;
        case 1:
          tlyric = item.lyricContent;
          break;
      }
    }
  }
  let i = 0;
  let lxlyric = str.replace(/\[((\d+),\d+)\].*/g, (str) => {
    const result = str.match(/\[((\d+),\d+)\].*/);
    let time = parseInt(result[2]);
    const ms = (time % 1000).toString().padStart(3, '0');
    time /= 1000;
    const m = parseInt(time / 60).toString().padStart(2, '0');
    time %= 60;
    const s = parseInt(time).toString().padStart(2, '0');
    time = `${m}:${s}.${ms}`;
    if (rlyric) rlyric[i] = `[${time}]${rlyric[i]?.join('') ?? ''}`;
    if (tlyric) tlyric[i] = `[${time}]${tlyric[i]?.join('') ?? ''}`;
    i++;
    return str.replace(result[1], time);
  });
  rlyric = rlyric ? rlyric.join('\n') : '';
  tlyric = tlyric ? tlyric.join('\n') : '';
  lxlyric = lxlyric.replace(/<(\d+,\d+),\d+>/g, '<$1>');
  lxlyric = decodeName(lxlyric);
  lyric = lxlyric.replace(/<\d+,\d+>/g, '');
  rlyric = decodeName(rlyric);
  tlyric = decodeName(tlyric);
  return {
    lyric,
    tlyric,
    rlyric,
    lxlyric,
  };
};

const decodeKrc = async (data) => {
  return decodeLyric(data).then(parseLyric);
};

module.exports = { decodeKrc };
