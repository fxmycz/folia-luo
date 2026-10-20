// src/luoxue/runtime/sourceRuntime.ts
// 洛雪自定义音源的渲染层客户端。它只做「读缓存 + 调主进程」，所有脚本执行都在
// electron/luoxueSource 的隐藏沙箱窗口里完成。
//
// getApis / getSourceIds / getSourceInfo / isReady 是同步方法：omni provider 与 SDK 会在非 React
// 环境里直接读它们，所以运行时把初始化结果缓存在模块状态里。list / init / save 等才是异步。
// 浏览器（非 Electron）构建里 window.electron.luoxueSource 不存在，所有方法降级为空结果、不抛错。

export type LuoxueSourceInfo = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
};

export type LuoxueSourceQuality = { type: string; name?: string };

/** 脚本初始化后，某个音乐源声明出来的能力（主进程已裁剪，只保留宿主支持的部分）。 */
type LuoxueMusicSourceCapability = {
  type?: string;
  actions?: string[];
  qualitys?: string[];
};

/** 主进程 luoxue-source:init / luoxue-source:getInfo 的返回：源信息 + 它声明支持的源能力。 */
type LuoxueSourceInitResult = LuoxueSourceInfo & {
  sources?: Record<string, LuoxueMusicSourceCapability>;
};

/** window.electron.luoxueSource 的契约；electron/preload.cjs 暴露的就是这一组 invoke。 */
type LuoxueBridge = {
  list(): Promise<LuoxueSourceInfo[]>;
  save(payload: { id?: string; text?: string; filePath?: string }): Promise<LuoxueSourceInfo>;
  remove(id: string): Promise<void>;
  setActive(id: string | null): Promise<void>;
  getActiveId(): Promise<string | null>;
  init(): Promise<LuoxueSourceInitResult>;
  invoke(params: { requestKey?: string; source: string; action: string; info?: unknown }): Promise<any>;
  cancel(requestKey: string): Promise<void> | void;
  getInfo(): Promise<LuoxueSourceInitResult | null>;
};

/** lx action → 脚本 api 对象上的方法名（与 lx-music-desktop 的 apis(source) 方法命名保持一致）。 */
const ACTION_METHODS: Record<string, string> = {
  musicUrl: 'getMusicUrl',
  lyric: 'getLyric',
  pic: 'getPic',
  search: 'search',
  leaderboard: 'leaderboard',
  songList: 'songList',
  getTags: 'getTags',
  hotSearch: 'hotSearch',
};

/** 读取 Electron 注入的桥；不在 Electron 环境时返回 null，调用方据此降级。 */
const getBridge = (): LuoxueBridge | null => {
  if (typeof window === 'undefined') return null;
  const electron = (window as unknown as { electron?: { luoxueSource?: LuoxueBridge } }).electron;
  return electron?.luoxueSource ?? null;
};

/** 统一成 `user_api_<id>` 形式：脚本 id 本身已带前缀，这里只做兜底。 */
const toSourceId = (id: string): string => (id.startsWith('user_api_') ? id : `user_api_${id}`);

const makeRequestKey = (): string => `request__${Math.random().toString(36).slice(2)}`;

let sourceList: LuoxueSourceInfo[] = [];
let activeId: string | null = null;
const initResults = new Map<string, LuoxueSourceInitResult>();
const apiMaps = new Map<string, Record<string, any>>();
let ready = false;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

/** 按照 action 组装脚本 request 事件里的 info 字段，形状与 ikun 的 useInitUserApi 一致。 */
const buildRequestInfo = (action: string, args: unknown[]): unknown => {
  // musicUrl 传音质；lyric / pic 的 type 恒为 'music'（脚本侧只读 musicInfo）。
  if (action === 'musicUrl') return { type: args[1], musicInfo: args[0] };
  if (action === 'lyric' || action === 'pic') return { type: 'music', musicInfo: args[0] };
  const first = args[0];
  if (first && typeof first === 'object') return first;
  return { value: first };
};

// 生成脚本 api 对象上的单个方法：返回 { promise, canceleFn }，形状与 ikun 的 userApi.apis 一致。
// promise 解析出脚本返回值里的 data 字段：musicUrl → { type, url }，lyric → 歌词对象，pic → 封面地址。
const createActionMethod = (bridge: LuoxueBridge, musicSource: string, action: string) =>
  (...args: unknown[]) => {
    const requestKey = makeRequestKey();
    const promise = bridge
      .invoke({ requestKey, source: musicSource, action, info: buildRequestInfo(action, args) })
      .then((res) => {
        const data = res && res.data;
        if (action === 'musicUrl') return { type: (data && data.type) ?? args[1], url: (data && data.url) ?? '' };
        return data ?? res;
      });
    return {
      promise,
      canceleFn: () => {
        void bridge.cancel(requestKey);
      },
    };
  };

// 把一次初始化的 sources 映射成「音乐源 → api 对象」的表，供 getApis 直接返回。
const buildApiMap = (
  bridge: LuoxueBridge,
  result: LuoxueSourceInitResult,
): Record<string, any> => {
  const map: Record<string, any> = {};
  const sources = result.sources ?? {};
  for (const [musicSource, capability] of Object.entries(sources)) {
    if (capability.type && capability.type !== 'music') continue;
    const api: Record<string, any> = {};
    for (const action of capability.actions ?? []) {
      const method = ACTION_METHODS[action];
      if (!method) continue;
      api[method] = createActionMethod(bridge, musicSource, action);
    }
    map[musicSource] = api;
  }
  return map;
};

const refreshList = async (bridge: LuoxueBridge): Promise<void> => {
  try {
    const list = await bridge.list();
    sourceList = Array.isArray(list) ? list : [];
  } catch {
    sourceList = [];
  }
};

export const luoxueSourceRuntime: {
  list(): Promise<LuoxueSourceInfo[]>;
  saveFromText(id: string, text: string): Promise<LuoxueSourceInfo>;
  remove(id: string): Promise<void>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
  init(): Promise<void>;
  /** The source ids `apis(source)` should consult, in the form `user_api_<id>`. */
  getSourceIds(): string[];
  /** lx-style provider lookup: returns the script's exported api object for a `user_api_<id>` source id. */
  getApis(source: string): any;
  /** Source metadata for the UI list (name/qualitys/actions). */
  getSourceInfo(): LuoxueSourceInfo[];
  /** True once at least one source is loaded and initialised. */
  isReady(): boolean;
  subscribe(listener: () => void): () => void;
} = {
  async list(): Promise<LuoxueSourceInfo[]> {
    const bridge = getBridge();
    if (!bridge) return [];
    await refreshList(bridge);
    notify();
    return sourceList;
  },

  async saveFromText(id: string, text: string): Promise<LuoxueSourceInfo> {
    const bridge = getBridge();
    if (!bridge) return { id: id || '', name: '' };
    const info = await bridge.save({ id, text });
    await refreshList(bridge);
    notify();
    return info;
  },

  async remove(id: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) return;
    await bridge.remove(id);
    if (activeId === id) {
      activeId = null;
      ready = false;
    }
    apiMaps.delete(id);
    initResults.delete(id);
    await refreshList(bridge);
    notify();
  },

  async getActiveId(): Promise<string | null> {
    const bridge = getBridge();
    if (!bridge) return activeId;
    try {
      activeId = await bridge.getActiveId();
    } catch {
      // 主进程不可用时沿用内存里的值
    }
    return activeId;
  },

  async setActiveId(id: string | null): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      activeId = id;
      notify();
      return;
    }
    await bridge.setActive(id);
    activeId = id;
    if (id == null) ready = false;
    notify();
  },

  // 初始化当前音源：拉列表与当前 id，让主进程建沙箱窗口执行脚本，再缓存它声明的能力。
  async init(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      ready = false;
      notify();
      return;
    }
    await refreshList(bridge);
    try {
      activeId = await bridge.getActiveId();
    } catch {
      activeId = null;
    }
    let result: LuoxueSourceInitResult | null = null;
    try {
      result = await bridge.init();
    } catch {
      result = null;
    }
    if (result && result.id) {
      initResults.set(result.id, result);
      apiMaps.set(result.id, buildApiMap(bridge, result));
      ready = true;
    } else {
      ready = false;
    }
    notify();
  },

  getSourceIds(): string[] {
    const ids = new Set<string>();
    for (const source of sourceList) {
      if (source && source.id) ids.add(toSourceId(source.id));
    }
    if (activeId) ids.add(toSourceId(activeId));
    return [...ids];
  },

  getApis(source: string): any {
    if (!source) return undefined;
    // 传入自定义源 id：返回该源「音乐源 → api 对象」的整张表（等价于 ikun 的 userApi.apis）。
    if (source.startsWith('user_api_')) return apiMaps.get(source);
    // 传入音乐源代号（kw/kg/...）：返回当前自定义源在该音乐源上的 api 对象。
    const map = activeId ? apiMaps.get(activeId) : undefined;
    return map ? map[source] : undefined;
  },

  getSourceInfo(): LuoxueSourceInfo[] {
    return sourceList.map((info) => {
      const result = initResults.get(info.id);
      if (!result || !result.sources) return info;
      const qualitys: Record<string, string[]> = {};
      const actions: Record<string, string[]> = {};
      for (const [musicSource, capability] of Object.entries(result.sources)) {
        qualitys[musicSource] = capability.qualitys ?? [];
        actions[musicSource] = capability.actions ?? [];
      }
      return { ...info, sources: result.sources, qualitys, actions } as LuoxueSourceInfo;
    });
  },

  isReady(): boolean {
    return ready;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
