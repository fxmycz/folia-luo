// electron/lxSource/musicSdk/platforms/kw/lyric.cjs
// 酷我（kw）内置歌词。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/kw/lyric.js
// （文件底部生效的实现，顶部已废弃的 songinfoandlrc / newlyric 版本不移植）。
// 与洛雪的差异：`httpFetch` 结果里 `raw` 是字符串（洛雪是 Buffer），故歌词解码改用 `rawBuffer`。

const { httpFetch } = require('../../request.cjs');
const { decodeName } = require('../../utils.cjs');
const { decodeLyric, lrcTools } = require('./util.cjs');

const timeExp = /^\[([\d:.]*)\]{1}/g;
const existTimeExp = /\[\d{1,2}:.*\d{1,4}]/;
const lyricxTag = /^<-?\d+,-?\d+>/;

const kwLyric = {
    sortLrcArr(arr) {
        const lrcSet = new Set();
        const lrc = [];
        const lrcT = [];

        let isLyricx = false;
        for (const item of arr) {
            if (lrcSet.has(item.time)) {
                if (lrc.length < 2) continue;
                const tItem = lrc.pop();
                tItem.time = lrc[lrc.length - 1].time;
                lrcT.push(tItem);
                lrc.push(item);
            } else {
                lrc.push(item);
                lrcSet.add(item.time);
            }
            if (!isLyricx && lyricxTag.test(item.text)) isLyricx = true;
        }

        if (!isLyricx && lrcT.length > lrc.length * 0.3 && lrc.length - lrcT.length > 6) {
            throw new Error('failed');
        }

        return {
            lrc,
            lrcT,
        };
    },
    transformLrc(tags, lrclist) {
        return `${tags.join('\n')}\n${lrclist ? lrclist.map(l => `[${l.time}]${l.text}\n`).join('') : '暂无歌词'}`;
    },
    parseLrc(lrc) {
        const lines = lrc.split(/\r\n|\r|\n/);
        const tags = [];
        const lrcArr = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const result = timeExp.exec(line);
            if (result) {
                const text = line.replace(timeExp, '').trim();
                let time = RegExp.$1;
                if (/\.\d\d$/.test(time)) time += '0';
                lrcArr.push({
                    time,
                    text,
                });
            } else if (lrcTools.rxps.tagLine.test(line)) {
                tags.push(line);
            }
        }
        const lrcInfo = this.sortLrcArr(lrcArr);
        return {
            lyric: decodeName(this.transformLrc(tags, lrcInfo.lrc)),
            tlyric: lrcInfo.lrcT.length ? decodeName(this.transformLrc(tags, lrcInfo.lrcT)) : '',
        };
    },
    getLyric(musicInfo, isGetLyricx = true) {
        return httpFetch(`http://mlyric.kuwo.cn/mobi.s?f=web&type=lyric&lrcx=${isGetLyricx ? 1 : 0}&rid=${musicInfo.songmid}&encode=utf8`).promise
            .then(async ({ statusCode, body, rawBuffer }) => {
                if (statusCode != 200) return Promise.reject(new Error(JSON.stringify(body)));
                // 接口响应是 gzip / 异或密文，必须用二进制 rawBuffer 交给 decodeLyric。
                const lrcText = await decodeLyric(rawBuffer, isGetLyricx);
                let lrcInfo;
                try {
                    lrcInfo = this.parseLrc(lrcText);
                } catch {
                    return Promise.reject(new Error('Get lyric failed'));
                }
                if (lrcInfo.tlyric) lrcInfo.tlyric = lrcInfo.tlyric.replace(lrcTools.rxps.wordTimeAll, '');
                try {
                    lrcInfo.lxlyric = lrcTools.parse(lrcInfo.lyric);
                } catch {
                    lrcInfo.lxlyric = '';
                }
                lrcInfo.lyric = lrcInfo.lyric.replace(lrcTools.rxps.wordTimeAll, '');
                if (!existTimeExp.test(lrcInfo.lyric)) return Promise.reject(new Error('Get lyric failed'));
                return lrcInfo;
            });
    },
};

module.exports = {
    getLyric(musicInfo, isGetLyricx = true) {
        return kwLyric.getLyric(musicInfo, isGetLyricx);
    },
};
