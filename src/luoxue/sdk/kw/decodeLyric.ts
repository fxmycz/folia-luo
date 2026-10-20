/**
 * 酷我歌词解码
 *
 * 移植自 ikun `musicSdk/kw/decodeLyric.ts`。原实现依赖 Node 的 `zlib.inflate` 与
 * `iconv-lite`（gb18030），而 folia 的渲染进程没有 Node 集成（nodeIntegration: false），
 * 因此解压换成纯 JS 的 fflate，转码换成 Chromium 内置的 TextDecoder('gb18030')。
 */

// src/luoxue/sdk/kw/decodeLyric.ts

import { decompressSync } from 'fflate'

const gb18030Decoder = new TextDecoder('gb18030')

/** gb18030 字节转字符串 */
const decodeGb18030 = (data: Uint8Array): string => gb18030Decoder.decode(data)

const buf_key = Buffer.from('yeelion')
const buf_key_len = buf_key.length

/**
 * 解码酷我歌词：前 10 字节为 `tp=content` 时，跳过头部后解压（请求带 `lrcx=1` 时还要用 yeelion 异或）。
 * 两个分支返回的都是**明文歌词**：不带 lrcx 时服务端给的是 gb18030 歌词字节，带 lrcx 时是
 * 「gb18030 歌词字节 base64 后按 yeelion 异或」再压进响应体。
 */
export const decodeLyric = async (buf: Buffer, isGetLyricx: boolean): Promise<string> => {
  if (buf.toString('utf8', 0, 10) != 'tp=content') return ''
  const lrcData = Buffer.from(decompressSync(buf.subarray(buf.indexOf('\r\n\r\n') + 4)))

  if (!isGetLyricx) return decodeGb18030(lrcData)

  const buf_str = Buffer.from(lrcData.toString(), 'base64')
  const buf_str_len = buf_str.length
  const output = new Uint8Array(buf_str_len)
  let i = 0
  while (i < buf_str_len) {
    let j = 0
    while (j < buf_key_len && i < buf_str_len) {
      output[i] = buf_str[i] ^ buf_key[j]
      i++
      j++
    }
  }

  return decodeGb18030(Buffer.from(output))
}
