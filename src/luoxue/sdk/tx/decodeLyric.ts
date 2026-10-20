/**
 * QQ 音乐 QRC 歌词解密
 *
 * 移植自 ikun `musicSdk/tx/decodeLyric.ts`。原实现使用 Node 的 zlib，
 * 这里换成纯 JS 的 fflate（folia 渲染进程没有 Node 集成），解压次序保持原样：
 * zlib → raw deflate → zip。
 */

// src/luoxue/sdk/tx/decodeLyric.ts

import { inflateSync, unzipSync, unzlibSync } from 'fflate'
import { qrcDecrypt } from './tripledes'

const QRC_KEY = new Uint8Array(Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'utf8'))

// https://github.com/imsyy/SPlayer/blob/159f2e4de772f477ca72af3fb99938238f81a32f/electron/server/qqmusic/qrc.ts
const decryptQrc = (encryptedQrc: string): string => {
  if (!encryptedQrc || encryptedQrc.trim() === '') {
    throw new Error('没有可解密的数据')
  }

  const encryptedBuffer = Buffer.from(encryptedQrc, 'hex')
  const encryptedData = new Uint8Array(encryptedBuffer)

  const decrypted = qrcDecrypt(encryptedData, QRC_KEY)
  const decryptedBuffer = Buffer.from(decrypted)

  try {
    return Buffer.from(unzlibSync(decryptedBuffer)).toString('utf8')
  } catch {}

  try {
    return Buffer.from(inflateSync(decryptedBuffer)).toString('utf8')
  } catch {}

  try {
    const files = unzipSync(decryptedBuffer)
    const first = Object.values(files)[0]
    if (first) return Buffer.from(first).toString('utf8')
  } catch {}

  const str = decryptedBuffer.toString('utf8')
  if (str.includes('[') || str.includes('<')) {
    return str
  }

  throw new Error('无法解压数据')
}

const decode = async (str: string): Promise<string> => {
  if (!str || !str.trim()) {
    return ''
  }

  try {
    return decryptQrc(str)
  } catch (err) {
    return ''
  }
}

/** 解密 QRC 歌词（主歌词、翻译、罗马音） */
export const handleDecode = async (
  lrc: string,
  tlrc: string,
  rlrc: string
): Promise<{ lyric: string; tlyric: string; rlyric: string }> => {
  const [lyric, tlyric, rlyric] = await Promise.all([decode(lrc), decode(tlrc), decode(rlrc)])

  return {
    lyric,
    tlyric,
    rlyric,
  }
}
