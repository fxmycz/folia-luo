import type { SongResult } from '../../types';
import { getPic } from '../sdk';
import { resolveLuoxueSource } from '../model/luoxueSong';
import { getBrowsePlatform } from './activeSource';

// src/luoxue/provider/coverHydration.ts
// 洛雪歌曲的封面补齐：lx 各音源的搜索 / 榜单结果里 `img` 往往是空的（封面要用音源自己的取图接口另外取），
// 而 folia 的播放界面与歌词页只认 `SongResult.album.coverUrl`，所以歌曲进列表、开播前都要把它补上。
// 取到的地址写回歌曲对象本身——列表持有的就是播放时用的那个对象，因此不需要再回写 store 触发渲染。

/** 同一首歌只取一次图：缓存的是 Promise，并发调用会共用同一个请求。 */
const coverTasks = new Map<string, Promise<string>>();

/** 后台补齐的并发数：太大容易触发音源限流，太小遇上长榜单会拖很久。 */
const COVER_CONCURRENCY = 3;

/** 歌曲唯一键（音源 + 主键） */
const coverKey = (song: SongResult, lxSource: string): string => {
    const mediaId = song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id;
    return `${lxSource}:${String(mediaId)}`;
};

/** 读取歌曲自带封面。 */
const readCover = (song: SongResult): string => song.album?.coverUrl ?? '';

/** 取一首歌的封面并写回歌曲；已有封面或取不到时原样返回。 */
export const ensureLuoxueSongCover = async (song: SongResult): Promise<SongResult> => {
    if (!song || readCover(song)) return song;
    const { lxSource, info } = resolveLuoxueSource(song, getBrowsePlatform());
    if (!info) return song;
    const key = coverKey(song, lxSource);
    let task = coverTasks.get(key);
    if (!task) {
        task = getPic(lxSource, info).catch(() => '');
        coverTasks.set(key, task);
    }
    const url = await task;
    if (!url || readCover(song)) return song;
    // 直接补在歌曲对象上：列表与播放队列用的是同一个对象，播放时就能取到封面。
    song.album = { ...(song.album ?? { id: `${song.id}#album`, name: '' }), coverUrl: url };
    return song;
};

/** 后台补齐一批歌曲的封面（不阻塞调用方，只在板上取图接口返回前延迟一点可见）。 */
export const hydrateLuoxueCovers = (songs: SongResult[]): void => {
    const queue = songs.filter(song => song && !readCover(song));
    if (!queue.length) return;
    void (async () => {
        let index = 0;
        const workers = Array.from({ length: Math.min(COVER_CONCURRENCY, queue.length) }, async () => {
            while (index < queue.length) {
                await ensureLuoxueSongCover(queue[index++]);
            }
        });
        await Promise.all(workers);
    })();
};
