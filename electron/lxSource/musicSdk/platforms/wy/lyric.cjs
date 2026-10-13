// electron/lxSource/musicSdk/platforms/wy/lyric.cjs
// 网易云（wy）内置歌词。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/wy/lyric.js
// （文件底部生效的 eapiRequest + parseTools + fixTimeLabel 实现，顶部已废弃的 linuxapi 版本不移植）。

const { httpFetch } = require('../../request.cjs');
const { eapi } = require('./crypto.cjs');

const eapiRequest = (url, data) => httpFetch('https://interface3.music.163.com/eapi/song/lyric/v1', {
    method: 'post',
    headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
        origin: 'https://music.163.com',
    },
    form: eapi(url, data),
});

const parseTools = {
    rxps: {
        info: /^{"/,
        lineTime: /^\[(\d+),\d+\]/,
        wordTime: /\(\d+,\d+,\d+\)/,
        wordTimeAll: /(\(\d+,\d+,\d+\))/g,
        timeMs2: /\[\d+:\d+\.\d{2}]/,
        timeMs3: /\[\d+:\d+\.\d{3}]/,
    },
    msFormat(timeMs, pad3 = true) {
        // 洛雪原版只判 `Number.isNaN(timeMs)`，遇到缺 `t` 字段的 JSON 歌词行会输出 `[NaN:NaN.NaN]`；
        // 这里收紧为「非数值即丢弃」，避免把坏时间轴渲染出来。
        if (Number.isNaN(Number(timeMs))) return '';
        let ms = (timeMs % 1000).toString().padStart(pad3 ? 3 : 2, '0');
        if (!pad3 && ms.length > 2) ms = ms.slice(0, 2);
        timeMs /= 1000;
        let m = parseInt(timeMs / 60).toString().padStart(2, '0');
        timeMs %= 60;
        let s = parseInt(timeMs).toString().padStart(2, '0');
        return `[${m}:${s}.${ms}]`;
    },
    parseLyric(lines) {
        const lxlrcLines = [];
        const lrcLines = [];

        for (let line of lines) {
            line = line.trim();
            const lineTimeResult = this.rxps.lineTime.exec(line);
            if (!lineTimeResult) {
                if (line.startsWith('[offset')) {
                    lxlrcLines.push(line);
                    lrcLines.push(line);
                }
                continue;
            }

            const startMsTime = parseInt(lineTimeResult[1]);
            const startTimeStr = this.msFormat(startMsTime);
            if (!startTimeStr) continue;

            let words = line.replace(this.rxps.lineTime, '');

            lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, '')}`);

            let times = words.match(this.rxps.wordTimeAll);
            if (!times) continue;
            times = times.map((time) => {
                const result = /\((\d+),(\d+),\d+\)/.exec(time);
                return `<${Math.trunc(Math.max(parseInt(result[1]) - startMsTime, 0))},${result[2]}>`;
            });
            const wordArr = words.split(this.rxps.wordTime);
            wordArr.shift();
            const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join('');
            lxlrcLines.push(`${startTimeStr}${newWords}`);
        }
        return {
            lyric: lrcLines.join('\n'),
            lxlyric: lxlrcLines.join('\n'),
        };
    },
    parseHeaderInfo(str) {
        str = str.trim();
        str = str.replace(/\r/g, '');
        if (!str) return null;
        const isPad3 = this.rxps.timeMs3.test(str) || !this.rxps.timeMs2.test(str);
        const lines = str.split('\n');
        return lines.map((line) => {
            if (!this.rxps.info.test(line)) return line;
            try {
                const info = JSON.parse(line);
                const timeTag = this.msFormat(info.t, isPad3);
                return timeTag ? `${timeTag}${info.c.map(t => t.tx).join('')}` : '';
            } catch {
                return '';
            }
        });
    },
    getIntv(interval) {
        if (!interval) return 0;
        if (!interval.includes('.')) interval += '.0';
        const arr = interval.split(/:|\./);
        while (arr.length < 3) arr.unshift('0');
        const [m, s, ms] = arr;
        return parseInt(m) * 3600000 + parseInt(s) * 1000 + parseInt(ms);
    },
    fixTimeTag(lrc, targetlrc) {
        let lrcLines = lrc.split('\n');
        const targetlrcLines = targetlrc.split('\n');
        const timeRxp = /^\[([\d:.]+)\]/;
        let temp = [];
        const newLrc = [];
        targetlrcLines.forEach((line) => {
            const result = timeRxp.exec(line);
            if (!result) return;
            const words = line.replace(timeRxp, '');
            if (!words.trim()) return;
            const t1 = this.getIntv(result[1]);

            while (lrcLines.length) {
                const lrcLine = lrcLines.shift();
                const lrcLineResult = timeRxp.exec(lrcLine);
                if (!lrcLineResult) continue;
                const t2 = this.getIntv(lrcLineResult[1]);
                if (Math.abs(t1 - t2) < 100) {
                    const lrc = line.replace(timeRxp, lrcLineResult[0]).trim();
                    if (!lrc) continue;
                    newLrc.push(lrc);
                    break;
                }
                temp.push(lrcLine);
            }
            lrcLines = [...temp, ...lrcLines];
            temp = [];
        });
        return newLrc.join('\n');
    },
    parse(ylrc, ytlrc, yrlrc, lrc, tlrc, rlrc) {
        const info = {
            lyric: '',
            tlyric: '',
            rlyric: '',
            lxlyric: '',
        };
        if (ylrc) {
            let lines = this.parseHeaderInfo(ylrc);
            if (lines) {
                const result = this.parseLyric(lines);
                if (ytlrc) {
                    const tlrcLines = this.parseHeaderInfo(ytlrc);
                    if (tlrcLines) {
                        info.tlyric = this.fixTimeTag(result.lyric, tlrcLines.join('\n'));
                    }
                }
                if (yrlrc) {
                    const rlrcLines = this.parseHeaderInfo(yrlrc);
                    if (rlrcLines) {
                        info.rlyric = this.fixTimeTag(result.lyric, rlrcLines.join('\n'));
                    }
                }

                const timeRxp = /^\[[\d:.]+\]/;
                const headers = lines.filter(l => timeRxp.test(l)).join('\n');
                info.lyric = `${headers}\n${result.lyric}`;
                info.lxlyric = result.lxlyric;
                return info;
            }
        }
        if (lrc) {
            const lines = this.parseHeaderInfo(lrc);
            if (lines) info.lyric = lines.join('\n');
        }
        if (tlrc) {
            const lines = this.parseHeaderInfo(tlrc);
            if (lines) info.tlyric = lines.join('\n');
        }
        if (rlrc) {
            const lines = this.parseHeaderInfo(rlrc);
            if (lines) info.rlyric = lines.join('\n');
        }

        return info;
    },
};

// 洛雪 issue：部分歌词时间标签是 `[mm:ss:SS]` 而非 `[mm:ss.SS]`，先做归一化。
const fixTimeLabel = (lrc, tlrc, romalrc) => {
    if (lrc) {
        const newLrc = lrc.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, '[$1.$2]');
        const newTlrc = tlrc?.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, '[$1.$2]') ?? tlrc;
        if (newLrc != lrc || newTlrc != tlrc) {
            lrc = newLrc;
            tlrc = newTlrc;
            if (romalrc) romalrc = romalrc.replace(/\[(\d{2}:\d{2}):(\d{2,3})]/g, '[$1.$2]').replace(/\[(\d{2}:\d{2}\.\d{2})0]/g, '[$1]');
        }
    }

    return { lrc, tlrc, romalrc };
};

const getLyric = (songmid) => eapiRequest('/api/song/lyric/v1', {
    id: songmid,
    cp: false,
    tv: 0,
    lv: 0,
    rv: 0,
    kv: 0,
    yv: 0,
    ytv: 0,
    yrv: 0,
}).promise.then(({ body }) => {
    if (body.code !== 200 || !body?.lrc?.lyric) return Promise.reject(new Error('Get lyric failed'));
    const fixTimeLabelLrc = fixTimeLabel(body.lrc.lyric, body.tlyric?.lyric, body.romalrc?.lyric);
    const info = parseTools.parse(body.yrc?.lyric, body.ytlrc?.lyric, body.yromalrc?.lyric, fixTimeLabelLrc.lrc, fixTimeLabelLrc.tlrc, fixTimeLabelLrc.romalrc);
    if (!info.lyric) return Promise.reject(new Error('Get lyric failed'));
    return info;
});

module.exports = {
    getLyric(songInfo) {
        return getLyric(songInfo.songmid);
    },
};
