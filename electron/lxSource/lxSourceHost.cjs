// electron/lxSource/lxSourceHost.cjs
// 自定义音源的运行时宿主：一个隐藏的 BrowserWindow，加载空白页 + lxSourcePreload.cjs，
// preload 再把用户脚本跑在页面主世界里。脚本拿到 `lx.request` 后发起的 HTTP 由 preload 侧
// （主进程环境）执行，从而绕开页面 CORS；宿主与脚本之间的请求往返由这里用 requestKey 配对，
// 并带 20s 超时。
//
// 移植自洛雪 lx-music-desktop 的 src/main/modules/userApi/main.ts 与
// rendererEvent/rendererEvent.ts（Apache-2.0）。
const { BrowserWindow } = require('electron');
const path = require('node:path');
const { LX_SOURCE_HTML } = require('./lxSourceHtml.cjs');
const { LX_SOURCE_CHANNELS: CHANNELS } = require('./lxSourceChannels.cjs');

// 一次脚本请求的生命周期上限，与洛雪一致。
const REQUEST_TIMEOUT_MS = 20_000;

// 宿主窗口里不该发生的导航 / 媒体事件，一律拦掉。
const DENY_EVENTS = [
  'will-navigate',
  'will-redirect',
  'will-attach-webview',
  'will-prevent-unload',
  'media-started-playing',
];

// 宿主窗口用独立的内存 session（非 persist: 前缀），与主窗口的存储、缓存和权限互不干扰。
const HOST_PARTITION = 'lx-source-host';

function createLxSourceHost({
  ipcMain,
  store,
  onStatusChange = () => {},
  onUpdateAlert = () => {},
  warn = console.warn,
}) {
  /** @type {Electron.BrowserWindow | null} */
  let browserWindow = null;
  /** @type {Record<string, unknown> | null} 当前激活源的信息（不含脚本） */
  let currentApi = null;
  let apiStatus = { status: false, message: '未加载自定义音源', sources: {} };
  /** @type {Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void }>} */
  const requestQueue = new Map();
  /** @type {Map<string, NodeJS.Timeout>} */
  const timeouts = new Map();

  const setStatus = (next) => {
    apiStatus = next;
    onStatusChange(getStatus());
  };

  const isFromHostWindow = (webContents) => Boolean(
    browserWindow
    && !browserWindow.isDestroyed()
    && webContents
    && webContents.id === browserWindow.webContents.id
  );

  const sendEvent = (channel, params) => {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    browserWindow.webContents.send(channel, params);
  };

  const clearRequestTimeout = (requestKey) => {
    const timer = timeouts.get(requestKey);
    if (timer) {
      clearTimeout(timer);
      timeouts.delete(requestKey);
    }
  };

  const cancelRequest = (requestKey) => {
    const entry = requestQueue.get(requestKey);
    if (!entry) return;
    requestQueue.delete(requestKey);
    clearRequestTimeout(requestKey);
    entry.reject(new Error('Cancel request'));
  };

  const cancelAllRequests = () => {
    for (const requestKey of Array.from(requestQueue.keys())) cancelRequest(requestKey);
  };

  const closeWindow = async () => {
    cancelAllRequests();
    const win = browserWindow;
    browserWindow = null;
    if (!win || win.isDestroyed()) return;
    try {
      await Promise.all([
        win.webContents.session.clearAuthCache(),
        win.webContents.session.clearStorageData(),
        win.webContents.session.clearCache(),
      ]);
    } catch (error) {
      warn('[lx-source] failed to clear host window storage:', error?.message ?? error);
    }
    if (!win.isDestroyed()) win.destroy();
  };

  const createWindow = async (apiInfo) => {
    const script = await store.getScript(apiInfo.id);
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      roundedCorners: false,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        // 用户脚本由 preload 经 webFrame 注入主世界执行，preload 自己需要 require(node 模块)，
        // 所以保留 sandbox: false（与洛雪一致）；页面本身仍无 node 访问。
        sandbox: false,
        spellcheck: false,
        autoplayPolicy: 'document-user-activation-required',
        enableWebSQL: false,
        disableDialogs: true,
        webgl: false,
        images: false,
        partition: HOST_PARTITION,
        preload: path.join(__dirname, 'lxSourcePreload.cjs'),
      },
    });

    browserWindow = win;

    for (const eventName of DENY_EVENTS) {
      win.webContents.on(eventName, (event) => { event.preventDefault(); });
    }
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, resolve) => resolve(false));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    win.on('closed', () => {
      if (browserWindow === win) browserWindow = null;
    });

    // preload 在文档加载前就注册好了 initEnv 监听，这里等页面可显示再下发，和洛雪一致。
    win.once('ready-to-show', () => {
      sendEvent(CHANNELS.initEnv, {
        name: apiInfo.name,
        description: apiInfo.description,
        version: apiInfo.version,
        author: apiInfo.author,
        homepage: apiInfo.homepage,
        script,
        // 本期不接代理：保持空 host 让 preload 不启用任何代理逻辑。
        proxy: { host: '', port: '' },
      });
    });

    await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(LX_SOURCE_HTML)}`);
  };

  /** 加载并激活一个音源；会先关掉上一个宿主窗口。 */
  const load = async (apiId) => {
    await closeWindow();
    if (!apiId) {
      currentApi = null;
      setStatus({ status: false, message: '未加载自定义音源', sources: {} });
      return getStatus();
    }
    const apiInfo = store.getApiInfo(apiId);
    if (!apiInfo) {
      currentApi = null;
      setStatus({ status: false, message: '音源不存在', sources: {} });
      return getStatus();
    }
    currentApi = apiInfo;
    setStatus({ status: false, message: '正在加载音源…', sources: {} });
    await createWindow(apiInfo);
    return getStatus();
  };

  const unload = async () => {
    currentApi = null;
    await closeWindow();
    setStatus({ status: false, message: '未加载自定义音源', sources: {} });
  };

  /** 向脚本请求一次解析结果，返回 preload 归一化后的 result。 */
  const request = async ({ source, action, info }) => {
    if (!currentApi) throw new Error('自定义音源尚未加载');
    const requestKey = `request__${Math.random().toString(36).slice(2)}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      timeouts.set(requestKey, setTimeout(() => cancelRequest(requestKey), REQUEST_TIMEOUT_MS));
      requestQueue.set(requestKey, { resolve, reject });
      sendEvent(CHANNELS.request, { requestKey, data: { source, action, info } });
    });
  };

  const openDevTools = () => {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    browserWindow.webContents.openDevTools({ mode: 'detach' });
  };

  const getStatus = () => ({
    activeApiId: currentApi?.id ?? null,
    loaded: apiStatus.status,
    message: apiStatus.message ?? '',
    sources: apiStatus.sources ?? {},
  });

  const init = () => {
    ipcMain.on(CHANNELS.init, (event, payload) => {
      if (!isFromHostWindow(event.sender)) return;
      const { status, message, data } = payload || {};
      if (status) {
        setStatus({ status: true, message: '', sources: data?.sources ?? {} });
      } else {
        setStatus({ status: false, message: message || '音源初始化失败', sources: {} });
      }
    });

    ipcMain.on(CHANNELS.response, (event, payload) => {
      if (!isFromHostWindow(event.sender)) return;
      const { status, message, data } = payload || {};
      const requestKey = data?.requestKey;
      if (!requestKey) return;
      const entry = requestQueue.get(requestKey);
      if (!entry) return;
      requestQueue.delete(requestKey);
      clearRequestTimeout(requestKey);
      if (status) entry.resolve(data.result);
      else entry.reject(new Error(message || '音源请求失败'));
    });

    ipcMain.on(CHANNELS.openDevTools, (event) => {
      if (!isFromHostWindow(event.sender)) return;
      openDevTools();
    });

    ipcMain.on(CHANNELS.showUpdateAlert, (event, payload) => {
      if (!isFromHostWindow(event.sender)) return;
      onUpdateAlert(payload);
    });
  };

  return {
    init,
    load,
    unload,
    request,
    getStatus,
    openDevTools,
    closeWindow,
    get activeApiId() { return currentApi?.id ?? null; },
  };
}

module.exports = { createLxSourceHost };
