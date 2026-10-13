// electron/lxSource/lxSourceStore.cjs
// 自定义音源脚本的持久化：头部信息解析、deflate + base64 压缩存储、当前激活源。
//
// 移植自洛雪 lx-music-desktop 的 src/main/modules/userApi/utils.ts（Apache-2.0），
// 存储后端换成 electron-store 的独立命名空间 `lx-source`，与 Folia 主设置（`Folia`）互不影响。
const Store = require('electron-store').default || require('electron-store');
const zlib = require('node:zlib');

// 头部注释块里各字段的长度上限（超长截断），与洛雪 INFO_NAMES 对齐。
const INFO_LENGTHS = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
};

const STORE_KEY_APIS = 'userApis';
const STORE_KEY_ACTIVE = 'activeApiId';
// 各文件选择框最后一次选中的路径（键为对话框用途，如 script / playlist），下次打开时定位到同一处。
const STORE_KEY_LAST_PATHS = 'lastFilePaths';

/**
 * 从脚本首个块注释里解析 `@name` / `@version` 等字段。
 * 只认 `* @key value` 形态的注释行，与洛雪 matchInfo 一致。
 */
const matchScriptInfo = (commentBlock) => {
  const infos = {};
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/;
  for (const line of commentBlock.split(/\r?\n/)) {
    const result = rxp.exec(line);
    if (!result) continue;
    const key = result[1];
    if (!(key in INFO_LENGTHS)) continue;
    infos[key] = result[2].trim();
  }
  for (const [key, maxLength] of Object.entries(INFO_LENGTHS)) {
    const value = infos[key] ?? '';
    infos[key] = value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }
  return infos;
};

/** 解析脚本头部信息；没有块注释即视为无效脚本。 */
const parseScriptInfo = (script) => {
  const result = /^\/\*[\S\s]+?\*\//.exec(script);
  if (!result) throw new Error('无效的自定义音源文件：缺少头部注释块');
  const info = matchScriptInfo(result[0]);
  if (!info.name) info.name = `user_api_${new Date().toLocaleString()}`;
  return info;
};

/** 压缩脚本：`gz_` + base64(deflate)，与洛雪存储格式一致，便于互通。 */
const deflateScript = async (script) => new Promise((resolve, reject) => {
  zlib.deflate(Buffer.from(script, 'utf8'), (err, buf) => {
    if (err) reject(err);
    else resolve(`gz_${buf.toString('base64')}`);
  });
});

/** 还原脚本；非 `gz_` 前缀按明文处理（兼容旧数据 / 手工写入）。 */
const inflateScript = async (stored) => new Promise((resolve, reject) => {
  if (typeof stored !== 'string' || !stored.startsWith('gz_')) {
    resolve(stored ?? '');
    return;
  }
  zlib.inflate(Buffer.from(stored.slice(3), 'base64'), (err, buf) => {
    if (err) reject(err);
    else resolve(buf.toString('utf8'));
  });
});

/**
 * 音源仓储。脚本内容只在内存里保存压缩态，落盘时随信息列表一起写入 electron-store。
 * 列表对外的形态不含 `script`（信息与内容分离），脚本通过 `getScript(id)` 按需还原。
 */
function createLxSourceStore({ store = new Store({ name: 'lx-source' }) } = {}) {
  /** @type {Array<Record<string, unknown>> | null} 不含 script 的信息列表 */
  let apiInfos = null;
  /** @type {Map<string, string>} id -> 压缩后的脚本 */
  const scripts = new Map();

  const persist = () => {
    store.set(STORE_KEY_APIS, apiInfos.map(info => ({ ...info, script: scripts.get(info.id) })));
  };

  const getUserApis = () => {
    if (apiInfos) return apiInfos;

    const stored = store.get(STORE_KEY_APIS);
    const raw = Array.isArray(stored) ? stored : [];
    let requiredUpdate = false;
    const migrated = [];
    // 早期条目可能缺少 version（导入时未解析头部）：就地补解析，解析失败的直接丢弃。
    for (const api of raw) {
      if (!api || typeof api !== 'object') {
        requiredUpdate = true;
        continue;
      }
      if (api.version != null) {
        migrated.push(api);
        continue;
      }
      requiredUpdate = true;
      try {
        migrated.push({ ...parseScriptInfo(api.script), ...api });
      } catch {
        // 无效脚本：丢弃，不算致命。
      }
    }

    apiInfos = migrated.map(api => {
      if (api.allowShowUpdateAlert == null) api.allowShowUpdateAlert = false;
      const { script, ...info } = api;
      scripts.set(info.id, typeof script === 'string' ? script : '');
      return info;
    });

    if (requiredUpdate) persist();
    return apiInfos;
  };

  const getActiveApiId = () => {
    const id = store.get(STORE_KEY_ACTIVE);
    return typeof id === 'string' && id ? id : null;
  };

  const setActiveApiId = (id) => {
    if (typeof id === 'string' && id) store.set(STORE_KEY_ACTIVE, id);
    else store.delete(STORE_KEY_ACTIVE);
  };

  const importApi = async (scriptRaw) => {
    if (typeof scriptRaw !== 'string' || !scriptRaw.trim()) {
      throw new Error('导入失败：脚本内容为空');
    }
    const scriptInfo = parseScriptInfo(scriptRaw);
    const script = await deflateScript(scriptRaw);
    getUserApis();
    for (const api of apiInfos) {
      if (scripts.get(api.id) === script) {
        throw new Error(`导入失败：脚本内容与已有的源「${api.name}」相同`);
      }
    }
    const apiInfo = {
      id: `user_api_${Math.random().toString(36).slice(2, 7)}_${Date.now()}`,
      ...scriptInfo,
      allowShowUpdateAlert: true,
    };
    apiInfos.push(apiInfo);
    scripts.set(apiInfo.id, script);
    persist();
    return apiInfo;
  };

  const removeApis = (ids) => {
    getUserApis();
    const targets = new Set(Array.isArray(ids) ? ids : []);
    if (targets.size === 0) return apiInfos;
    apiInfos = apiInfos.filter(api => !targets.has(api.id));
    for (const id of targets) scripts.delete(id);
    if (targets.has(getActiveApiId())) setActiveApiId(null);
    persist();
    return apiInfos;
  };

  const setAllowShowUpdateAlert = (id, enable) => {
    const target = getUserApis().find(api => api.id === id);
    if (!target) return;
    target.allowShowUpdateAlert = Boolean(enable);
    persist();
  };

  const getApiInfo = (id) => getUserApis().find(api => api.id === id) ?? null;

  const getScript = async (id) => inflateScript(scripts.get(id) ?? '');

  /** 取某用途的文件选择框最后一次选中的路径；无记录返回 undefined。 */
  const getLastFilePath = (key) => {
    const paths = store.get(STORE_KEY_LAST_PATHS);
    const value = paths && typeof paths === 'object' ? paths[key] : undefined;
    return typeof value === 'string' && value ? value : undefined;
  };

  /** 记录某用途的文件选择框最后一次选中的路径。 */
  const setLastFilePath = (key, filePath) => {
    if (typeof key !== 'string' || !key) return;
    const paths = store.get(STORE_KEY_LAST_PATHS);
    const next = paths && typeof paths === 'object' && !Array.isArray(paths) ? { ...paths } : {};
    if (typeof filePath === 'string' && filePath) next[key] = filePath;
    else delete next[key];
    store.set(STORE_KEY_LAST_PATHS, next);
  };

  return {
    getUserApis,
    getApiInfo,
    getScript,
    importApi,
    removeApis,
    setAllowShowUpdateAlert,
    getActiveApiId,
    setActiveApiId,
    getLastFilePath,
    setLastFilePath,
  };
}

module.exports = { createLxSourceStore, parseScriptInfo };
