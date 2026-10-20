/**
 * SHA-1（纯 TypeScript 实现）
 *
 * 移植自 ikun `musicSdk/tx/utils/sign.ts` 中使用的 `crypto.createHash('sha1')`。
 * folia 的渲染进程关闭了 Node 集成（nodeIntegration: false），不能使用 node:crypto，
 * 而 WebCrypto 的 `crypto.subtle.digest` 只有异步接口，替换会破坏同步签名流程，
 * 因此这里实现一份等价的同步 SHA-1（FIPS 180-1）。
 */

// src/luoxue/sdk/sha1.ts

/** 32 位循环左移 */
const rol = (value: number, bits: number): number => ((value << bits) | (value >>> (32 - bits))) >>> 0

/**
 * 计算字符串的 SHA-1，返回小写十六进制字符串
 * @param input 待哈希文本（按 UTF-8 编码）
 */
export const sha1Hex = (input: string): string => {
  const bytes = new TextEncoder().encode(input)
  const totalLen = (((bytes.length + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(totalLen)
  padded.set(bytes)
  padded[bytes.length] = 0x80

  // 末尾 8 字节写入消息比特长度（音源签名场景不会超过 2^32 bit）
  const bitLen = bytes.length * 8
  padded[totalLen - 4] = (bitLen >>> 24) & 0xff
  padded[totalLen - 3] = (bitLen >>> 16) & 0xff
  padded[totalLen - 2] = (bitLen >>> 8) & 0xff
  padded[totalLen - 1] = bitLen & 0xff

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const words = new Int32Array(80)
  for (let block = 0; block < totalLen; block += 64) {
    for (let i = 0; i < 16; i++) {
      const offset = block + i * 4
      words[i] =
        ((padded[offset] << 24) |
          (padded[offset + 1] << 16) |
          (padded[offset + 2] << 8) |
          padded[offset + 3]) >>>
        0
    }
    for (let i = 16; i < 80; i++) {
      words[i] = rol(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (rol(a, 5) + f + e + k + words[i]) >>> 0
      e = d
      d = c
      c = rol(b, 30)
      b = a
      a = t
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return [h0, h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
}
