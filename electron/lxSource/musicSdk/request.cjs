// electron/lxSource/musicSdk/request.cjs
// 洛雪 musicSdk 的 httpFetch 在主进程里的 Node 版实现。
// 移植自 lx-music-desktop（Apache-2.0）src/renderer/utils/request.js，用全局 fetch 替代 needle，
// 但保留 `{ promise, cancelHttp }` 与 `{ statusCode, body, headers }` 的调用契约，
// 让上层移植过来的平台代码无需改动用法。
// 代理能力本期从简（不接 ProxyAgent），与方案「Phase 2 代理从简」一致。

const DEFAULT_TIMEOUT = 15000;

// 上游有的是标准 JSON，有的是一段带单引号的类 JSON 文本：解析失败就原样返回字符串。
const parseBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * 发起一次 HTTP 请求。
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, form?: Record<string, string>, body?: string, timeout?: number }} [options]
 * @returns {{ promise: Promise<{ statusCode: number, body: any, headers: Record<string, string>, raw: string }>, cancelHttp: () => void }}
 */
const httpFetch = (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT);

  const promise = (async () => {
    try {
      const headers = { ...(options.headers || {}) };
      const init = { method: (options.method || 'get').toUpperCase(), headers, signal: controller.signal };
      if (options.form) {
        init.body = new URLSearchParams(options.form).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (options.body != null) {
        init.body = options.body;
      }
      const response = await fetch(url, init);
      const raw = await response.text();
      const responseHeaders = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      return { statusCode: response.status, body: parseBody(raw), headers: responseHeaders, raw };
    } finally {
      clearTimeout(timeout);
    }
  })();

  return { promise, cancelHttp: () => controller.abort() };
};

module.exports = { httpFetch };
