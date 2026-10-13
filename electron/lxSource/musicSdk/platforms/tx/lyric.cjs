// electron/lxSource/musicSdk/platforms/tx/lyric.cjs
// QQ 音乐（tx）内置歌词。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/lyric.js，
// 把洛雪 `{ promise, cancelHttp }` 的调用契约展平成直接返回 Promise。

const { httpFetch } = require('../../request.cjs');
const getMusicInfo = require('./musicInfo.cjs');
const { decodeQrc } = require('./qrcDecode.cjs');

const songIdMap = new Map();
const promises = new Map();

// 内部辅助：解码 qrc / 逐字 / 罗马音歌词（原为洛雪的 `export const decodeLyric`，此处仅模块内部使用）。
const decodeLyric = async (lrc, tlrc, rlrc) => ({
    lyric: await decodeQrc(lrc),
    tlyric: await decodeQrc(tlrc),
    rlyric: await decodeQrc(rlrc),
});

const successCode = 0;

const parseTools = {
    rxps: {
        info: /^{"/,
        lineTime: /^\[(\d+),\d+\]/,
        lineTime2: /^\[([\d:.]+)\]/,
        wordTime: /\(\d+,\d+\)/,
        wordTimeAll: /(\(\d+,\d+\))/g,
        timeLabelFixRxp: /(?:\.0+|0+)$/,
    },
    msFormat(timeMs) {
        if (Number.isNaN(timeMs)) return '';
        let ms = (timeMs % 1000).toString().padStart(3, '0');
        timeMs /= 1000;
        let m = parseInt(timeMs / 60).toString().padStart(2, '0');
        timeMs %= 60;
        let s = parseInt(timeMs).toString().padStart(2, '0');
        return `[${m}:${s}.${ms}]`;
    },
    parseLyric(lrc) {
        lrc = lrc.trim();
        lrc = lrc.replace(/\r/g, '');
        if (!lrc) return { lyric: '', lxlyric: '' };
        const lines = lrc.split('\n');

        const lxlrcLines = [];
        const lrcLines = [];

        for (let line of lines) {
            line = line.trim();
            let result = this.rxps.lineTime.exec(line);
            if (!result) {
                if (line.startsWith('[offset')) {
                    lxlrcLines.push(line);
                    lrcLines.push(line);
                }
                if (this.rxps.lineTime2.test(line)) {
                    // lxlrcLines.push(line)
                    lrcLines.push(line);
                }
                continue;
            }

            const startMsTime = parseInt(result[1]);
            const startTimeStr = this.msFormat(startMsTime);
            if (!startTimeStr) continue;

            let words = line.replace(this.rxps.lineTime, '');

            lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, '')}`);

            let times = words.match(this.rxps.wordTimeAll);
            if (!times) continue;
            times = times.map((time) => {
                const result = /\((\d+),(\d+)\)/.exec(time);
                return `<${Math.trunc(Math.max(parseInt(result[1]) - startMsTime, 0))},${result[2]}>`;
            });
            const wordArr = words.split(this.rxps.wordTime);
            const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join('');
            lxlrcLines.push(`${startTimeStr}${newWords}`);
        }
        return {
            lyric: lrcLines.join('\n'),
            lxlyric: lxlrcLines.join('\n'),
        };
    },
    parseRlyric(lrc) {
        lrc = lrc.trim();
        lrc = lrc.replace(/\r/g, '');
        if (!lrc) return { lyric: '', lxlyric: '' };
        const lines = lrc.split('\n');

        const lrcLines = [];

        for (let line of lines) {
            line = line.trim();
            let result = this.rxps.lineTime.exec(line);
            if (!result) continue;

            const startMsTime = parseInt(result[1]);
            const startTimeStr = this.msFormat(startMsTime);
            if (!startTimeStr) continue;

            let words = line.replace(this.rxps.lineTime, '');

            lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, '')}`);
        }
        return lrcLines.join('\n');
    },
    removeTag(str) {
        return str.replace(/^[\S\s]*?LyricContent="/, '').replace(/"\/>[\S\s]*?$/, '');
    },
    getIntv(interval) {
        if (!interval) return 0;
        if (!interval.includes('.')) interval += '.0';
        let arr = interval.split(/:|\./);
        while (arr.length < 3) arr.unshift('0');
        const [m, s, ms] = arr;
        return parseInt(m) * 3600000 + parseInt(s) * 1000 + parseInt(ms);
    },
    fixRlrcTimeTag(rlrc, lrc) {
        const rlrcLines = rlrc.split('\n');
        let lrcLines = lrc.split('\n');
        let newLrc = [];
        rlrcLines.forEach((line) => {
            const result = this.rxps.lineTime2.exec(line);
            if (!result) return;
            const words = line.replace(this.rxps.lineTime2, '');
            if (!words.trim()) return;
            const t1 = this.getIntv(result[1]);

            while (lrcLines.length) {
                const lrcLine = lrcLines.shift();
                const lrcLineResult = this.rxps.lineTime2.exec(lrcLine);
                if (!lrcLineResult) continue;
                const t2 = this.getIntv(lrcLineResult[1]);
                if (Math.abs(t1 - t2) < 100) {
                    newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0]));
                    break;
                }
            }
        });
        return newLrc.join('\n');
    },
    fixTlrcTimeTag(tlrc, lrc) {
        const tlrcLines = tlrc.split('\n');
        let lrcLines = lrc.split('\n');
        let newLrc = [];
        tlrcLines.forEach((line) => {
            const result = this.rxps.lineTime2.exec(line);
            if (!result) return;
            const words = line.replace(this.rxps.lineTime2, '');
            if (!words.trim()) return;
            let time = result[1];
            if (time.includes('.')) {
                time += ''.padStart(3 - time.split('.')[1].length, '0');
            }
            const t1 = this.getIntv(time);

            while (lrcLines.length) {
                const lrcLine = lrcLines.shift();
                const lrcLineResult = this.rxps.lineTime2.exec(lrcLine);
                if (!lrcLineResult) continue;
                const t2 = this.getIntv(lrcLineResult[1]);
                if (Math.abs(t1 - t2) < 100) {
                    newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0]));
                    break;
                }
            }
        });
        return newLrc.join('\n');
    },
    parse(lrc, tlrc, rlrc) {
        const info = {
            lyric: '',
            tlyric: '',
            rlyric: '',
            lxlyric: '',
        };
        if (lrc) {
            let { lyric, lxlyric } = this.parseLyric(this.removeTag(lrc));
            info.lyric = lyric;
            info.lxlyric = lxlyric;
        }
        if (rlrc) info.rlyric = this.fixRlrcTimeTag(this.parseRlyric(this.removeTag(rlrc)), info.lyric);
        if (tlrc) info.tlyric = this.fixTlrcTimeTag(tlrc, info.lyric);

        return info;
    },
};

async function getSongId({ songId, songmid }) {
    if (songId) return songId;
    if (songIdMap.has(songmid)) return songIdMap.get(songmid);
    if (promises.has(songmid)) return (await promises.get(songmid)).songId;
    const promise = getMusicInfo(songmid);
    // 洛雪原代码为 `promises.set(promise)`（漏传 key，属其自身笔误），这里补上 songmid 作为 key，
    // 并与上面 `promises.get(songmid)` 的读取方式对应。
    promises.set(songmid, promise);
    const info = await promise;
    songIdMap.set(songmid, info.songId);
    promises.delete(songmid);
    return info.songId;
}

const parseLyric = async (lrc, tlrc, rlrc) => {
    const { lyric, tlyric, rlyric } = await decodeLyric(lrc, tlrc, rlrc);
    return parseTools.parse(lyric, tlyric, rlyric);
};

function getLyric(mInfo, retryNum = 0) {
    if (retryNum > 3) return Promise.reject(new Error('Get lyric failed'));

    return getSongId(mInfo).then((songId) => {
        const requestObj = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
            method: 'post',
            headers: {
                referer: 'https://y.qq.com',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                comm: {
                    ct: '19',
                    cv: '1859',
                    uin: '0',
                },
                req: {
                    method: 'GetPlayLyricInfo',
                    module: 'music.musichallSong.PlayLyricInfo',
                    param: {
                        format: 'json',
                        crypt: 1,
                        ct: 19,
                        cv: 1873,
                        interval: 0,
                        lrc_t: 0,
                        qrc: 1,
                        qrc_t: 0,
                        roma: 1,
                        roma_t: 0,
                        songID: songId,
                        trans: 1,
                        trans_t: 0,
                        type: -1,
                    },
                },
            }),
        });
        return requestObj.promise.then(({ body }) => {
            // console.log(body)
            // 洛雪原代码此处为 `this.getLyric(songId, ++retryNum)`，重试时误传 number 而非 songInfo（笔误），
            // 改为回传 mInfo 以匹配 getSongId({ songId, songmid }) 的入参。
            if (body.code != successCode || body.req.code != successCode) return getLyric(mInfo, ++retryNum);
            const data = body.req.data;
            return parseLyric(data.lyric, data.trans, data.roma);
        });
    });
}

module.exports = {
    getLyric(songInfo) {
        return getLyric(songInfo);
    },
};
