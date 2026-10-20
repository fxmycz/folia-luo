/**
 * 音源内部通用工具（MD5、DNS 辅助、歌手名格式化）
 *
 * 与原版相比只替换了两处环境相关实现：
 * - toMD5：Node 的 `crypto.createHash('md5')` → blueimp-md5（folia 既有依赖）；
 * - dnsLookup：Node 的 `dns.lookup` 在渲染进程不可用，且请求层已改为 fetch（不支持指定 lookup），
 *   故保留同名 API 结构，仅作兼容占位。
 */

// src/luoxue/sdk/utils.ts

import md5 from 'blueimp-md5'
import { decodeName } from './helpers'

export const toMD5 = (str: string): string => md5(str)

interface IpResult {
  address: string
  family: number
}

/** 域名 → IP 的缓存（渲染进程无 DNS 能力，始终为空） */
const ipMap = new Map<string, IpResult | true>()

export const getHostIp = (hostname: string): IpResult | undefined => {
  const result = ipMap.get(hostname)
  if (typeof result === 'object') return result
  return undefined
}

/**
 * needle 的 `lookup` 选项占位实现
 *
 * 音源把该函数作为请求的 `lookup` 传入；当前请求层基于 fetch，不消费该选项，
 * 因此这里保留签名即可，不会真正触发。若被直接调用则回调一个错误。
 */
export const dnsLookup = (
  hostname: string,
  _options: any,
  callback: (err: Error | null, address: string, family: number) => void
): void => {
  const result = getHostIp(hostname)
  if (result) return callback(null, result.address, result.family)
  callback(new Error('dnsLookup is not supported in the browser environment'), '', 0)
}

/**
 * 格式化歌手
 * @param singers 歌手数组
 * @param nameKey 歌手名键值
 * @param join 歌手分割字符
 */
export const formatSingerName = (singers: any, nameKey: string = 'name', join: string = '、'): string => {
  if (Array.isArray(singers)) {
    const singer: string[] = []
    singers.forEach((item: any) => {
      let name = item[nameKey]
      if (!name) return
      singer.push(name)
    })
    return decodeName(singer.join(join))
  }
  return decodeName(String(singers ?? ''))
}
