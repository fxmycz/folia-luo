'use strict';

// electron/luoxueSource/preload.cjs
// 洛雪自定义音源沙箱窗口的 preload。它把 lx 脚本约定的 window.lx 暴露给脚本，并把脚本与宿主之间的
// request / inited / updateAlert / 初始化错误 事件桥接到主进程。移植自 lx-music-desktop 的
// userApi/renderer/preload.js，差别只有两点：HTTP 请求改用 Node 内置 http/https 实现
// （folia 没有 needle / tunnel 依赖），事件通道名统一加 luoxue-source: 前缀。
const { contextBridge, ipcRenderer, webFrame } = require('electron');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { createCipheriv, publicEncrypt, constants, randomBytes, createHash } = require('crypto');

const CHANNELS = {
  initEnv: 'luoxue-source:initEnv',
  proxyUpdate: 'luoxue-source:proxyUpdate',
  init: 'luoxue-source:scriptInit',
  request: 'luoxue-source:request',
  response: 'luoxue-source:response',
  openDevTools: 'luoxue-source:openDevTools',
  showUpdateAlert: 'luoxue-source:showUpdateAlert',
};

// 脚本可用的音乐源与宿主放行的动作；初始化时用它裁剪脚本声明的 actions。
// 完全沿用 lx-music-desktop / ikun 的策略：自定义源只负责提供播放地址（musicUrl），
// 搜索 / 榜单 / 歌词等元数据能力由内置 provider 承担，因此这里只放行 musicUrl（local 额外放行 lyric/pic）。
//
// qualitys 不做裁剪：档位是「脚本自己声明、脚本自己兑现」的（下载/播放地址都由它提供），
// 宿主不能拿内置平台的能力表去砍它——那张表没有 192k / flac24bit，会把脚本明明声明了的档位悄悄吃掉。
const allSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'git', 'local'];
const supportActions = {
  kw: ['musicUrl'],
  kg: ['musicUrl'],
  tx: ['musicUrl'],
  wy: ['musicUrl'],
  mg: ['musicUrl'],
  git: ['musicUrl'],
  local: ['musicUrl', 'lyric', 'pic'],
};

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
};
const eventNames = Object.values(EVENT_NAMES);
const events = {
  request: null,
};

let isInitedApi = false;
let isShowedUpdateAlert = false;
// 代理只是为了让 lx 协议里的 proxyUpdate 通道有落点（folia 目前没有代理设置，主进程下发空值），
// lx.request 走 Node 内置 http/https，不带代理转发。
const proxy = { host: '', port: '' };

const sendMessage = (channel, data, status, message) => {
  ipcRenderer.send(channel, { data, status, message });
};

const verifyLyricInfo = (info) => {
  if (typeof info != 'object' || typeof info.lyric != 'string') throw new Error('failed');
  if (info.lyric.length > 51200) throw new Error('failed');
  return {
    lyric: info.lyric,
    tlyric: typeof info.tlyric == 'string' && info.tlyric.length < 5120 ? info.tlyric : null,
    rlyric: typeof info.rlyric == 'string' && info.rlyric.length < 5120 ? info.rlyric : null,
    lxlyric: typeof info.lxlyric == 'string' && info.lxlyric.length < 8192 ? info.lxlyric : null,
  };
};

// 把脚本对 window.lx.on('request') 的返回值规格化成 { source, action, data }。musicUrl / lyric / pic
// 的校验与 ikun 的 preload 完全一致；其余 action（search / leaderboard / songList / getTags / hotSearch）
// 在 ikun 里不会被请求、返回值被丢弃，这里原样透传，好让 folia 走同一条通道也能拿到数据。
const normalizeResult = (action, source, info, response) => {
  switch (action) {
    case 'musicUrl':
      if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) {
        throw new Error('failed');
      }
      return { source, action, data: { type: info && info.type, url: response } };
    case 'lyric':
      return { source, action, data: verifyLyricInfo(response) };
    case 'pic':
      if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) {
        throw new Error('failed');
      }
      return { source, action, data: response };
    default:
      return { source, action, data: response };
  }
};

// 处理主进程下发的 request：调用脚本注册的 handler，把结果或错误回传主进程。
const handleRequest = (context, { requestKey, data }) => {
  if (!events.request) {
    sendMessage(CHANNELS.response, { requestKey }, false, 'Request event is not defined');
    return;
  }
  try {
    events.request
      .call(context, { source: data.source, action: data.action, info: data.info })
      .then((response) => {
        const sendData = { requestKey };
        try {
          sendData.result = normalizeResult(data.action, data.source, data.info, response);
        } catch (err) {
          sendMessage(CHANNELS.response, { requestKey }, false, err.message);
          return;
        }
        sendMessage(CHANNELS.response, sendData, true);
      })
      .catch((err) => {
        sendMessage(CHANNELS.response, { requestKey }, false, err && err.message);
      });
  } catch (err) {
    sendMessage(CHANNELS.response, { requestKey }, false, err && err.message);
  }
};

// 校验并整理脚本初始化时声明的源信息：type 必须是 music；actions 只保留宿主放行的部分，
// qualitys 原样透传（脚本声明即权威，见上方说明）。
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
    for (const source of allSources) {
      const userSource = info.sources && info.sources[source];
      if (!userSource || userSource.type !== 'music') continue;
      const actions = supportActions[source];
      sourceInfo.sources[source] = {
        type: 'music',
        actions: actions.filter((a) => Array.isArray(userSource.actions) && userSource.actions.includes(a)),
        qualitys: Array.isArray(userSource.qualitys) ? userSource.qualitys.filter((q) => typeof q === 'string') : [],
      };
    }
  } catch (error) {
    sendMessage(CHANNELS.init, null, false, error && error.message);
    return;
  }
  sendMessage(CHANNELS.init, sourceInfo, true);

  ipcRenderer.on(CHANNELS.request, (event, data) => {
    handleRequest(context, data);
  });
};

const handleShowUpdateAlert = (data, resolve, reject) => {
  if (!data || typeof data != 'object') return reject(new Error('parameter format error.'));
  if (!data.log || typeof data.log != 'string') return reject(new Error('log is required.'));
  if (
    data.updateUrl &&
    !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(data.updateUrl) &&
    data.updateUrl.length > 1024
  ) {
    delete data.updateUrl;
  }
  if (data.log.length > 1024) data.log = data.log.substring(0, 1024) + '...';
  sendMessage(CHANNELS.showUpdateAlert, { log: data.log, updateUrl: data.updateUrl });
  resolve();
};

const onError = (errorMessage) => {
  if (isInitedApi) return;
  isInitedApi = true;
  if (errorMessage.length > 1024) errorMessage = errorMessage.substring(0, 1024) + '...';
  sendMessage(CHANNELS.init, null, false, errorMessage);
};

// ---- lx.request：用 Node 内置 http/https 复刻 needle 的请求/回调语义 ----
// 组装请求体：body=JSON、form=urlencoded、formData=multipart，与 lx 协议一致。
const buildRequestBody = (headers, body, form, formData) => {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    return Buffer.from(JSON.stringify(body), 'utf8');
  }
  if (form && typeof form === 'object') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) params.append(key, String(value));
    return Buffer.from(params.toString(), 'utf8');
  }
  if (formData && typeof formData === 'object') {
    const boundary = '----foliaLuoxue' + randomBytes(8).toString('hex');
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
    }
    const chunks = [];
    for (const [key, value] of Object.entries(formData)) {
      if (value == null) continue;
      if (typeof value === 'object' && 'buffer' in value) {
        const filename = value.filename || key;
        chunks.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${filename}"\r\n` +
          `Content-Type: ${value.contentType || 'application/octet-stream'}\r\n\r\n`,
        ));
        chunks.push(Buffer.isBuffer(value.buffer) ? value.buffer : Buffer.from(value.buffer));
        chunks.push(Buffer.from('\r\n'));
      } else {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return null;
};

// 与 needle 一样：回调入参为 (err, resp, body)，resp.body 会尽量 JSON.parse，raw 为原始 Buffer。
const handleHttpRequest = (url, options, callback) => {
  const {
    method = 'get',
    timeout,
    headers = {},
    body,
    form,
    formData,
  } = options || {};

  let finalUrl;
  try {
    finalUrl = new URL(url);
  } catch (err) {
    callback.call(null, err, null, null);
    return () => {};
  }

  const isHttps = finalUrl.protocol === 'https:';
  const transport = isHttps ? https : http;
  const requestBody = buildRequestBody(headers, body, form, formData);

  const requestOptions = {
    method: String(method).toUpperCase(),
    headers: { ...headers },
  };
  if (requestBody) requestOptions.headers['Content-Length'] = requestBody.length;

  let finished = false;
  const req = transport.request(finalUrl, requestOptions, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      if (finished) return;
      finished = true;
      try {
        const raw = Buffer.concat(chunks);
        const rawText = raw.toString();
        let parsedBody = rawText;
        try {
          parsedBody = JSON.parse(rawText);
        } catch (_) {}
        callback.call(
          null,
          null,
          {
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            bytes: raw.length,
            raw,
            body: parsedBody,
          },
          parsedBody,
        );
      } catch (err) {
        onError(err.message);
      }
    });
  });

  req.on('error', (err) => {
    if (finished) return;
    finished = true;
    callback.call(null, err, null, null);
  });

  const maxTimeout = typeof timeout == 'number' && timeout > 0 ? Math.min(timeout, 60000) : 60000;
  req.setTimeout(maxTimeout, () => {
    req.destroy(new Error('Request timeout'));
  });

  if (requestBody) req.write(requestBody);
  req.end();

  return () => {
    if (!finished) {
      finished = true;
      req.destroy();
    }
  };
};

const initEnv = (userApi) => {
  proxy.host = (userApi.proxy && userApi.proxy.host) || '';
  proxy.port = (userApi.proxy && userApi.proxy.port) || '';

  contextBridge.exposeInMainWorld('lx', {
    EVENT_NAMES,
    request(url, options, callback) {
      return handleHttpRequest(url, options, callback);
    },
    send(eventName, data) {
      return new Promise((resolve, reject) => {
        if (!eventNames.includes(eventName)) {
          return reject(new Error('The event is not supported: ' + eventName));
        }
        switch (eventName) {
          case EVENT_NAMES.inited:
            if (isInitedApi) return reject(new Error('Script is inited'));
            isInitedApi = true;
            handleInit(this, data);
            resolve();
            break;
          case EVENT_NAMES.updateAlert:
            if (isShowedUpdateAlert) {
              return reject(new Error('The update alert can only be called once.'));
            }
            isShowedUpdateAlert = true;
            handleShowUpdateAlert(data, resolve, reject);
            break;
          default:
            reject(new Error('Unknown event name: ' + eventName));
        }
      });
    },
    // 兼容部分脚本直接使用 lx.sendInited / lx.sendUpdateAlert 的写法。
    sendInited(data) {
      return this.send(EVENT_NAMES.inited, data);
    },
    sendUpdateAlert(data) {
      return this.send(EVENT_NAMES.updateAlert, data);
    },
    on(eventName, handler) {
      if (!eventNames.includes(eventName)) {
        return Promise.reject(new Error('The event is not supported: ' + eventName));
      }
      switch (eventName) {
        case EVENT_NAMES.request:
          events.request = handler;
          break;
        default:
          return Promise.reject(new Error('The event is not supported: ' + eventName));
      }
      return Promise.resolve();
    },
    utils: {
      crypto: {
        aesEncrypt(buffer, mode, key, iv) {
          const cipher = createCipheriv(mode, key, iv);
          return Buffer.concat([cipher.update(buffer), cipher.final()]);
        },
        rsaEncrypt(buffer, key) {
          buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer]);
          return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, buffer);
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
            zlib.inflate(buf, (err, data) => {
              if (err) reject(new Error(err.message));
              else resolve(data);
            });
          });
        },
        deflate(data) {
          return new Promise((resolve, reject) => {
            zlib.deflate(data, (err, buf) => {
              if (err) reject(new Error(err.message));
              else resolve(buf);
            });
          });
        },
      },
    },
    currentScriptInfo: {
      name: userApi.name,
      description: userApi.description,
      version: userApi.version,
      author: userApi.author,
      homepage: userApi.homepage,
      rawScript: userApi.script,
    },
    version: '2.0.0',
    env: 'desktop',
  });

  contextBridge.exposeInMainWorld('__lx_init_error_handler__', {
    sendError(errorMessage) {
      onError(errorMessage);
    },
  });

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

  webFrame.executeJavaScript(userApi.script).catch((_) => _);
};

ipcRenderer.on(CHANNELS.initEnv, (event, data) => {
  initEnv(data);
});

ipcRenderer.on(CHANNELS.proxyUpdate, (event, data) => {
  proxy.host = (data && data.host) || '';
  proxy.port = (data && data.port) || '';
});
