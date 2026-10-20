import type { OnlineProviderId } from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { LUOXUE_PROVIDER_ID } from '../model/luoxueSong';

// src/luoxue/provider/activeProviderGuard.ts
// 洛雪在 folia 的在线音乐注册表里登记了一个 provider（播放取址靠它：folia 按歌曲自己的 sourceRef.providerId
// 找 provider），但 folia 的「当前在线平台」（useOnlineProviderAccountStore.activeProviderId）是给原生平台用的：
// 一旦它变成洛雪，首页三个在线页签——歌单 / 电台 / 专辑——就会按「洛雪暂未提供歌单库 / 推荐内容 / 用户专辑库」
// 被禁用（看起来就是「页签锁了、点不动」）。
// 而它确实会变成洛雪：useSessionRestoreController 会按「上一首播放歌曲的 providerId」对齐当前平台并落盘
// （localStorage 的 active_online_provider_id），所以只要播过一次洛雪的歌，重启后三个页签一直是锁的。
// 平台切换器那边不用管：它对 availability.reason === 'runtime-unavailable' 的 provider 直接过滤（洛雪不在列表里）。
//
// 这个守卫把「当前在线平台」钉在洛雪之外：启动时纠正一次已落盘的值，之后一旦被改成立刻退回上一个非洛雪平台。
// 上一个平台记在自己的键里（比死写 netease 忠实：原来是酷狗就退回酷狗）。
// 播放不受影响 —— 取播放地址走歌曲自己的 sourceRef，不读这个「当前平台」。

const FALLBACK_KEY = 'luoxue_active_provider_fallback';
const DEFAULT_PROVIDER_ID: OnlineProviderId = 'netease';

const readFallback = (): OnlineProviderId => {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return DEFAULT_PROVIDER_ID;
    const stored = localStorage.getItem(FALLBACK_KEY);
    return stored && stored !== LUOXUE_PROVIDER_ID ? (stored as OnlineProviderId) : DEFAULT_PROVIDER_ID;
};

const writeFallback = (providerId: OnlineProviderId): void => {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
    try {
        localStorage.setItem(FALLBACK_KEY, providerId);
    } catch {
        // 存储不可用时只在内存里记
    }
};

let guardInstalled = false;

/** 装配一次即可（幂等）。 */
export const installActiveProviderGuard = (): void => {
    if (guardInstalled) return;
    guardInstalled = true;

    const store = useOnlineProviderAccountStore;
    let fallbackProviderId = readFallback();
    if (store.getState().activeProviderId === LUOXUE_PROVIDER_ID) {
        store.getState().setActiveProviderId(fallbackProviderId);
    }
    store.subscribe(state => {
        if (state.activeProviderId === LUOXUE_PROVIDER_ID) {
            store.getState().setActiveProviderId(fallbackProviderId);
            return;
        }
        fallbackProviderId = state.activeProviderId;
        writeFallback(state.activeProviderId);
    });
};
