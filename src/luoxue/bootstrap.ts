import { initSdk, setUserApiRuntime } from './sdk';
import { installLuoxueProvider, setLuoxueSourceRuntimeRef } from './provider/luoxueProvider';
import { installActiveProviderGuard } from './provider/activeProviderGuard';
import { getActiveLuoxueSourceId, syncActiveLuoxueSourceToSdk } from './provider/activeSource';
import { luoxueSourceRuntime } from './runtime/sourceRuntime';

// src/luoxue/bootstrap.ts
// 洛雪版块的装配入口：把自定义音源运行时注入 SDK、注册 omni provider、把持久化的音源同步给 SDK。
// 只需要在应用启动时调用一次（幂等）。装配失败不影响 folia 原本的任何功能。

let installed = false;

export const installLuoxue = (): void => {
    if (installed) return;
    installed = true;

    installLuoxueProvider();
    // 把 folia 的「当前在线平台」钉在洛雪之外：session restore 会按上一首歌的 providerId 把它对齐成洛雪，
    // 一旦如此，首页的歌单 / 电台 / 专辑三个在线页签就会按「洛雪暂未提供…」被永久禁用。
    installActiveProviderGuard();
    // provider 通过这个引用读「当前音源支持哪些音质」，避免与运行时的直接循环依赖。
    setLuoxueSourceRuntimeRef(luoxueSourceRuntime);
    setUserApiRuntime({
        getApis: source => luoxueSourceRuntime.getApis(source),
        getSourceIds: () => luoxueSourceRuntime.getSourceIds(),
        getSourceInfo: () => luoxueSourceRuntime.getSourceInfo(),
    });
    syncActiveLuoxueSourceToSdk();
    // 预初始化自定义音源运行时：只有 init() 会真正建沙箱窗口执行脚本，并把脚本声明的
    // 「平台 → 能力表」缓存下来；没有这一步，apis(平台) 取不到实现，播放会抛「Api is not found」。
    void luoxueSourceRuntime.init();
    void initSdk();
};

export { getActiveLuoxueSourceId };
