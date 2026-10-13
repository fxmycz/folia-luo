import { create } from 'zustand';
import {
    callLxSource,
    getLxSourceBridge,
    setLxSourceHasActiveSource,
} from './lxSourceTransport';
import type { LxSourceApiInfo, LxSourceBridge, LxSourceBridgeResult, LxSourceSnapshot, LxSourceStatus, LxSourceUpdateAlert } from './lxSourceTransport';

// src/services/lxSource/lxSourceStore.ts
// 自定义音源版块的渲染层状态：音源列表、当前激活源、宿主状态与导入/删除的进行中与错误。
// 所有 IPC 经 lxSourceTransport（无桥时即 Web 端，动作直接以错误收场）。

export type LxSourceState = {
    apis: LxSourceApiInfo[];
    activeApiId: string | null;
    status: LxSourceStatus | null;
    isLoading: boolean;
    /** 最近一次操作的错误文案；成功后清空。 */
    error: string | null;
    /** 脚本发来的更新提示；已被用户关闭或没有时为 null。 */
    updateAlert: LxSourceUpdateAlert | null;

    refresh: () => Promise<void>;
    importFromUrl: (url: string) => Promise<boolean>;
    importFromText: (text: string) => Promise<boolean>;
    /** 弹系统文件选择框导入本地音源脚本；用户取消时返回 false 且不改动列表。 */
    importFromFile: () => Promise<boolean>;
    remove: (ids: string[]) => Promise<boolean>;
    setActive: (apiId: string | null) => Promise<boolean>;
    openDevTools: () => Promise<void>;
    dismissUpdateAlert: () => void;
    /** 订阅主进程状态广播；返回取消订阅函数。无桥时是空操作。 */
    subscribeStatus: () => () => void;
    /** 订阅更新提示广播；返回取消订阅函数。无桥时是空操作。 */
    subscribeUpdateAlert: () => () => void;
};

export const useLxSourceStore = create<LxSourceState>((set) => {
    const applySnapshot = (snapshot: LxSourceSnapshot) => {
        setLxSourceHasActiveSource(Boolean(snapshot.activeApiId));
        set({ apis: snapshot.apis, activeApiId: snapshot.activeApiId, status: snapshot.status });
    };

    // 统一包裹一次带错误收敛的调用；返回是否成功。
    // 经 callLxSource 拆掉桥的 Result，IPC 抛错与脚本报错都收敛成 onlineError 文案。
    const run = async (call: (bridge: LxSourceBridge) => Promise<LxSourceBridgeResult<LxSourceSnapshot>>) => {
        if (!getLxSourceBridge()) {
            set({ error: '自定义音源仅桌面端可用' });
            return false;
        }
        set({ isLoading: true, error: null });
        try {
            applySnapshot(await callLxSource('lx', call));
            return true;
        } catch (error) {
            set({ error: error instanceof Error ? error.message : String(error) });
            return false;
        } finally {
            set({ isLoading: false });
        }
    };

    const applyStatus = (status: LxSourceStatus) => {
        setLxSourceHasActiveSource(Boolean(status.activeApiId));
        set({ status });
    };

    return {
        apis: [],
        activeApiId: null,
        status: null,
        isLoading: false,
        error: null,
        updateAlert: null,

        refresh: async () => { await run(bridge => bridge.listApis()); },
        importFromUrl: (url) => run(bridge => bridge.importScriptOnline(url)),
        importFromText: (text) => run(bridge => bridge.importScriptText(text)),

        importFromFile: async () => {
            if (!getLxSourceBridge()) {
                set({ error: '自定义音源仅桌面端可用' });
                return false;
            }
            set({ isLoading: true, error: null });
            try {
                const result = await callLxSource('lx', bridge => bridge.importScriptFile());
                applySnapshot(result.snapshot);
                return !result.canceled;
            } catch (error) {
                set({ error: error instanceof Error ? error.message : String(error) });
                return false;
            } finally {
                set({ isLoading: false });
            }
        },

        remove: (ids) => run(bridge => bridge.removeApis(ids)),
        setActive: (apiId) => run(bridge => bridge.setActive(apiId)),

        openDevTools: async () => {
            try {
                await callLxSource('lx', bridge => bridge.openDevTools());
            } catch (error) {
                set({ error: error instanceof Error ? error.message : String(error) });
            }
        },

        dismissUpdateAlert: () => set({ updateAlert: null }),

        subscribeStatus: () => {
            const bridge = getLxSourceBridge();
            if (!bridge) return () => {};
            return bridge.onStatusChanged(applyStatus);
        },

        subscribeUpdateAlert: () => {
            const bridge = getLxSourceBridge();
            if (!bridge) return () => {};
            return bridge.onUpdateAlert(alert => set({ updateAlert: alert }));
        },
    };
});
