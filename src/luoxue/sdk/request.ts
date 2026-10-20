/**
 * 音源 SDK 的请求层
 *
 * 替代 ikun 中基于 needle + tunnel 的 `@renderer/utils/request`：保留 `httpFetch(url, options)`
 * 的调用语义与返回结构（`{ promise, cancelHttp, isCancelled }`，promise 解析为
 * `{ statusCode, statusMessage, headers, raw, body }`），内部改用标准 `fetch` 实现。
 *
 * 音源侧只用到 method / headers / form / body / timeout，其余 needle 特有能力（代理、jsonp、
 * 进度回调、dns lookup 等）不再保留。
 */

// src/luoxue/sdk/request.ts

import { bHh } from './options'

/** 响应结构（needle 风格，音源侧读取 body / statusCode / raw / headers） */
export interface HttpResponse {
  statusCode: number
  statusMessage: string
  headers: Record<string, any>
  /** 原始响应体 */
  raw: Buffer
  /** 尝试 JSON.parse 后的响应体，失败则为原始字符串 */
  body: any
}

/**
 * httpFetch 的返回值
 *
 * `promise` 有意声明为 `Promise<any>`：音源会把它替换成解析后处理过的 promise
 * （例如 `.then(({ body }) => ({ lyric, tlyric }))`），与原版对调用方的宽松程度一致。
 */
export interface HttpFetchResult {
  promise: Promise<any>
  cancelHttp: () => void
  isCancelled: boolean
}

/** httpFetch 的选项 */
export interface HttpFetchOptions {
  method?: string
  headers?: Record<string, any>
  /** 请求体：对象会按 JSON 序列化 */
  body?: any
  /** 表单参数：会按 application/x-www-form-urlencoded 序列化 */
  form?: Record<string, any>
  timeout?: number
  [key: string]: any
}

/** 主进程 HTTP 代理的返回结构；与 electron/luoxueSource/index.cjs 的 luoxue-source:http 契约一致。 */
interface LuoxueHttpResult {
  statusCode: number
  statusMessage?: string
  headers?: Record<string, any>
  /** set-cookie 已在 headers 里以数组返回，这里额外冗余一份，便于单独读取。 */
  setCookie?: string[]
  /** 响应原始字节的 base64；主进程不解码文本，解码 / 解压留给 SDK。 */
  bodyBase64?: string
}

/** Electron 渲染层注入的 HTTP 代理桥；浏览器构建下不存在，request 会退回标准 fetch。 */
interface LuoxueHttpBridge {
  http(params: {
    requestKey: string
    url: string
    method: string
    headers: Record<string, any>
    body?: any
    timeoutMs?: number
  }): Promise<LuoxueHttpResult>
  httpCancel(requestKey: string): Promise<void> | void
}

/** 读取 Electron 注入的 HTTP 代理桥；不在 Electron 环境或未暴露 http 时返回 null。 */
const getHttpBridge = (): LuoxueHttpBridge | null => {
  if (typeof window === 'undefined') return null
  const electron = (window as unknown as { electron?: { luoxueSource?: Partial<LuoxueHttpBridge> } }).electron
  const bridge = electron?.luoxueSource
  if (!bridge || typeof bridge.http !== 'function') return null
  return bridge as LuoxueHttpBridge
}

const defaultHeaders: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}

/** 把 form / body 转换成 fetch 需要的请求体与 Content-Type */
const buildRequestBody = (options: HttpFetchOptions): { body?: any; contentType?: string } => {
  if (options.form) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(options.form)) {
      if (value == null) continue
      params.append(key, typeof value === 'string' ? value : String(value))
    }
    return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' }
  }
  if (options.body != null) {
    if (typeof options.body === 'string') return { body: options.body }
    return { body: JSON.stringify(options.body), contentType: 'application/json' }
  }
  return {}
}

/** 把 fetch 的 Headers 转成 needle 风格的对象（set-cookie 为数组，其余为字符串） */
const buildResponseHeaders = (res: Response): Record<string, any> => {
  const headers: Record<string, any> = {}
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  const getSetCookie = (res.headers as any).getSetCookie
  if (typeof getSetCookie === 'function') {
    const cookies: string[] = getSetCookie.call(res.headers)
    if (cookies.length) headers['set-cookie'] = cookies
  }
  return headers
}

/** 归一化主进程返回的响应头：键转小写，set-cookie 保持数组（音源依赖它读 cookie）。 */
const normalizeBridgeHeaders = (headers?: Record<string, any>, setCookie?: string[]): Record<string, any> => {
  const result: Record<string, any> = {}
  if (headers) {
    for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = value
  }
  if (setCookie && setCookie.length) result['set-cookie'] = setCookie
  return result
}

/**
 * 经 Electron 主进程代理发请求（webSecurity:true 下渲染层请求第三方接口会被 CORS 拦下）。
 * 请求头 / 请求体由调用方先构建好，主进程只做转发；返回值归一化成与 fetch 路径完全一致的 needle 风格结构。
 */
const requestThroughBridge = async (
  bridge: LuoxueHttpBridge,
  requestKey: string,
  url: string,
  method: string,
  requestHeaders: Record<string, any>,
  body: any,
  timeout: number,
  wasCancelled: () => boolean
): Promise<HttpResponse> => {
  let result: LuoxueHttpResult
  try {
    result = await bridge.http({
      requestKey,
      url,
      method: method.toUpperCase(),
      headers: requestHeaders,
      body: body ?? null,
      timeoutMs: timeout,
    })
  } catch (err: any) {
    if (wasCancelled()) throw new Error('请求已取消')
    const message = err && err.message ? String(err.message) : String(err)
    if (/请求超时|timeout/i.test(message)) {
      const timeoutError = new Error('请求超时')
      timeoutError.name = 'TimeoutError'
      throw timeoutError
    }
    if (/请求已取消|cancel/i.test(message)) throw new Error('请求已取消')
    throw err instanceof Error ? err : new Error(message)
  }

  const raw = Buffer.from(result.bodyBase64 || '', 'base64')
  const text = raw.toString()
  let parsed: any = text
  try {
    parsed = JSON.parse(text)
  } catch {}
  return {
    statusCode: result.statusCode,
    statusMessage: result.statusMessage || '',
    headers: normalizeBridgeHeaders(result.headers, result.setCookie),
    raw,
    body: parsed,
  }
}

/** 单次请求的运行时上下文：signal 供浏览器路径控制超时/取消，requestKey 供主进程代理路径使用。 */
interface RequestContext {
  signal: AbortSignal
  requestKey: string
  /** 调用方是否已主动取消，供代理路径把异常归一化成“请求已取消”。 */
  wasCancelled: () => boolean
}

/** 单次请求：Electron 下走主进程代理，浏览器下用 AbortController 控制超时与取消 */
const request = async (
  url: string,
  method: string,
  options: HttpFetchOptions,
  context: RequestContext
): Promise<HttpResponse> => {
  const { headers = {}, timeout = 15000 } = options
  const requestHeaders: Record<string, any> = Object.assign({}, defaultHeaders, headers)
  // ikun 请求层会给自家服务端加混淆头（bHh），folia 侧没有该服务端，直接丢弃
  delete requestHeaders[bHh]

  const bodyInfo = buildRequestBody(options)
  if (bodyInfo.contentType && requestHeaders['Content-Type'] == null) {
    requestHeaders['Content-Type'] = bodyInfo.contentType
  }

  // Electron 渲染层受 webSecurity 的 CORS 限制，改由主进程代发；浏览器构建没有桥，保持原 fetch 路径。
  const bridge = getHttpBridge()
  if (bridge) {
    return requestThroughBridge(
      bridge,
      context.requestKey,
      url,
      method,
      requestHeaders,
      bodyInfo.body,
      timeout,
      context.wasCancelled
    )
  }

  const { signal } = context
  const timeoutError = new Error('请求超时')
  timeoutError.name = 'TimeoutError'

  const timeoutTimer = setTimeout(() => {
    ;(signal as unknown as { abort?: (reason?: any) => void }).abort?.(timeoutError)
  }, timeout)

  try {
    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers: requestHeaders,
      body: bodyInfo.body,
      signal,
    })
    const raw = Buffer.from(await res.arrayBuffer())
    const text = raw.toString()
    let body: any = text
    try {
      body = JSON.parse(text)
    } catch {}
    return {
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: buildResponseHeaders(res),
      raw,
      body,
    }
  } catch (err: any) {
    const reason = (signal as unknown as { reason?: any }).reason
    if (reason && reason.name === 'TimeoutError') throw new Error('请求超时')
    if (signal.aborted) throw new Error('请求已取消')
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    clearTimeout(timeoutTimer)
  }
}

/**
 * promise 形式的请求方法
 * @param url 请求地址
 * @param options 请求选项
 */
export const httpFetch = (url: string, options: HttpFetchOptions = {}): HttpFetchResult => {
  const controller = new AbortController()
  // requestKey 与自定义音源脚本的 requestKey（'request__' 前缀）用不同前缀区分，取消时两边互不影响。
  const requestKey = `http__${Math.random().toString(36).slice(2)}`
  const requestObj: HttpFetchResult = {
    isCancelled: false,
    cancelHttp: () => {
      if (requestObj.isCancelled) return
      requestObj.isCancelled = true
      controller.abort()
      // 走主进程代理时，AbortController 管不到它，必须再通知主进程中止在途请求；浏览器路径下桥为 null。
      const bridge = getHttpBridge()
      if (bridge && typeof bridge.httpCancel === 'function') {
        void Promise.resolve(bridge.httpCancel(requestKey)).catch(() => {})
      }
    },
    promise: null as unknown as Promise<HttpResponse>,
  }
  requestObj.promise = request(url, options.method ?? 'get', options, {
    signal: controller.signal,
    requestKey,
    wasCancelled: () => requestObj.isCancelled,
  })
  return requestObj
}

/** 取消请求 */
export const cancelHttp = (requestObj: HttpFetchResult | null | undefined): void => {
  if (!requestObj) return
  requestObj.cancelHttp()
}
