/**
 * 酷狗 KRC 歌词解码
 *
 * 由 ikun `@common/utils/lyricUtils/kg.js` 转写为 TypeScript：
 * 解压部分从 Node 的 `zlib.inflate` 换成纯 JS 的 fflate（渲染进程无 Node 集成）。
 */

// src/luoxue/sdk/lyricUtils/kg.ts

import { decompressSync } from 'fflate'
import { decodeName } from './util'

// https://github.com/ikunshare/ikun-music-desktop/issues/296#issuecomment-683285784
const enc_key = Buffer.from(
  [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]
)

/** base64 解码 → 前 4 字节丢弃 → 与固定 key 循环异或 → zlib 解压 */
const decodeLyric = async (str: string): Promise<string> => {
  if (!str.length) return ''
  const buf_str = Buffer.from(str, 'base64').subarray(4)
  for (let i = 0, len = buf_str.length; i < len; i++) {
    buf_str[i] = buf_str[i] ^ enc_key[i % 16]
  }
  return Buffer.from(decompressSync(buf_str)).toString()
}

const headExp = /^.*\[id:\$\w+\]\n/

/** 解析 KRC 文本，拆分出 lyric / tlyric / rlyric / lxlyric */
const parseLyric = (str: string) => {
  str = str.replace(/\r/g, '')
  if (headExp.test(str)) str = str.replace(headExp, '')
  const trans = str.match(/\[language:([\w=\\/+]+)\]/)
  let lyric: string
  let rlyric: any
  let tlyric: any
  if (trans) {
    str = str.replace(/\[language:[\w=\\/+]+\]\n/, '')
    const json = JSON.parse(Buffer.from(trans[1], 'base64').toString())
    for (const item of json.content) {
      switch (item.type) {
        case 0:
          rlyric = item.lyricContent
          break
        case 1:
          tlyric = item.lyricContent
          break
      }
    }
  }
  let i = 0
  let lxlyric = str.replace(/\[((\d+),\d+)\].*/g, (matched: string) => {
    const result = matched.match(/\[((\d+),\d+)\].*/) as RegExpMatchArray
    let time = parseInt(result[2])
    const ms = time % 1000
    time /= 1000
    const m = parseInt(String(time / 60))
      .toString()
      .padStart(2, '0')
    time %= 60
    const s = parseInt(String(time)).toString().padStart(2, '0')
    const timeStr = `${m}:${s}.${ms}`
    if (rlyric) rlyric[i] = `[${timeStr}]${rlyric[i]?.join('') ?? ''}`
    if (tlyric) tlyric[i] = `[${timeStr}]${tlyric[i]?.join('') ?? ''}`
    i++
    return matched.replace(result[1], timeStr)
  })
  rlyric = rlyric ? rlyric.join('\n') : ''
  tlyric = tlyric ? tlyric.join('\n') : ''
  lxlyric = lxlyric.replace(/<(\d+,\d+),\d+>/g, '<$1>')
  lxlyric = decodeName(lxlyric)
  lyric = lxlyric.replace(/<\d+,\d+>/g, '')
  rlyric = decodeName(rlyric)
  tlyric = decodeName(tlyric)
  return {
    lyric,
    tlyric,
    rlyric,
    lxlyric,
  }
}

/** 解码并解析 KRC 歌词 */
export const decodeKrc = async (
  data: string
): Promise<{ lyric: string; tlyric: string; rlyric: string; lxlyric: string }> => {
  return decodeLyric(data).then(parseLyric)
}
