'use strict';

// electron/luoxueSource/index.cjs
// 洛雪自定义音源宿主（主进程侧）。职责与 lx-music-desktop 的 src/main/modules/userApi 对齐：
// 建一个隐藏的沙箱 BrowserWindow 执行用户脚本，转发脚本的 request 事件，持久化脚本列表与当前音源。
// 差异只有一处：渲染层不再自己发 request，而是通过 luoxue-source:invoke 直接调用命名 action，
// 于是这里把「请求队列 + 超时」放在主进程，而不是渲染层的 rendererEvent。
//
// 模块只依赖 Node 内置模块；BrowserWindow / app / ipcMain 由 main.cjs 注入，保证在非 Electron
// 环境 import 时不会抛错（便于单测）。
const fs = require('fs');
const path = require('path');
const { writeTags } = require('./tags.cjs');

const SANDBOX_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <meta http-equiv="Content-Security-Policy" content="default-src \'none\'" />',
  '    <title>Luoxue Source</title>',
  '  </head>',
  '  <body></body>',
  '</html>',
].join('\n');

const CHANNELS = {
  initEnv: 'luoxue-source:initEnv',
  proxyUpdate: 'luoxue-source:proxyUpdate',
  scriptInit: 'luoxue-source:scriptInit',
  request: 'luoxue-source:request',
  response: 'luoxue-source:response',
  openDevTools: 'luoxue-source:openDevTools',
  showUpdateAlert: 'luoxue-source:showUpdateAlert',
};

const REQUEST_TIMEOUT_MS = 20000;

const INFO_NAMES = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
};

// 解析脚本头部注释块里的 @name/@description/@version/@author/@homepage（移植自 lx 的 parseScriptInfo）。
const matchScriptInfo = (scriptInfo) => {
  const lines = scriptInfo.split(/\r?\n/);
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/;
  const infos = {};
  for (const line of lines) {
    const result = rxp.exec(line);
    if (!result) continue;
    const key = result[1];
    if (INFO_NAMES[key] == null) continue;
    infos[key] = result[2].trim();
  }
  for (const [key, len] of Object.entries(INFO_NAMES)) {
    if (infos[key] == null) infos[key] = '';
    else if (infos[key].length > len) infos[key] = infos[key].substring(0, len) + '...';
  }
  return infos;
};

const parseScriptInfo = (script) => {
  if (typeof script !== 'string' || !script) throw new Error('无效的自定义源文件');
  const result = /^\/\*[\S|\s]+?\*\//.exec(script);
  if (!result) throw new Error('无效的自定义源文件');
  const info = matchScriptInfo(result[0]);
  if (!info.name) info.name = `user_api_${new Date().toLocaleString()}`;
  return info;
};

function createLuoxueSourceHost({ app, BrowserWindow, ipcMain, isTrusted = () => true, createSenderGuardedHandler }) {
  let win = null;
  let index = null;
  let initResults = {};
  let activeInitResult = null;

  let pendingInit = null;
  const requestQueue = new Map();
  const requestTimeouts = new Map();
  // HTTP 代理请求的 requestKey -> AbortController。与脚本 invoke 的 requestQueue 是两个互不相干的
  // 命名空间（渲染层分别用 'request__' / 'http__' 前缀），所以取消了某一边不会误伤另一边。
  const httpControllers = new Map();
  // 下载任务的 taskId -> AbortController；渲染层在途下载在 dispose / 退出时要一并中止。
  const downloads = new Map();

  const dir = () => path.join(app.getPath('userData'), 'luoxue');
  const sourcesDir = () => path.join(dir(), 'sources');
  const indexPath = () => path.join(dir(), 'sources.json');
  const scriptPath = (id) => path.join(sourcesDir(), `${id}.js`);

  const ensureDirs = () => {
    fs.mkdirSync(sourcesDir(), { recursive: true });
  };

  // 读取 index（脚本列表 + 当前音源 id）；损坏时回退为空列表，不阻塞启动。
  const readIndex = () => {
    if (index) return index;
    let raw = null;
    try {
      raw = fs.readFileSync(indexPath(), 'utf8');
    } catch (_) {
      raw = null;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        index = {
          version: 1,
          activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
          sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        };
      } catch (_) {
        index = { version: 1, activeId: null, sources: [] };
      }
    } else {
      index = { version: 1, activeId: null, sources: [] };
    }
    return index;
  };

  const writeIndex = () => {
    ensureDirs();
    fs.writeFileSync(indexPath(), JSON.stringify(index, null, 2), 'utf8');
  };

  const makeId = () => `user_api_${Math.random().toString().substring(2, 5)}_${Date.now()}`;

  // id 只可能由 makeId() 生成或来自磁盘 index；仍做一次白名单校验，避免异常 id 拼出目录穿越的路径。
  const isValidScriptId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);

  const readScript = (id) => {
    if (!isValidScriptId(id)) return null;
    try {
      return fs.readFileSync(scriptPath(id), 'utf8');
    } catch (_) {
      return null;
    }
  };

  const getInfoById = (id) => readIndex().sources.find((s) => s.id === id) || null;

  const sendToSandbox = (channel, params) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, params);
  };

  const clearRequestTimeout = (requestKey) => {
    const timer = requestTimeouts.get(requestKey);
    if (timer) {
      clearTimeout(timer);
      requestTimeouts.delete(requestKey);
    }
  };

  const cancelRequest = (requestKey) => {
    const entry = requestQueue.get(requestKey);
    if (!entry) return;
    requestQueue.delete(requestKey);
    clearRequestTimeout(requestKey);
    entry.reject(new Error('Cancel request'));
  };

  // 中止某个在途 HTTP 代理请求；请求已完成（key 已从 Map 删除）时是安全的空操作。
  const cancelHttpRequest = (requestKey) => {
    const controller = httpControllers.get(requestKey);
    if (controller) controller.abort();
  };

  // 代理只允许普通 http/https URL，拒绝 file: / data: 等协议，避免它被当成通用任意协议代理。
  const assertHttpUrl = (url) => {
    if (typeof url !== 'string' || !url) throw new Error('无效的请求地址');
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      throw new Error('无效的请求地址');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅支持 http/https 请求');
    }
  };

  const HTTP_TIMEOUT_MAX_MS = 60000;

  // 用主进程的 fetch 代渲染层发请求（webSecurity:true 下渲染层请求第三方接口会被 CORS 拦下）。
  // 请求头 / 请求体已由渲染层构建好，这里只转发；响应体以 base64 原样回传，不在主进程解码文本。
  const performHttpRequest = async ({ requestKey, url, method, headers, body, timeoutMs }) => {
    assertHttpUrl(url);
    const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? Math.min(timeoutMs, HTTP_TIMEOUT_MAX_MS) : 15000;

    const controller = new AbortController();
    httpControllers.set(requestKey, controller);
    // 超时走独立的 AbortSignal.timeout；与用于取消的 controller 组合，任一触发都会中止 fetch。
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(ms)]);

    try {
      const res = await fetch(url, {
        method: (typeof method === 'string' && method ? method : 'GET').toUpperCase(),
        headers: headers && typeof headers === 'object' ? headers : undefined,
        body: body == null ? undefined : body,
        signal,
        redirect: 'follow',
      });
      const arrayBuffer = await res.arrayBuffer();
      const responseHeaders = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
      // set-cookie 在 Headers 的迭代里会被合并成一条，音源依赖数组形式，所以用 getSetCookie 取回。
      let setCookie;
      if (typeof res.headers.getSetCookie === 'function') {
        const cookies = res.headers.getSetCookie();
        if (cookies.length) {
          setCookie = cookies;
          responseHeaders['set-cookie'] = cookies;
        }
      }
      return {
        statusCode: res.status,
        statusMessage: res.statusText,
        headers: responseHeaders,
        setCookie,
        bodyBase64: Buffer.from(arrayBuffer).toString('base64'),
      };
    } catch (err) {
      // controller.signal 只被主动取消触发；signal 也可能因超时而中止，两者要区分开。
      if (controller.signal.aborted) throw new Error('请求已取消');
      if (signal.aborted) throw new Error('请求超时');
      throw err instanceof Error ? err : new Error(err && err.message ? String(err.message) : String(err));
    } finally {
      httpControllers.delete(requestKey);
    }
  };

  // 嵌入标签时取封面：渲染层会被 CORS 拦下，所以必须在主进程取。复用 assertHttpUrl 只放行 http/https，
  // 超时与大小上限均可控；取不到（非 2xx / 超大 / 网络错误）返回 null，调用方跳过封面但不影响其它标签。
  const COVER_TIMEOUT_MS = 15000;
  const COVER_MAX_BYTES = 5 * 1024 * 1024;
  const fetchCover = async (url, timeoutMs) => {
    assertHttpUrl(url);
    const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? Math.min(timeoutMs, COVER_TIMEOUT_MS) : COVER_TIMEOUT_MS;
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (res.status < 200 || res.status >= 300) return null;
    const contentLength = Number(res.headers.get('content-length') || 0) || 0;
    if (contentLength > COVER_MAX_BYTES) return null;
    const arrayBuffer = await res.arrayBuffer();
    if (!arrayBuffer.byteLength || arrayBuffer.byteLength > COVER_MAX_BYTES) return null;
    return Buffer.from(arrayBuffer);
  };

  // ---- 下载落盘 ----
  // 文件名清洗：去掉路径分隔符与 Windows 非法字符，并折叠成单个安全文件名，避免路径穿越与非法文件名。
  const sanitizeFileName = (name) => {
    if (typeof name !== 'string') return '';
    return name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 200);
  };

  // 目标目录 + 文件名 → 最终写入路径：路径必须在目标目录内（文件名已清洗，这里再兜一层校验）。
  const resolveDownloadTarget = (rawDir, rawName) => {
    const targetDir = typeof rawDir === 'string' && rawDir.trim() ? path.resolve(rawDir.trim()) : app.getPath('downloads');
    const name = sanitizeFileName(rawName);
    if (!name) throw new Error('下载文件名无效');
    const filePath = path.resolve(targetDir, name);
    if (filePath !== path.join(targetDir, name)) throw new Error('下载路径不合法');
    return { targetDir, fileName: name, filePath };
  };

  const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

  // 流式下载：主进程用 fetch 取流并按块写入文件；进度通过 luoxue-source:download-progress 回报渲染层。
  const performDownload = async (event, payload) => {
    const { taskId, url, dir: rawDir, fileName, headers, skipExistFile } = payload || {};
    if (typeof taskId !== 'string' || !taskId) throw new Error('缺少下载任务 id');
    assertHttpUrl(url);
    const { targetDir, filePath } = resolveDownloadTarget(rawDir, fileName);

    await fs.promises.mkdir(targetDir, { recursive: true });

    // 跳过已存在文件：存在且非空就直接返回，避免覆盖。
    if (skipExistFile) {
      try {
        const stats = await fs.promises.stat(filePath);
        if (stats.isFile() && stats.size > 0) {
          return { filePath, received: stats.size, total: stats.size, skipped: true };
        }
      } catch (_) {
        // 不存在则继续正常下载
      }
    }

    const controller = new AbortController();
    downloads.set(taskId, controller);
    const sendProgress = (received, total) => {
      if (!event.sender || event.sender.isDestroyed()) return;
      event.sender.send('luoxue-source:download-progress', { taskId, received, total });
    };

    let stream = null;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: headers && typeof headers === 'object' ? headers : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]),
        redirect: 'follow',
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`下载失败：HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      }
      const total = Number(res.headers.get('content-length') || 0) || 0;
      stream = fs.createWriteStream(filePath);
      const reader = res.body.getReader();
      let received = 0;
      let lastSent = 0;
      let lastSentAt = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        const buffer = Buffer.from(value);
        received += buffer.length;
        if (!stream.write(buffer)) await new Promise((resolve) => stream.once('drain', resolve));
        const now = Date.now();
        if (now - lastSentAt > 200 || (total > 0 && received === total)) {
          lastSent = received;
          lastSentAt = now;
          sendProgress(lastSent, total);
        }
      }
      await new Promise((resolve, reject) => stream.end((err) => (err ? reject(err) : resolve())));
      stream = null;
      sendProgress(received, total || received);
      return { filePath, received, total: total || received };
    } catch (err) {
      // 失败 / 取消后清理半成品文件，避免留下损坏文件。
      if (stream) {
        try {
          await new Promise((resolve) => stream.close(() => resolve()));
        } catch (_) {}
        stream = null;
      }
      await fs.promises.rm(filePath, { force: true }).catch(() => {});
      if (controller.signal.aborted) throw new Error('下载已取消');
      if (err && err.name === 'TimeoutError') throw new Error('下载超时');
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      downloads.delete(taskId);
    }
  };

  // 文本文件落盘（歌词 .lrc 侧车文件）：同样做文件名清洗与目录穿越校验。
  const performWriteTextFile = async (payload) => {
    const { dir: rawDir, fileName, text } = payload || {};
    if (typeof text !== 'string') throw new Error('文件内容无效');
    const { targetDir, filePath } = resolveDownloadTarget(rawDir, fileName);
    await fs.promises.mkdir(targetDir, { recursive: true });
    await fs.promises.writeFile(filePath, text, 'utf8');
    return { filePath };
  };

  const deleteScriptFile = (id) => {
    if (!isValidScriptId(id)) return;
    try {
      fs.rmSync(scriptPath(id), { force: true });
    } catch (_) {}
  };

  // ---- 沙箱窗口 ----
  const closeWindow = () => {
    if (!win) return;
    try {
      win.destroy();
    } catch (_) {}
    win = null;
  };

  const createWindow = async () => {
    closeWindow();
    // 用局部 const 持有新窗口：旧窗口的 'closed' 回调只能清掉它自己，不能误清后建的这个。
    const created = new BrowserWindow({
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        // preload 里要用 Node 的 http/https 实现 lx.request，所以不能开 sandbox: true；
        // 隔离靠 contextIsolation + 不enable任何 Node integration（与 ikun 一致）。
        sandbox: false,
        spellcheck: false,
        images: false,
        webgl: false,
        enableWebSQL: false,
        disableDialogs: true,
        autoplayPolicy: 'document-user-activation-required',
        preload: path.join(__dirname, 'preload.cjs'),
      },
    });
    win = created;

    const denyEvents = [
      'will-navigate',
      'will-redirect',
      'will-attach-webview',
      'will-prevent-unload',
      'media-started-playing',
    ];
    for (const eventName of denyEvents) {
      created.webContents.on(eventName, (event) => event.preventDefault());
    }
    created.webContents.session.setPermissionRequestHandler((webContents, permission, resolve) => {
      resolve(false);
    });
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.on('closed', () => {
      // 只有「当前窗口」才允许清状态 / 拒绝初始化：旧窗口的 closed 事件可能在
      // 新窗口已经建好、pendingInit 已经挂上之后才派发，用身份判断避免误伤。
      if (win !== created) return;
      win = null;
      if (pendingInit) pendingInit.reject(new Error('自定义音源初始化被中断'));
    });

    await created.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(SANDBOX_HTML));
  };

  // 初始化当前音源：建窗口 → 下发脚本 → 等脚本上报 inited，拿到它支持的源与音质。
  const initActive = async () => {
    const current = readIndex();
    const id = current.activeId;
    if (!id) throw new Error('未选择自定义音源');
    const info = getInfoById(id);
    if (!info) throw new Error('自定义音源不存在');
    const script = readScript(id);
    if (!script) throw new Error('自定义音源脚本文件缺失');

    await createWindow();

    // loadURL 已经 resolve，说明页面与 preload 都已就绪，可以直接下发脚本。
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingInit = null;
        reject(new Error('自定义音源初始化超时'));
      }, REQUEST_TIMEOUT_MS);
      pendingInit = {
        resolve: (value) => {
          clearTimeout(timer);
          pendingInit = null;
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          pendingInit = null;
          reject(err);
        },
      };
      sendToSandbox(CHANNELS.initEnv, {
        ...info,
        script,
        proxy: { host: '', port: '' },
      });
    });

    if (result && result.id) {
      initResults[result.id] = result;
      activeInitResult = result;
    }
    return result;
  };

  // ---- 脚本 → 主进程 事件 ----
  const handleScriptInit = (payload) => {
    const params = payload || {};
    if (!pendingInit) return;
    if (params.status) {
      const data = params.data || {};
      pendingInit.resolve({ ...(getInfoById(readIndex().activeId) || {}), sources: data.sources || {} });
    } else {
      pendingInit.reject(new Error(params.message || '自定义音源初始化失败'));
    }
  };

  const handleResponse = (payload) => {
    const params = payload || {};
    const entry = requestQueue.get(params.data && params.data.requestKey);
    if (!entry) return;
    requestQueue.delete(params.data.requestKey);
    clearRequestTimeout(params.data.requestKey);
    if (params.status) entry.resolve(params.data.result);
    else entry.reject(new Error(params.message || '未知错误'));
  };

  // ---- IPC：渲染层 ----
  const registerIpc = () => {
    // 与 kugou / bodian 通道同源：一律走 ipcAccessGuard 的来源校验（拒绝非第一方窗口）。
    const guarded = (channel, handler) => {
      if (typeof createSenderGuardedHandler === 'function') {
        return createSenderGuardedHandler({ channel, isTrusted, handler });
      }
      return (event, ...args) => {
        if (!isTrusted(event)) throw new Error(`Untrusted renderer attempted to call the ${channel} channel.`);
        return handler(event, ...args);
      };
    };

    ipcMain.handle('luoxue-source:list', guarded('luoxue-source:list', () => readIndex().sources));

    ipcMain.handle('luoxue-source:getActiveId', guarded('luoxue-source:getActiveId', () => readIndex().activeId));

    ipcMain.handle('luoxue-source:save', guarded('luoxue-source:save', async (_event, payload) => {
      const { id, text, filePath } = payload || {};
      let scriptText = typeof text === 'string' && text ? text : null;
      if (!scriptText && filePath) scriptText = await fs.promises.readFile(filePath, 'utf8');
      if (!scriptText) throw new Error('自定义音源脚本内容为空');

      const parsed = parseScriptInfo(scriptText);
      const current = readIndex();
      const existing = id ? current.sources.find((s) => s.id === id) : null;
      const finalId = existing ? existing.id : makeId();
      const target = existing || { id: finalId };
      const merged = Object.assign(target, parsed, { id: finalId });

      if (!existing) current.sources.push(merged);
      ensureDirs();
      fs.writeFileSync(scriptPath(finalId), scriptText, 'utf8');
      writeIndex();
      return { ...merged };
    }));

    ipcMain.handle('luoxue-source:remove', guarded('luoxue-source:remove', (_event, id) => {
      const current = readIndex();
      const idx = current.sources.findIndex((s) => s.id === id);
      if (idx >= 0) current.sources.splice(idx, 1);
      if (current.activeId === id) current.activeId = null;
      delete initResults[id];
      deleteScriptFile(id);
      writeIndex();
    }));

    ipcMain.handle('luoxue-source:setActive', guarded('luoxue-source:setActive', async (_event, id) => {
      const current = readIndex();
      if (id == null) {
        current.activeId = null;
        writeIndex();
        closeWindow();
        return;
      }
      if (!current.sources.some((s) => s.id === id)) throw new Error('自定义音源不存在');
      if (current.activeId !== id) closeWindow();
      current.activeId = id;
      writeIndex();
    }));

    ipcMain.handle('luoxue-source:init', guarded('luoxue-source:init', async () => {
      // 未导入 / 未选中自定义音源是正常状态（洛雪此时只能浏览目录，不能播放），返回 null 而不抛错：
      // 抛出会被 Electron 记成「Error occurred in handler」，每次启动都留一条无意义的错误。
      // 渲染层把 null 视为「没有可用音源」（ready=false），语义一致。
      if (!readIndex().activeId) return null;
      return await initActive();
    }));

    // 调用命名 action：把请求下发到沙箱，等待脚本返回；超时或脚本报错时用 reject 表达。
    ipcMain.handle('luoxue-source:invoke', guarded('luoxue-source:invoke', async (_event, params) => {
      const { requestKey, source, action, info } = params || {};
      if (!requestKey) throw new Error('缺少 requestKey');
      return await new Promise((resolve, reject) => {
        requestQueue.set(requestKey, { resolve, reject, params });
        requestTimeouts.set(requestKey, setTimeout(() => {
          cancelRequest(requestKey);
        }, REQUEST_TIMEOUT_MS));
        sendToSandbox(CHANNELS.request, { requestKey, data: { source, action, info } });
      });
    }));

    ipcMain.handle('luoxue-source:cancel', guarded('luoxue-source:cancel', (_event, requestKey) => {
      cancelRequest(requestKey);
    }));

    // 渲染层受 CORS 限制，没法直接请求第三方音乐接口；这里代它在主进程发请求。返回值与脚本 invoke 的
    // 语义（promise 解析 / 抛出）一致：成功时回原始字节，失败时抛出可读的错误信息。
    ipcMain.handle('luoxue-source:http', guarded('luoxue-source:http', async (_event, params) => {
      const { requestKey, url, method, headers, body, timeoutMs } = params || {};
      if (typeof requestKey !== 'string' || !requestKey) throw new Error('缺少 requestKey');
      return await performHttpRequest({ requestKey, url, method, headers, body, timeoutMs });
    }));

    // HTTP 取消走独立通道（而非复用 luoxue-source:cancel）：它的 requestKey 命名空间与脚本 invoke 完全分开
    // （渲染层用 'http__' 前缀），互不干扰；独立通道也让「取消一次 HTTP」与「取消一次脚本调用」互不误伤。
    ipcMain.handle('luoxue-source:http-cancel', guarded('luoxue-source:http-cancel', (_event, requestKey) => {
      cancelHttpRequest(requestKey);
    }));

    ipcMain.handle('luoxue-source:getInfo', guarded('luoxue-source:getInfo', () => {
      if (activeInitResult) {
        return {
          ...(getInfoById(activeInitResult.id) || {}),
          sources: activeInitResult.sources || {},
        };
      }
      const id = readIndex().activeId;
      const info = id ? getInfoById(id) : null;
      if (!info) return null;
      return { ...info, sources: (initResults[id] && initResults[id].sources) || {} };
    }));

    // 选择下载目录：返回绝对路径；用户取消时返回 null。dialog 惰性 require，保持模块在非 Electron 环境可被 import。
    ipcMain.handle('luoxue-source:select-directory', guarded('luoxue-source:select-directory', async () => {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths.length) return null;
      return result.filePaths[0];
    }));

    // 在系统文件管理器里定位已下载的文件（对应 lx 下载页的「打开文件位置」）。shell 同样惰性 require。
    ipcMain.handle('luoxue-source:show-item-in-folder', guarded('luoxue-source:show-item-in-folder', (_event, filePath) => {
      if (typeof filePath !== 'string' || !filePath) return false;
      if (!fs.existsSync(filePath)) return false;
      const { shell } = require('electron');
      shell.showItemInFolder(filePath);
      return true;
    }));

    // 下载一首歌（或其侧车文件）到本地：进度通过 luoxue-source:download-progress 回报渲染层。
    ipcMain.handle('luoxue-source:download', guarded('luoxue-source:download', async (event, payload) => {
      return await performDownload(event, payload);
    }));

    // 按 taskId 中断在途下载；请求已完成时是安全的空操作。
    ipcMain.handle('luoxue-source:download-cancel', guarded('luoxue-source:download-cancel', (_event, taskId) => {
      const controller = downloads.get(taskId);
      if (controller) controller.abort();
    }));

    // 写文本文件（歌词 .lrc 侧车文件）。
    ipcMain.handle('luoxue-source:write-text-file', guarded('luoxue-source:write-text-file', async (_event, payload) => {
      return await performWriteTextFile(payload);
    }));

    // 把封面 / 歌词嵌入音频文件（只支持 .mp3 / .flac，见 tags.cjs）。封面在主进程取，避免渲染层 CORS。
    ipcMain.handle('luoxue-source:write-tags', guarded('luoxue-source:write-tags', async (_event, payload) => {
      const { filePath, meta, timeoutMs } = payload || {};
      return await writeTags({ filePath, meta, timeoutMs, fetchCover });
    }));

    // ---- 沙箱 → 主进程 ----
    ipcMain.on(CHANNELS.scriptInit, (_event, payload) => handleScriptInit(payload));
    ipcMain.on(CHANNELS.response, (_event, payload) => handleResponse(payload));
    ipcMain.on(CHANNELS.openDevTools, () => {
      if (win && !win.isDestroyed()) win.webContents.openDevTools({ mode: 'detach' });
    });
    ipcMain.on(CHANNELS.showUpdateAlert, () => {
      // folia 没有「源更新提醒」弹窗；这里只记录，避免脚本调用时静默丢失语义。
    });
  };

  const dispose = () => {
    for (const key of requestQueue.keys()) cancelRequest(key);
    for (const controller of httpControllers.values()) controller.abort();
    httpControllers.clear();
    // 中止在途下载，避免窗口销毁后仍有写入流挂在半成品文件上。
    for (const controller of downloads.values()) controller.abort();
    downloads.clear();
    closeWindow();
    initResults = {};
    activeInitResult = null;
  };

  return { registerIpc, dispose, initActive, readIndex };
}

module.exports = { createLuoxueSourceHost, parseScriptInfo, SANDBOX_HTML };
