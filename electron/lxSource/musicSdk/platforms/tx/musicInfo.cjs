// electron/lxSource/musicSdk/platforms/tx/musicInfo.cjs
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/musicSdk/tx/musicInfo.js
// 适配点：原版用 needle（json: true）自动把对象 body 序列化成 JSON；Folia 的 httpFetch 只发原始字符串，
// 故这里显式 JSON.stringify 并补上 Content-Type: application/json。

const { httpFetch } = require('../../request.cjs');
const { formatPlayTime, sizeFormate } = require('../../utils.cjs');

const getSinger = (singers) => {
    const arr = [];
    singers.forEach((singer) => {
        arr.push(singer.name);
    });
    return arr.join('、');
};

module.exports = (songmid) => {
    const requestObj = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'post',
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            comm: {
                ct: '19',
                cv: '1859',
                uin: '0',
            },
            req: {
                module: 'music.pf_song_detail_svr',
                method: 'get_song_detail_yqq',
                param: {
                    song_type: 0,
                    song_mid: songmid,
                },
            },
        }),
    });
    return requestObj.promise.then(({ body }) => {
        // console.log(body)
        if (body.code != 0 || body.req.code != 0) return Promise.reject(new Error('获取歌曲信息失败'));
        const item = body.req.data.track_info;
        if (!item.file?.media_mid) return null;

        const types = [];
        const _types = {};
        const file = item.file;
        if (file.size_128mp3 != 0) {
            const size = sizeFormate(file.size_128mp3);
            types.push({ type: '128k', size });
            _types['128k'] = {
                size,
            };
        }
        if (file.size_320mp3 !== 0) {
            const size = sizeFormate(file.size_320mp3);
            types.push({ type: '320k', size });
            _types['320k'] = {
                size,
            };
        }
        if (file.size_flac !== 0) {
            const size = sizeFormate(file.size_flac);
            types.push({ type: 'flac', size });
            _types.flac = {
                size,
            };
        }
        if (file.size_hires !== 0) {
            const size = sizeFormate(file.size_hires);
            types.push({ type: 'flac24bit', size });
            _types.flac24bit = {
                size,
            };
        }
        // types.reverse()
        let albumId = '';
        let albumName = '';
        if (item.album) {
            albumName = item.album.name;
            albumId = item.album.mid;
        }
        return {
            singer: getSinger(item.singer),
            name: item.title,
            albumName,
            albumId,
            source: 'tx',
            interval: formatPlayTime(item.interval),
            songId: item.id,
            albumMid: item.album?.mid ?? '',
            strMediaMid: item.file.media_mid,
            songmid: item.mid,
            img: (albumId === '' || albumId === '空')
                ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : ''
                : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
            types,
            _types,
            typeUrl: {},
        };
    });
};
