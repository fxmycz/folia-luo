// src/luoxue/sdk/types.ts

/**
 * 音源 SDK 对外类型定义
 *
 * 由 ikun-music-desktop 的 `LX` 全局命名空间类型（src/common/types/music.d.ts 等）裁剪而来，
 * 这里落成真实可 import 的 TypeScript 类型，避免依赖环境里的全局 `LX` 命名空间。
 */

/**
 * 音源标识
 *
 * 内置音源：kw / kg / tx / wy / mg / git；自定义音源脚本的 id 形如 `user_api_xxx`。
 * 使用 `(string & {})` 保留字符串字面量提示的同时允许任意自定义音源 id。
 */
export type LxSourceInfo = 'kw' | 'kg' | 'tx' | 'wy' | 'mg' | 'git' | (string & {})

/** 音质类型 */
export type LxQuality =
  | '128k'
  | '192k'
  | '320k'
  | 'flac'
  | 'flac24bit'
  | 'hires'
  | 'atmos'
  | 'ape'
  | 'wav'
  | 'dsd'

/** 单条音质信息（对应旧版 lx-music 的 `types` / `_types` 字段） */
export interface LxQualityType {
  type: LxQuality | string
  size?: string | null
  [key: string]: any
}

/**
 * 歌曲信息（旧版 lx-music 的扁平结构）
 *
 * 不同音源会在基础字段外补充自己的字段：kg 的 `hash`、mg 的 `copyrightId`/`mrcUrl`、
 * git 的 `_gitcodeData` 等，这里都用索引签名兜住。
 */
export interface LxMusicInfo {
  name: string
  singer: string
  source: LxSourceInfo
  /** 各音源的歌曲唯一 id：kw 为 rid，kg 为 hash 之外的 songid，wy/tx 为 songmid，mg 为 copyrightId */
  songmid: string
  albumId?: string | number
  albumName?: string
  /** 时长，形如 `03:45`；无法解析时为 `--/--` */
  interval?: string | null
  img?: string | null
  lrc?: string | null
  types?: LxQualityType[]
  _types?: Record<string, { size?: string; hash?: string }>
  typeUrl?: Record<string, string>
  /** kg 专有：文件 hash */
  hash?: string
  /** mg 专有：版权 id */
  copyrightId?: string
  /** tx 专有：media mid */
  strMediaMid?: string
  /** 部分音源（git）使用的数字/字符串主键 */
  id?: string | number
  otherSource?: any
  [key: string]: any
}

/** 排行榜分类（对应 provider 的 `leaderboard.getBoards()` 返回项） */
export interface LxBoard {
  id: string
  name: string
  img?: string
  source?: string
  [key: string]: any
}

/** 歌单标签分类 */
export interface LxSongListTag {
  id: string
  name: string
  source?: string
  parent_id?: string
  parent_name?: string
  /** 部分音源返回嵌套的标签分组 */
  list?: LxSongListTag[]
  [key: string]: any
}

/** 歌单信息（对应 provider 的 `songList.getList()` 返回项） */
export interface LxSongListInfo {
  id: string
  name: string
  img?: string
  author?: string
  total?: number | string
  play_count?: string | number
  desc?: string
  source?: string
  [key: string]: any
}

/** 自定义音源脚本的元信息 */
export interface LxSourceMeta {
  id: string
  name: string
  /** 脚本支持的能力：musicUrl / lyric / pic */
  actions?: string[]
  /** 脚本支持的音质 */
  qualitys?: LxQuality[]
}

/**
 * 自定义音源脚本运行时（user_api）
 *
 * 由外部的自定义音源运行时层通过 `setUserApiRuntime` 注入：
 * - `getApis(platformSource)` 返回某个平台音源的接口实现（含 getMusicUrl / getLyric / getPic）；
 * - `getSourceIds()` / `getSourceInfo()` 用于列出已加载的自定义音源脚本。
 */
export interface LxUserApiRuntime {
  getApis(source: string): any
  getSourceIds(): string[]
  getSourceInfo(): LxSourceMeta[]
}

/** 搜索结果 */
export interface LxSearchResult {
  list: LxMusicInfo[]
  total: number
  source: string
}

/** 歌单详情结果 */
export interface LxSongListDetailResult {
  list: LxMusicInfo[]
  total: number
  info: LxSongListInfo | null
  source: string
}

/** 歌词结果 */
export interface LxLyricResult {
  lyric: string
  tlyric: string
  rlyric: string
  lxlyric: string
}
