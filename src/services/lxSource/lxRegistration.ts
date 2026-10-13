import { registerOnlineMusicProvider } from '../onlineMusic/providerRegistry';
import { createLxProvider } from './lxProvider';
import { getLxSourceBridge } from './lxSourceTransport';
import { useLxSourceStore } from './lxSourceStore';

// src/services/lxSource/lxRegistration.ts
// 桌面端专属初始化：把洛雪自定义音源的平台注册成 Folia provider，并同步一次激活源状态。
// Web 端没有桥，注册出来也只会是 runtime-unavailable，故整体跳过（版块在 Web 端隐藏）。

/** 已移植的平台：酷我 / 咪咕 / 酷狗 / QQ音乐 / 网易云（与 musicSdk/index.cjs 的 platforms 对应）。 */
const LX_REGISTERED_SOURCES = ['kw', 'mg', 'kg', 'tx', 'wy'];

let registered = false;
const unsubscribers: Array<() => void> = [];

export const initLxSourceIntegration = (): void => {
    const bridge = getLxSourceBridge();
    if (!bridge) return;

    if (!registered) {
        registered = true;
        for (const source of LX_REGISTERED_SOURCES) {
            registerOnlineMusicProvider(createLxProvider(source));
        }
    }

    const store = useLxSourceStore.getState();
    // 拉一次初始快照，让 provider 的同步 availability（hasActiveSource）立刻正确。
    void store.refresh();
    if (!unsubscribers.length) {
        unsubscribers.push(store.subscribeStatus(), store.subscribeUpdateAlert());
    }
};
