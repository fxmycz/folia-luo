import type { SongResult } from '../../types';
import { LUOXUE_PROVIDER_ID } from '../model/luoxueSong';
import { invalidateMusicUrlCache } from '../sdk';
import { useLuoxueSettingsStore } from '../settings/useLuoxueSettingsStore';

// src/luoxue/provider/quotaPolicy.ts
// 洛雪的自定义音源脚本按次计费（例如每日 300 次，重播同一首不扣点），这里的两条策略都是为了少问脚本：
// 1) 省点模式：不预取歌曲地址。folia 会为队列里前后几首各取一次播放地址（为秒开与无缝衔接设计），
//    落到计费音源上就是每切一首额外扣几点；关掉后只有真正播到那首歌时才取一次。
// 2) 播放出错 / 刷新地址前丢掉缓存地址：没有这一步，刷新拿到的是上次缓存的旧地址，等于白刷一次。

/** 这首歌是否由洛雪版块的 provider 播放（自定义音源脚本的地址都从这里走）。 */
export const isLuoxuePlaybackSong = (song: SongResult): boolean =>
    song.sourceRef?.kind === 'online' && song.sourceRef.providerId === LUOXUE_PROVIDER_ID;

/** 省点模式开关（设置项，默认开）。 */
export const isLuoxueQuotaSaverEnabled = (): boolean => useLuoxueSettingsStore.getState().quotaSaver;

/**
 * 是否跳过这首歌的预取。
 * 只对洛雪歌曲生效：其它 provider 不受影响，folia 原有的预取行为原样保留。
 */
export const shouldSkipLuoxuePrefetch = (song: SongResult): boolean =>
    isLuoxuePlaybackSong(song) && isLuoxueQuotaSaverEnabled();

/** 播放出错或刷新地址前调用：丢掉这首歌缓存的播放地址，让下一次取址真正问一遍音源脚本。 */
export const invalidateLuoxueCachedPlaybackUrl = (song: SongResult): void => {
    if (!isLuoxuePlaybackSong(song)) return;
    const trackId = song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id;
    if (trackId === undefined || trackId === null || trackId === '') return;
    invalidateMusicUrlCache(String(trackId));
};
