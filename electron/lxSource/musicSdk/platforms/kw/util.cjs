// electron/lxSource/musicSdk/platforms/kw/util.cjs
// 酷我（kw）平台专用工具：榜单接口 AES-128-ECB 加解密与请求签名，歌词接口 gzip 解压 / yeelion 异或解码与 lrcTools。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kw/util.js。

const { createCipheriv, createDecipheriv } = require('node:crypto');
const { inflate } = require('node:zlib');
const { toMD5 } = require('../../utils.cjs');

const createAesEncrypt = (buffer, mode, key, iv) => {
  const cipher = createCipheriv(mode, key, iv);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
};

const createAesDecrypt = (buffer, mode, key, iv) => {
  const decipher = createDecipheriv(mode, key, iv);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
};

const wbdCrypto = {
  aesMode: 'aes-128-ecb',
  aesKey: Buffer.from([112, 87, 39, 61, 199, 250, 41, 191, 57, 68, 45, 114, 221, 94, 140, 228], 'binary'),
  aesIv: '',
  appId: 'y67sprxhhpws',
  decodeData(base64Result) {
    const data = Buffer.from(decodeURIComponent(base64Result), 'base64');
    return JSON.parse(createAesDecrypt(data, this.aesMode, this.aesKey, this.aesIv).toString());
  },
  createSign(data, time) {
    return toMD5(`${this.appId}${data}${time}`).toUpperCase();
  },
  buildParam(jsonData) {
    const data = Buffer.from(JSON.stringify(jsonData));
    const time = Date.now();
    const encodeData = createAesEncrypt(data, this.aesMode, this.aesKey, this.aesIv).toString('base64');
    const sign = this.createSign(encodeData, time);
    return `data=${encodeURIComponent(encodeData)}&time=${time}&appId=${this.appId}&sign=${sign}`;
  },
};

/** 酷我把多歌手用 `&` 连接，统一换成「、」好让归一化按分隔符拆。 */
const formatSinger = (rawData) => String(rawData ?? '').replace(/&/g, '、');

/** 酷我搜索接口返回的是单引号包裹的类 JSON，先转成标准 JSON。 */
const objStr2JSON = (str) => JSON.parse(str.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"'));

/** 酷我歌词接口响应体是 gzip 压缩流，它只给回调式 inflate，这里包成 Promise。 */
const handleInflate = (data) => new Promise((resolve, reject) => {
    inflate(data, (err, result) => {
        if (err) {
            reject(err);
            return;
        }
        resolve(result);
    });
});

const buf_key = Buffer.from('yeelion');
const buf_key_len = buf_key.length;

/** 酷我歌词解码：先 gzip 解压；lrcx 时正文是 base64 的异或密文，用 `yeelion` 逐字节还原。 */
const decodeLyric = async (rawData, isGetLyricx) => {
    const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
    if (buf.toString('utf8', 0, 10).toLowerCase() !== 'tp=content') return '';
    const lrcData = await handleInflate(buf.subarray(buf.indexOf('\r\n\r\n') + 4));
    if (!isGetLyricx) return lrcData.toString('utf8');
    const buf_str = Buffer.from(lrcData.toString(), 'base64');
    const buf_str_len = buf_str.length;
    const output = new Uint8Array(buf_str_len);
    let i = 0;
    while (i < buf_str_len) {
        let j = 0;
        while (j < buf_key_len && i < buf_str_len) {
            output[i] = buf_str[i] ^ buf_key[j];
            i++;
            j++;
        }
    }

    return Buffer.from(output).toString('utf8');
};

/** 酷我 lrcx（逐字）歌词工具：把 `<offset,offset2>` 逐字时间轴换算成洛雪的 `<开始,时长>` 格式。 */
const lrcTools = {
    rxps: {
        wordLine: /^(\[\d{1,2}:.*\d{1,4}])\s*(\S+(?:\s+\S+)*)?\s*/,
        tagLine: /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*]/,
        wordTimeAll: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g,
        wordTime: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/,
    },
    offset: 1,
    offset2: 1,
    isOK: false,
    lines: [],
    tags: [],
    getWordInfo(str, str2, prevWord) {
        const offset = parseInt(str);
        const offset2 = parseInt(str2);
        let startTime = Math.trunc(Math.abs((offset + offset2) / (this.offset * 2)));
        let endTime = Math.trunc(Math.abs((offset - offset2) / (this.offset2 * 2)) + startTime);
        if (prevWord) {
            if (startTime < prevWord.endTime) {
                prevWord.endTime = startTime;
                if (prevWord.startTime > prevWord.endTime) {
                    prevWord.startTime = prevWord.endTime;
                }

                prevWord.newTimeStr = `<${prevWord.startTime},${Math.trunc(prevWord.endTime - prevWord.startTime)}>`;
            }
        }
        return {
            startTime,
            endTime,
            timeStr: `<${startTime},${Math.trunc(endTime - startTime)}>`,
        };
    },
    parseLine(line) {
        if (line.length < 6) return;
        let result = this.rxps.wordLine.exec(line);
        if (result) {
            const time = result[1];
            let words = result[2];
            if (words == null) {
                words = '';
            }
            const wordTimes = words.match(this.rxps.wordTimeAll);
            if (!wordTimes) return;
            let preTimeInfo;
            for (const timeStr of wordTimes) {
                const wordTimeResult = this.rxps.wordTime.exec(timeStr);
                const wordInfo = this.getWordInfo(wordTimeResult[1], wordTimeResult[2], preTimeInfo);
                words = words.replace(timeStr, wordInfo.timeStr);
                if (preTimeInfo?.newTimeStr) words = words.replace(preTimeInfo.timeStr, preTimeInfo.newTimeStr);
                preTimeInfo = wordInfo;
            }
            this.lines.push(time + words);
            return;
        }
        result = this.rxps.tagLine.exec(line);
        if (!result) return;
        if (result[1] == 'kuwo') {
            let content = result[2];
            if (content != null && content.includes('][')) {
                content = content.substring(0, content.indexOf(']['));
            }
            const valueOf = parseInt(content, 8);
            this.offset = Math.trunc(valueOf / 10);
            this.offset2 = Math.trunc(valueOf % 10);
            if (this.offset == 0 || Number.isNaN(this.offset) || this.offset2 == 0 || Number.isNaN(this.offset2)) {
                this.isOK = false;
            }
        } else {
            this.tags.push(line);
        }
    },
    parse(lrc) {
        const lines = lrc.split(/\r\n|\r|\n/);
        const tools = Object.create(this);
        tools.isOK = true;
        tools.offset = 1;
        tools.offset2 = 1;
        tools.lines = [];
        tools.tags = [];

        for (const line of lines) {
            if (!tools.isOK) throw new Error('failed');
            tools.parseLine(line);
        }
        if (!tools.lines.length) return '';
        let lrcs = tools.lines.join('\n');
        if (tools.tags.length) lrcs = `${tools.tags.join('\n')}\n${lrcs}`;
        return lrcs;
    },
};

module.exports = { wbdCrypto, formatSinger, objStr2JSON, decodeLyric, lrcTools };
