/**
 * 音源 SDK 公开入口
 *
 * 框架无关（不依赖 Vue/Vuex/Pinia、不依赖 @renderer 别名），供 React + zustand 侧调用。
 * 内部逻辑忠实移植自 ikun-music-desktop 的 `musicSdk`，仅替换了请求层与音源调度层。
 */

// src/luoxue/sdk/index.ts

import { apis, BUILTIN_SOURCES, builtinProviders, getCurrentSource, setCurrentSource, setUserApiRuntime } from './api-source'
import type {
  LxBoard,
  LxLyricResult,
  LxMusicInfo,
  LxQuality,
  LxSearchResult,
  LxSongListDetailResult,
  LxSongListInfo,
  LxSongListTag,
  LxSourceInfo,
} from './types'

export type { LxMusicInfo, LxQuality, LxBoard, LxSongListTag, LxSongListInfo, LxSourceInfo }
export type { LxSourceMeta, LxUserApiRuntime, LxSearchResult, LxSongListDetailResult, LxLyricResult } from './types'
export { BUILTIN_SOURCES, setCurrentSource, getCurrentSource, setUserApiRuntime }

/** 把值统一成 Promise：音源实现可能返回 Promise，也可能返回 `{ promise }` */
const toPromise = <T>(result: any): Promise<T> => {
  if (result && typeof result.then === 'function') return result
  if (result && result.promise) return result.promise
  return Promise.resolve(result)
}

/** 取出 provider / 自定义音源脚本的某个方法，取不到时给出明确报错 */
const requireFn = (owner: any, method: string): ((...args: any[]) => any) => {
  const fn = owner?.[method]
  if (typeof fn !== 'function') throw new Error(`当前音源不支持 ${method}`)
  return fn
}

/** 调用 provider / 自定义音源脚本的方法（自动绑定 this，并统一成 Promise） */
const invoke = (owner: any, method: string, ...args: any[]): Promise<any> =>
  toPromise(requireFn(owner, method).apply(owner, args))

/**
 * 解析某音源对应的能力实现
 * 内置音源优先（搜索/榜单/歌单等元数据能力都在内置 provider 中），否则取自定义音源运行时脚本。
 */
const resolveSource = (source: string): any => builtinProviders[source] ?? apis(source)

/**
 * 解析播放/歌词/封面这类需要返回地址或文本的能力实现
 *
 * 内置 provider 的 getMusicUrl 内部会调用 apis(platform) 把请求转发给自定义音源脚本，
 * 因此内置音源直接调用 provider；传入自定义音源 id 时，按歌曲自身所属平台去取脚本实现。
 */
const resolvePlaySource = (source: string, musicInfo: LxMusicInfo): any => {
  const provider = builtinProviders[source]
  if (provider) return provider
  const platform = /^user_api/.test(source) ? musicInfo?.source || source : source
  return apis(platform)
}

/** 归一化列表类返回（provider 返回 `{ list, total, source }` 风格的数据） */
const normalizeList = (res: any, source: string): LxSearchResult => {
  const list: LxMusicInfo[] = Array.isArray(res) ? res : res?.list ?? []
  return {
    list,
    total: Number(res?.total ?? list.length) || 0,
    source: res?.source ?? source,
  }
}

/** 归一化地址类返回值（可能是字符串，也可能是 `{ url }`） */
const normalizeUrl = (res: any): string =>
  typeof res === 'string' ? res : res?.url ?? res?.playUrl ?? ''

/**
 * 初始化 SDK
 * 内置音源是无状态的 provider，无需预热；该入口留给接入方在应用启动时调用。
 */
export function initSdk(): Promise<void> {
  return Promise.resolve()
}

/** 搜索音乐 */
export function searchMusic(
  source: string,
  keyword: string,
  page: number,
  limit: number
): Promise<LxSearchResult> {
  const target = resolveSource(source)
  // 内置音源把搜索挂在 musicSearch 上，自定义音源脚本可能直接挂在 api 上
  const searcher = target?.musicSearch ?? target
  return invoke(searcher, 'search', keyword, page, limit).then((res) => normalizeList(res, source))
}

/** 获取热门搜索词 */
export function getHotSearch(source: string): Promise<string[]> {
  const hotSearch = resolveSource(source)?.hotSearch
  return invoke(hotSearch, 'getList').then((res) => res?.list ?? [])
}

/**
 * 获取搜索联想词
 *
 * 联想是增强项：音源没实现 tipSearch（咪咕 / ChatMusic）或请求失败时都返回空数组，让搜索框安静地退化成
 * 只有历史与热搜，不要在打字时弹报错。
 */
export function getTipSearch(source: string, keyword: string): Promise<string[]> {
  const tipSearch = resolveSource(source)?.tipSearch
  if (!tipSearch || typeof tipSearch.search !== 'function') return Promise.resolve([])
  return invoke(tipSearch, 'search', keyword)
    .then((res: any) => (Array.isArray(res) ? res : []))
    .catch(() => [])
}

/** 获取排行榜分类列表 */
export function getLeaderboards(source: string): Promise<LxBoard[]> {
  const leaderboard = resolveSource(source)?.leaderboard
  return invoke(leaderboard, 'getBoards').then((res) => res?.list ?? [])
}

/** 获取排行榜详情（分页大小由音源自身决定） */
export function getLeaderboardDetail(
  source: string,
  boardId: string,
  page: number
): Promise<LxSearchResult> {
  const leaderboard = resolveSource(source)?.leaderboard
  return invoke(leaderboard, 'getList', boardId, page).then((res) => normalizeList(res, source))
}

/** 获取歌单标签（含热门标签） */
export function getSongListTags(source: string): Promise<{ tags: LxSongListTag[]; hotTags: any[] }> {
  const songList = resolveSource(source)?.songList
  return invoke(songList, 'getTags').then((res) => ({
    tags: res?.tags ?? [],
    // 各音源命名不统一：kw/wy/tx/git 返回 hotTag，kg 返回 hotTags
    hotTags: res?.hotTags ?? res?.hotTag ?? [],
  }))
}

/** 获取歌单列表（排序方式取音源 sortList 首项，分页大小由音源自身决定） */
export function getSongLists(
  source: string,
  tagId: string,
  page: number,
  _limit: number
): Promise<LxSearchResult> {
  const songList = resolveSource(source)?.songList
  const sortId = songList?.sortList?.[0]?.id ?? tagId
  return invoke(songList, 'getList', sortId, tagId, page).then((res) => normalizeList(res, source))
}

/** 搜索歌单：lx 各音源的 songList.search 都是「按关键词搜歌单」，返回结构与歌单列表一致 */
export function searchSongLists(
  source: string,
  keyword: string,
  page: number,
  limit: number
): Promise<LxSearchResult> {
  const songList = resolveSource(source)?.songList
  return invoke(songList, 'search', keyword, page, limit).then((res) => normalizeList(res, source))
}

/** 获取歌单详情（分页大小由音源自身决定） */
export function getSongListDetail(
  source: string,
  id: string,
  page: number,
  _limit: number
): Promise<LxSongListDetailResult> {
  const songList = resolveSource(source)?.songList
  return invoke(songList, 'getListDetail', id, page).then((res) => ({
    ...normalizeList(res, source),
    info: (res?.info as LxSongListInfo) ?? null,
  }))
}

/**
 * 播放地址缓存
 *
 * 自定义音源脚本按次计费（例如每日 300 次），同一首歌会被播放、队列邻居预取、下载分别问一次地址，
 * 重复问就会重复扣点；地址在有效期内可复用，所以这里按 lx desktop 的「播放链接缓存」思路缓存一份。
 * 按「歌曲主键 + 音源 + 音质」记一条：换音质、换音源都要重新取。缓存只在成功拿到地址后写入，失败不记。
 * 时长对齐 lx 的播放链接缓存（60 分钟）；地址真的先失效时，播放出错的恢复路径会先丢弃缓存再重取。
 */
const URL_CACHE_TTL_MS = 60 * 60 * 1000
/** 上限只用于兜底，防止长时间播放把内存撑大（超出后按写入顺序丢最早的）。 */
const URL_CACHE_MAX_ENTRIES = 500

type CachedMusicUrl = { url: string; fetchedAt: number }

const urlCache = new Map<string, CachedMusicUrl>()
/** 在途请求：同一首歌的并发取址（播放 + 预取同时发起）只问音源脚本一次。 */
const pendingUrlRequests = new Map<string, Promise<string>>()

/** 歌曲主键：各音源字段不统一，按 lx 的取法逐个试（与 model/luoxueSong 的 parseLxTrackId 同序）。 */
const readTrackKey = (info: LxMusicInfo): string => {
  const raw = info as unknown as Record<string, unknown>
  const meta = raw?.meta as Record<string, unknown> | undefined
  for (const value of [raw?.songmid, raw?.id, raw?.hash, raw?.copyrightId, meta?.songId]) {
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

const buildUrlCacheKey = (source: string, info: LxMusicInfo, quality: LxQuality): string =>
  `${readTrackKey(info)}|${source}|${quality}`

/**
 * 丢掉某首歌的播放地址缓存（播放出错、刷新地址前调用）。
 * 按歌曲主键整体丢弃：不区分音源与音质，任何一条旧地址都不该再被复用。
 */
export function invalidateMusicUrlCache(trackId: string): void {
  if (!trackId) return
  const prefix = `${trackId}|`
  for (const key of [...urlCache.keys()]) {
    if (key.startsWith(prefix)) urlCache.delete(key)
  }
  for (const key of [...pendingUrlRequests.keys()]) {
    if (key.startsWith(prefix)) pendingUrlRequests.delete(key)
  }
}

/** 获取歌曲播放地址（需先注入自定义音源运行时并把当前音源设为 user_api 音源） */
export function getMusicUrl(
  source: string,
  musicInfo: LxMusicInfo,
  quality: LxQuality
): Promise<string> {
  const cacheKey = buildUrlCacheKey(source, musicInfo, quality)
  const cached = urlCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < URL_CACHE_TTL_MS) return Promise.resolve(cached.url)

  const pending = pendingUrlRequests.get(cacheKey)
  if (pending) return pending

  const request = invoke(resolvePlaySource(source, musicInfo), 'getMusicUrl', musicInfo, quality)
    .then(normalizeUrl)
    .then((url) => {
      if (url) {
        urlCache.set(cacheKey, { url, fetchedAt: Date.now() })
        if (urlCache.size > URL_CACHE_MAX_ENTRIES) {
          const oldest = urlCache.keys().next().value
          if (oldest !== undefined) urlCache.delete(oldest)
        }
      }
      return url
    })
    .finally(() => {
      pendingUrlRequests.delete(cacheKey)
    })

  pendingUrlRequests.set(cacheKey, request)
  return request
}

/** 获取歌词（含翻译、罗马音、逐字歌词） */
export function getLyric(source: string, musicInfo: LxMusicInfo): Promise<LxLyricResult> {
  // 第二个参数是 lx 的 isGetLyricx：传 true 才会连逐字歌词（yrc/lxlyric）一起取回。
  return invoke(resolvePlaySource(source, musicInfo), 'getLyric', musicInfo, true).then((res) => ({
    lyric: res?.lyric ?? '',
    tlyric: res?.tlyric ?? '',
    rlyric: res?.rlyric ?? '',
    lxlyric: res?.lxlyric ?? '',
  }))
}

/** 歌曲信息里本来就带着的封面地址（各音源字段不统一）；平台自己的取图接口失败时兜底用它。 */
const readSongImg = (info: LxMusicInfo): string => {
  const raw = info as unknown as Record<string, unknown>
  const meta = raw.meta as Record<string, unknown> | undefined
  for (const value of [raw.img, raw.picUrl, meta?.picUrl, meta?.img]) {
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/** 获取歌曲封面 */
export function getPic(source: string, musicInfo: LxMusicInfo): Promise<string> {
  const fallback = readSongImg(musicInfo)
  return invoke(resolvePlaySource(source, musicInfo), 'getPic', musicInfo)
    .then(normalizeUrl)
    .then((url) => url || fallback)
    .catch(() => fallback)
}
