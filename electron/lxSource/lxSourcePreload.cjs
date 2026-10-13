// electron/lxSource/lxSourcePreload.cjs
// 自定义音源宿主窗口的 preload：向页面主世界注入 `globalThis.lx`，承载用户脚本与主进程之间的
// 请求往返。对应洛雪 lx-music-desktop 的 src/main/modules/userApi/renderer/preload.js（Apache-2.0）。
//
// 与洛雪实现的差异：
// - 用 Node 内置 `http` / `https` 取代 `needle`：宿主页带 `default-src 'none'` 的 CSP，且页面处于
//   `data:` 形成的 opaque origin，页面里的全局 fetch 会被 CSP / CORS 拦下（脚本侧只会看到 Failed to fetch），
//   所以 preload 侧的出网必须走 Node 的 http 栈——这与洛雪用 needle 的语义一致。
// - 不引入 `tunnel` 代理：本期忽略代理，`getRequestAgent` 一并不需要；
// - `crypto` / `zlib` 改用 `node:` 内置模块；
// - `handleInit` 不再用固定白名单丢弃平台：脚本声明什么就接受什么（见 handleInit 注释）。
const { contextBridge, ipcRenderer, webFrame } = require('electron');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const {
  createCipheriv,
  publicEncrypt,
  constants,
  randomBytes,
  createHash,
} = require('node:crypto');
const {
  LX_SOURCE_EVENT_NAMES: EVENT_NAMES,
  LX_SOURCE_CHANNELS: CHANNELS,
} = require('./lxSourceChannels.cjs');

const eventNames = Object.values(EVENT_NAMES);
const events = {
  request: null,
};

let isInitedApi = false;
let isShowedUpdateAlert = false;

// 官方规范里非 local 源只支持 musicUrl；这里保留 lyric / pic 让脚本自行决定是否处理，
// 多出来的声明不会让初始化失败。
const KNOWN_ACTIONS = ['musicUrl', 'lyric', 'pic'];
const KNOWN_QUALITYS = ['128k', '320k', 'flac', 'flac24bit'];
const DEFAULT_ACTIONS = ['musicUrl'];
const DEFAULT_QUALITYS = ['128k', '320k', 'flac', 'flac24bit'];

const sendMessage = (channel, data, status, message) => {
  ipcRenderer.send(channel, { data, status, message });
};

const MAX_REQUEST_TIMEOUT_MS = 60_000;

/** 脚本初始化失败 / 抛异常只上报一次，避免刷屏。 */
const onError = (errorMessage) => {
  if (isInitedApi) return;
  isInitedApi = true;
  const message = typeof errorMessage === 'string' && errorMessage.length > 1024
    ? `${errorMessage.slice(0, 1024)}...`
    : String(errorMessage ?? '');
  sendMessage(CHANNELS.init, null, false, message);
};

const verifyLyricInfo = (info) => {
  if (typeof info !== 'object' || info === null || typeof info.lyric !== 'string') throw new Error('failed');
  if (info.lyric.length > 51200) throw new Error('failed');
  return {
    lyric: info.lyric,
    tlyric: (typeof info.tlyric === 'string' && info.tlyric.length < 5120) ? info.tlyric : null,
    rlyric: (typeof info.rlyric === 'string' && info.rlyric.length < 5120) ? info.rlyric : null,
    lxlyric: (typeof info.lxlyric === 'string' && info.lxlyric.length < 8192) ? info.lxlyric : null,
  };
};

const isBinary = (value) => ArrayBuffer.isView(value) || value instanceof ArrayBuffer;

/** 把普通对象按 needle 的语义转成 multipart FormData。 */
const buildFormData = (input) => {
  if (typeof FormData !== 'undefined' && input instanceof FormData) return input;
  const form = new FormData();
  for (const [key, entry] of Object.entries(input || {})) {
    if (entry == null) continue;
    // needle 的 { value, options } 形态：value 可为 Buffer，options.filename 指定文件名。
    const isWrapped = typeof entry === 'object' && !isBinary(entry) && 'value' in entry;
    const value = isWrapped ? entry.value : entry;
    const filename = isWrapped ? entry.options?.filename : undefined;
    if (value == null) continue;
    if (isBinary(value)) form.append(key, new Blob([value]), filename || key);
    else form.append(key, String(value));
  }
  return form;
};

/** 把普通对象按 `application/x-www-form-urlencoded` 编码。 */
const buildUrlEncoded = (input) => {
  if (typeof URLSearchParams !== 'undefined' && input instanceof URLSearchParams) return input;
  const params = new URLSearchParams();
  for (const [key, entry] of Object.entries(input || {})) {
    if (entry == null) continue;
    const isWrapped = typeof entry === 'object' && 'value' in entry;
    const value = isWrapped ? entry.value : entry;
    if (value == null) continue;
    params.append(key, String(value));
  }
  return params;
};

const hasHeader = (headers, name) => (
  Object.keys(headers || {}).some(key => key.toLowerCase() === name)
);

/**
 * 用 Node 的 http / https 发起一次请求，归一化成 needle 的响应形态（`statusCode / statusMessage /
 * headers / raw`）。不走页面全局 fetch：宿主页 CSP 为 `default-src 'none'`，fetch 会被拦掉。
 */
const nodeHttpRequest = (url, init, controller) => new Promise((resolve, reject) => {
  let target;
  try {
    target = new URL(url);
  } catch {
    reject(new Error(`Invalid URL: ${url}`));
    return;
  }
  const lib = target.protocol === 'http:' ? http : https;
  const headers = { ...(init.headers || {}) };
  let payload = null;
  if (init.body != null) {
    payload = (Buffer.isBuffer(init.body) || ArrayBuffer.isView(init.body))
      ? Buffer.from(init.body)
      : Buffer.from(String(init.body));
    // 有 body 时显式给出长度，避免个别服务端不认 chunked 传输。
    if (!hasHeader(headers, 'content-length')) headers['Content-Length'] = String(payload.length);
  }

  const request = lib.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method: init.method || 'GET',
    headers,
  }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      headers: response.headers,
      raw: Buffer.concat(chunks),
    }));
    response.on('error', reject);
  });

  request.on('error', reject);
  if (controller) {
    const cancel = () => request.destroy(new Error('Cancel request'));
    if (controller.signal.aborted) cancel();
    else controller.signal.addEventListener('abort', cancel, { once: true });
  }
  if (payload) request.write(payload);
  request.end();
});

/**
 * 执行一次 HTTP 请求并归一化成 needle 的响应形态：
 * `{ statusCode, statusMessage, headers, bytes, raw, body }`，其中 `raw` 是 Buffer、`body` 是
 * JSON 解析结果（解析失败则退回字符串）。
 */
const performRequest = async (url, options, controller) => {
  const { method = 'get', timeout, headers, body, form, formData } = options || {};

  const init = { method: String(method).toUpperCase(), headers: headers || {} };
  let payload;
  if (body != null) {
    payload = (typeof body === 'string' || Buffer.isBuffer(body) || ArrayBuffer.isView(body))
      ? body
      : JSON.stringify(body);
  } else if (form != null) {
    payload = buildUrlEncoded(form).toString();
    if (!hasHeader(init.headers, 'content-type')) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  } else if (formData != null) {
    // multipart 的字节序列化借 Chromium 的 Response 完成（只做编码，不发起网络请求）。
    const encoded = new Response(buildFormData(formData));
    payload = Buffer.from(await encoded.arrayBuffer());
    const contentType = encoded.headers.get('content-type');
    if (contentType) init.headers['Content-Type'] = contentType;
  }

  const timeoutMs = typeof timeout === 'number' && timeout > 0
    ? Math.min(timeout, MAX_REQUEST_TIMEOUT_MS)
    : MAX_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { statusCode, statusMessage, headers: responseHeaders, raw } = await nodeHttpRequest(
      url,
      { ...init, body: payload },
      controller,
    );
    const text = raw.toString();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON：保留字符串 */ }
    const normalizedHeaders = {};
    for (const [key, value] of Object.entries(responseHeaders || {})) {
      normalizedHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    return {
      response: {
        statusCode,
        statusMessage,
        headers: normalizedHeaders,
        bytes: raw.length,
        raw,
        body: parsed,
      },
      body: parsed,
    };
  } finally {
    clearTimeout(timer);
  }
};

const handleRequest = (context, { requestKey, data }) => {
  if (!events.request) {
    sendMessage(CHANNELS.response, { requestKey }, false, 'Request event is not defined');
    return;
  }
  try {
    events.request.call(context, { source: data.source, action: data.action, info: data.info }).then((response) => {
      const sendData = { requestKey };
      switch (data.action) {
        case 'musicUrl':
          if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed');
          sendData.result = {
            source: data.source,
            action: data.action,
            data: { type: data.info.type, url: response },
          };
          break;
        case 'lyric':
          sendData.result = { source: data.source, action: data.action, data: verifyLyricInfo(response) };
          break;
        case 'pic':
          if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed');
          sendData.result = { source: data.source, action: data.action, data: response };
          break;
        default:
          throw new Error(`action not support: ${data.action}`);
      }
      sendMessage(CHANNELS.response, sendData, true);
    }).catch((err) => {
      sendMessage(CHANNELS.response, { requestKey }, false, err?.message ?? String(err));
    });
  } catch (err) {
    sendMessage(CHANNELS.response, { requestKey }, false, err?.message ?? String(err));
  }
};

/**
 * 脚本自报家门。返回归一化后的 sources 给主进程。
 *
 * 与洛雪不同：洛雪只放行写死的 `['kw','kg','tx','wy','mg','local']`，其余平台（qs/bili/ytb/xm…）
 * 会被静默丢弃。这里改为「脚本声明什么就接受什么」，只对 action / quality 做已知集合收敛，
 * 这样才能支撑第三方音源脚本里同时出现的多个平台。
 */
const handleInit = (context, info) => {
  if (!info) {
    sendMessage(CHANNELS.init, null, false, 'Missing required parameter init info');
    return;
  }
  if (info.openDevTools === true) {
    sendMessage(CHANNELS.openDevTools);
  }
  const sourceInfo = { sources: {} };
  try {
    for (const [source, userSource] of Object.entries(info.sources || {})) {
      if (!userSource || userSource.type !== 'music') continue;
      const declaredActions = Array.isArray(userSource.actions) ? userSource.actions : DEFAULT_ACTIONS;
      const declaredQualitys = Array.isArray(userSource.qualitys) ? userSource.qualitys : DEFAULT_QUALITYS;
      const actions = declaredActions.filter(action => KNOWN_ACTIONS.includes(action));
      const qualitys = source === 'local'
        ? []
        : declaredQualitys.filter(quality => KNOWN_QUALITYS.includes(quality));
      sourceInfo.sources[source] = {
        type: 'music',
        actions: actions.length ? actions : DEFAULT_ACTIONS,
        qualitys,
      };
    }
  } catch (error) {
    sendMessage(CHANNELS.init, null, false, error?.message ?? String(error));
    return;
  }
  sendMessage(CHANNELS.init, sourceInfo, true);

  ipcRenderer.on(CHANNELS.request, (_event, data) => {
    handleRequest(context, data);
  });
};

const handleShowUpdateAlert = (data, resolve, reject) => {
  if (!data || typeof data !== 'object') {
    reject(new Error('parameter format error.'));
    return;
  }
  if (!data.log || typeof data.log !== 'string') {
    reject(new Error('log is required.'));
    return;
  }
  const payload = { log: data.log };
  if (data.updateUrl && /^https?:\/\/[^\s$.?#].[^\s]*$/.test(data.updateUrl) && data.updateUrl.length <= 1024) {
    payload.updateUrl = data.updateUrl;
  }
  if (payload.log.length > 1024) payload.log = `${payload.log.slice(0, 1024)}...`;
  sendMessage(CHANNELS.showUpdateAlert, payload);
  resolve();
};

const initEnv = (userApiInfo) => {
  contextBridge.exposeInMainWorld('lx', {
    EVENT_NAMES,
    request(url, options, callback) {
      const controller = new AbortController();
      const context = this;
      // 先返回取消函数：脚本可能在回调回来之前就调用它（needle 的 abort 语义）。
      performRequest(url, options, controller).then(
        ({ response, body }) => callback.call(context, null, response, body),
        (err) => {
          const error = err instanceof Error ? err : new Error(String(err));
          callback.call(context, error, null, null);
        },
      ).catch((err) => onError(err?.message ?? String(err)));
      return () => {
        try { controller.abort(); } catch { /* 已结束 */ }
      };
    },
    send(eventName, data) {
      return new Promise((resolve, reject) => {
        if (!eventNames.includes(eventName)) {
          reject(new Error(`The event is not supported: ${eventName}`));
          return;
        }
        switch (eventName) {
          case EVENT_NAMES.inited:
            if (isInitedApi) {
              reject(new Error('Script is inited'));
              return;
            }
            isInitedApi = true;
            handleInit(this, data);
            resolve();
            break;
          case EVENT_NAMES.updateAlert:
            if (isShowedUpdateAlert) {
              reject(new Error('The update alert can only be called once.'));
              return;
            }
            isShowedUpdateAlert = true;
            handleShowUpdateAlert(data, resolve, reject);
            break;
          default:
            reject(new Error(`Unknown event name: ${eventName}`));
        }
      });
    },
    on(eventName, handler) {
      if (!eventNames.includes(eventName)) {
        return Promise.reject(new Error(`The event is not supported: ${eventName}`));
      }
      if (eventName === EVENT_NAMES.request) {
        events.request = handler;
        return Promise.resolve();
      }
      return Promise.reject(new Error(`The event is not supported: ${eventName}`));
    },
    utils: {
      crypto: {
        aesEncrypt(buffer, mode, key, iv) {
          const cipher = createCipheriv(mode, key, iv);
          return Buffer.concat([cipher.update(buffer), cipher.final()]);
        },
        rsaEncrypt(buffer, key) {
          const padded = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer]);
          return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, padded);
        },
        randomBytes(size) {
          return randomBytes(size);
        },
        md5(str) {
          return createHash('md5').update(str).digest('hex');
        },
      },
      buffer: {
        from(...args) {
          return Buffer.from(...args);
        },
        bufToString(buf, format) {
          return Buffer.from(buf, 'binary').toString(format);
        },
      },
      zlib: {
        inflate(buf) {
          return new Promise((resolve, reject) => {
            zlib.inflate(buf, (err, data) => (err ? reject(new Error(err.message)) : resolve(data)));
          });
        },
        deflate(data) {
          return new Promise((resolve, reject) => {
            zlib.deflate(data, (err, buf) => (err ? reject(new Error(err.message)) : resolve(buf)));
          });
        },
      },
    },
    currentScriptInfo: {
      name: userApiInfo.name,
      description: userApiInfo.description,
      version: userApiInfo.version,
      author: userApiInfo.author,
      homepage: userApiInfo.homepage,
      rawScript: userApiInfo.script,
    },
    version: '2.0.0',
    env: 'desktop',
  });

  contextBridge.exposeInMainWorld('__lx_init_error_handler__', {
    sendError(errorMessage) {
      onError(errorMessage);
    },
  });

  // 脚本在初始化阶段抛错时，让主进程把它显示成「初始化失败」而不是静默什么都不发生。
  webFrame.executeJavaScript(`(() => {
window.addEventListener('error', (event) => {
  if (event.isTrusted) globalThis.__lx_init_error_handler__.sendError(event.message.replace(/^Uncaught\\sError:\\s/, ''))
})
window.addEventListener('unhandledrejection', (event) => {
  if (!event.isTrusted) return
  const message = typeof event.reason === 'string' ? event.reason : event.reason?.message ?? String(event.reason)
  globalThis.__lx_init_error_handler__.sendError(message.replace(/^Error:\\s/, ''))
})
})()`);

  webFrame.executeJavaScript(userApiInfo.script).catch(() => {});
};

ipcRenderer.on(CHANNELS.initEnv, (_event, data) => {
  initEnv(data);
});
