/**
 * 音源调度层
 *
 * 对应 ikun 的 `musicSdk/api-source.ts`，但去掉了对 ikun store 的依赖：
 * - `currentSourceId`：当前音源 id（内置音源为 kw/kg/...，自定义音源脚本形如 `user_api_xxx`）；
 * - `builtinProviders`：内置音源 provider 注册表（提供搜索/榜单/歌单/歌词等元数据能力）；
 * - `builtinApi`：播放地址实现表，ikun 侧为空（`api-source-info.ts` 返回空数组），
 *   也就是说内置音源没有 getMusicUrl 实现，播放必须依赖自定义音源脚本；
 * - `userApiRuntime`：自定义音源运行时，由另一套脚本运行层通过 `setUserApiRuntime` 注入。
 */

// src/luoxue/sdk/api-source.ts

import kw from './kw/index'
import kg from './kg/index'
import tx from './tx/index'
import wy from './wy/index'
import mg from './mg/index'
import git from './git/index'
import type { LxSourceMeta, LxUserApiRuntime } from './types'

/** 内置音源 provider 注册表 */
export const builtinProviders: Record<string, any> = { kw, kg, tx, wy, mg, git }

/** 内置音源列表（对外的 id 与名称） */
export const BUILTIN_SOURCES: { id: string; name: string }[] = [
  { id: 'kw', name: '酷我音乐' },
  { id: 'kg', name: '酷狗音乐' },
  { id: 'tx', name: 'QQ音乐' },
  { id: 'wy', name: '网易云音乐' },
  { id: 'mg', name: '咪咕音乐' },
  { id: 'git', name: 'ChatMusic（git）' },
]

/**
 * 播放地址实现表
 *
 * 保持 ikun 的现状：为空。内置 provider 的 `getMusicUrl` 内部调用 `apis(source)`，
 * 因此播放能力只能由自定义音源脚本运行层提供。
 */
const builtinApi: Record<string, any> = {}

/** 自定义音源脚本运行时 */
let userApiRuntime: LxUserApiRuntime | null = null

/** 当前音源 id */
let currentSourceId = ''

/** 注入自定义音源运行时（传入 null 可清空） */
export const setUserApiRuntime = (runtime: LxUserApiRuntime | null): void => {
  userApiRuntime = runtime
}

/** 设置当前音源 */
export const setCurrentSource = (id: string): void => {
  currentSourceId = id ?? ''
}

/** 读取当前音源 */
export const getCurrentSource = (): string => currentSourceId

/** 当前是否使用自定义音源脚本 */
export const isUserApiSource = (): boolean => /^user_api/.test(currentSourceId)

/** 自定义音源脚本的元信息列表（未注入运行时时返回空数组） */
export const getUserSourceInfo = (): LxSourceMeta[] => userApiRuntime?.getSourceInfo?.() ?? []

/**
 * 获取指定音源的接口实现
 *
 * 自定义音源脚本是按平台提供播放能力的（脚本里为每个平台各给一份实现），所以只要运行时已注入，
 * 就优先取脚本对该平台的实现——不论当前音源是 `user_api_xxx` 还是内置平台 id。
 * （内置 provider 的 `getMusicUrl` 会调用 `apis(平台)`，走的正是这条路径。）
 * 取不到时再回退到内置实现表；仍然没有则抛错。
 */
export const apis = (source: string = currentSourceId): any => {
  if (userApiRuntime) {
    const api = userApiRuntime.getApis(source)
    if (api) return api
  }
  const api = builtinApi[source]
  if (api) return api
  throw new Error('Api is not found')
}
