/**
 * 浏览器可用的对称/非对称加密实现
 *
 * 音源移植自 ikun，而 ikun 的渲染进程可直接使用 Node 的 `crypto` 模块；
 * folia 的渲染进程关闭了 Node 集成（nodeIntegration: false），因此这里用纯 TS
 * 提供音源实际用到的能力：
 * - AES-128-ECB / AES-128-CBC（PKCS#7 填充，对应 createCipheriv / createDecipheriv）
 * - RSA 公钥「无填充」加密（对应 publicEncrypt({ padding: RSA_NO_PADDING })）
 * - randomBytes（对应 crypto.randomBytes）
 *
 * 之所以自实现而不用 WebCrypto：WebCrypto 不支持 ECB 模式，且只有异步接口，
 * 而音源的签名/参数构造是同步流程。实现已用 Node `crypto` 做随机向量对拍验证。
 */

// src/luoxue/sdk/crypto.ts

/** 有限域 GF(2^8) 乘法（模多项式 x^8+x^4+x^3+x+1） */
const gfMul = (a: number, b: number): number => {
  let p = 0
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a
    const hi = a & 0x80
    a = (a << 1) & 0xff
    if (hi) a ^= 0x1b
    b >>= 1
  }
  return p & 0xff
}

/** 运行时生成 AES 的 S 盒（GF 求逆 + 仿射变换） */
const buildSbox = (): Uint8Array => {
  const sbox = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let inv = 0
    if (i !== 0) {
      for (let j = 1; j < 256; j++) {
        if (gfMul(i, j) === 1) {
          inv = j
          break
        }
      }
    }
    let x = inv
    let s = inv ^ 0x63
    for (let k = 0; k < 4; k++) {
      x = ((x << 1) | (x >>> 7)) & 0xff
      s ^= x
    }
    sbox[i] = s & 0xff
  }
  return sbox
}

const sbox = buildSbox()
const invSbox = new Uint8Array(256)
for (let i = 0; i < 256; i++) invSbox[sbox[i]] = i

/** AES-128 密钥扩展，输出 11 组轮密钥（176 字节） */
const expandKey = (key: Uint8Array): Uint8Array => {
  const w = new Uint8Array(176)
  w.set(key.subarray(0, 16))
  const temp = new Uint8Array(4)
  let generated = 16
  let rcon = 1
  while (generated < 176) {
    temp.set(w.subarray(generated - 4, generated))
    if (generated % 16 === 0) {
      const t = temp[0]
      temp[0] = temp[1]
      temp[1] = temp[2]
      temp[2] = temp[3]
      temp[3] = t
      for (let i = 0; i < 4; i++) temp[i] = sbox[temp[i]]
      temp[0] ^= rcon
      rcon = gfMul(rcon, 2)
    }
    for (let i = 0; i < 4; i++) w[generated + i] = w[generated - 16 + i] ^ temp[i]
    generated += 4
  }
  return w
}

const addRoundKey = (state: Uint8Array, roundKeys: Uint8Array, offset: number): void => {
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[offset + i]
}

const subBytes = (state: Uint8Array, box: Uint8Array): void => {
  for (let i = 0; i < 16; i++) state[i] = box[state[i]]
}

/** 行移位（state 按列优先存放：state[r + 4c]） */
const shiftRows = (state: Uint8Array, inverse: boolean): void => {
  for (let r = 1; r < 4; r++) {
    const row = [state[r], state[r + 4], state[r + 8], state[r + 12]]
    for (let c = 0; c < 4; c++) {
      state[r + 4 * c] = inverse ? row[(c - r + 4) % 4] : row[(c + r) % 4]
    }
  }
}

/** 列混合 */
const mixColumns = (state: Uint8Array, inverse: boolean): void => {
  for (let c = 0; c < 4; c++) {
    const o = 4 * c
    const a = [state[o], state[o + 1], state[o + 2], state[o + 3]]
    if (inverse) {
      state[o] = gfMul(a[0], 14) ^ gfMul(a[1], 11) ^ gfMul(a[2], 13) ^ gfMul(a[3], 9)
      state[o + 1] = gfMul(a[0], 9) ^ gfMul(a[1], 14) ^ gfMul(a[2], 11) ^ gfMul(a[3], 13)
      state[o + 2] = gfMul(a[0], 13) ^ gfMul(a[1], 9) ^ gfMul(a[2], 14) ^ gfMul(a[3], 11)
      state[o + 3] = gfMul(a[0], 11) ^ gfMul(a[1], 13) ^ gfMul(a[2], 9) ^ gfMul(a[3], 14)
    } else {
      state[o] = gfMul(a[0], 2) ^ gfMul(a[1], 3) ^ a[2] ^ a[3]
      state[o + 1] = a[0] ^ gfMul(a[1], 2) ^ gfMul(a[2], 3) ^ a[3]
      state[o + 2] = a[0] ^ a[1] ^ gfMul(a[2], 2) ^ gfMul(a[3], 3)
      state[o + 3] = gfMul(a[0], 3) ^ a[1] ^ a[2] ^ gfMul(a[3], 2)
    }
  }
}

const encryptBlock = (block: Uint8Array, roundKeys: Uint8Array): Uint8Array => {
  const state = Uint8Array.from(block)
  addRoundKey(state, roundKeys, 0)
  for (let round = 1; round < 10; round++) {
    subBytes(state, sbox)
    shiftRows(state, false)
    mixColumns(state, false)
    addRoundKey(state, roundKeys, round * 16)
  }
  subBytes(state, sbox)
  shiftRows(state, false)
  addRoundKey(state, roundKeys, 160)
  return state
}

const decryptBlock = (block: Uint8Array, roundKeys: Uint8Array): Uint8Array => {
  const state = Uint8Array.from(block)
  addRoundKey(state, roundKeys, 160)
  for (let round = 9; round >= 1; round--) {
    shiftRows(state, true)
    subBytes(state, invSbox)
    addRoundKey(state, roundKeys, round * 16)
    mixColumns(state, true)
  }
  shiftRows(state, true)
  subBytes(state, invSbox)
  addRoundKey(state, roundKeys, 0)
  return state
}

/** 统一成字节数组（字符串按 UTF-8 处理，与 Node 的 iv/key 传字符串行为一致） */
const toBytes = (value: Uint8Array | string): Uint8Array =>
  typeof value === 'string' ? new Uint8Array(Buffer.from(value, 'utf8')) : value

/** PKCS#7 填充 */
const pkcs7Pad = (data: Uint8Array): Uint8Array => {
  const padLen = 16 - (data.length % 16)
  const out = new Uint8Array(data.length + padLen)
  out.set(data)
  out.fill(padLen, data.length)
  return out
}

/** 去除 PKCS#7 填充（填充非法时抛错，等同于 Node 的 decipher.final()） */
const pkcs7Unpad = (data: Uint8Array): Uint8Array => {
  const padLen = data[data.length - 1]
  if (padLen < 1 || padLen > 16 || padLen > data.length) throw new Error('bad decrypt')
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error('bad decrypt')
  }
  return data.subarray(0, data.length - padLen)
}

export type AesMode = 'aes-128-ecb' | 'aes-128-cbc'

/**
 * AES 加密（对应 Node 的 createCipheriv）
 * @param data 明文
 * @param mode 模式：aes-128-ecb / aes-128-cbc
 * @param key 16 字节密钥
 * @param iv 初始向量（ECB 模式忽略）
 */
export const aesEncrypt = (
  data: Uint8Array,
  mode: AesMode,
  key: Uint8Array | string,
  iv: Uint8Array | string = ''
): Uint8Array => {
  const keyBytes = toBytes(key)
  const ivBytes = toBytes(iv)
  const roundKeys = expandKey(keyBytes)
  const padded = pkcs7Pad(data)
  const out = new Uint8Array(padded.length)
  let prev: Uint8Array = ivBytes
  for (let offset = 0; offset < padded.length; offset += 16) {
    const block = Uint8Array.from(padded.subarray(offset, offset + 16))
    if (mode === 'aes-128-cbc') {
      for (let i = 0; i < 16; i++) block[i] ^= prev[i] ?? 0
    }
    const encrypted = encryptBlock(block, roundKeys)
    out.set(encrypted, offset)
    prev = encrypted
  }
  return out
}

/**
 * AES 解密（对应 Node 的 createDecipheriv，自动去除 PKCS#7 填充）
 * @param data 密文
 * @param mode 模式：aes-128-ecb / aes-128-cbc
 * @param key 16 字节密钥
 * @param iv 初始向量（ECB 模式忽略）
 */
export const aesDecrypt = (
  data: Uint8Array,
  mode: AesMode,
  key: Uint8Array | string,
  iv: Uint8Array | string = ''
): Uint8Array => {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('bad decrypt')
  const keyBytes = toBytes(key)
  const ivBytes = toBytes(iv)
  const roundKeys = expandKey(keyBytes)
  const out = new Uint8Array(data.length)
  let prev: Uint8Array = ivBytes
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.subarray(offset, offset + 16)
    const decrypted = decryptBlock(block, roundKeys)
    if (mode === 'aes-128-cbc') {
      for (let i = 0; i < 16; i++) decrypted[i] ^= prev[i] ?? 0
    }
    out.set(decrypted, offset)
    prev = Uint8Array.from(block)
  }
  return pkcs7Unpad(out)
}

/** 随机字节（对应 Node 的 crypto.randomBytes） */
export const randomBytes = (size: number): Uint8Array =>
  new Uint8Array(globalThis.crypto.getRandomValues(new Uint8Array(size)))

/** 读取 DER 长度字段 */
const readDerLength = (data: Uint8Array, offset: number): { length: number; offset: number } => {
  let length = data[offset++]
  if (length & 0x80) {
    const count = length & 0x7f
    length = 0
    for (let i = 0; i < count; i++) length = (length << 8) | data[offset++]
  }
  return { length, offset }
}

/** 读取 DER 元素：返回 tag / 内容起点 / 内容长度 / 结束位置 */
const readDerElement = (data: Uint8Array, offset: number) => {
  const tag = data[offset++]
  const len = readDerLength(data, offset)
  return { tag, start: len.offset, end: len.offset + len.length }
}

/** 从字节数组读出大整数（二进制大端） */
const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return BigInt(`0x${hex || '0'}`)
}

/** 大整数转固定长度的二进制大端字节数组 */
const bigIntToBytes = (value: bigint, length: number): Uint8Array => {
  const out = new Uint8Array(length)
  let hex = value.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const bytes = Buffer.from(hex, 'hex')
  out.set(bytes.subarray(Math.max(0, bytes.length - length)), Math.max(0, length - bytes.length))
  return out
}

/** 模幂运算 */
const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  let result = 1n
  let b = base % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    b = (b * b) % modulus
    e >>= 1n
  }
  return result
}

/** 解析 PEM 公钥，取出模数 n 与指数 e（支持 SubjectPublicKeyInfo 与裸 RSAPublicKey） */
const parsePublicKey = (pem: string): { n: bigint; e: bigint } => {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = new Uint8Array(Buffer.from(base64, 'base64'))

  let root = readDerElement(der, 0)
  // 跳过外层的 SubjectPublicKeyInfo，找到内部的 RSAPublicKey SEQUENCE
  if (root.tag === 0x30) {
    let cursor = root.start
    let inner: { tag: number; start: number; end: number } | null = null
    while (cursor < root.end) {
      const el = readDerElement(der, cursor)
      if (el.tag === 0x03) {
        // BIT STRING：首字节为补位位数，跳过
        inner = readDerElement(der, el.start + 1)
        break
      }
      cursor = el.end
    }
    if (inner) root = inner
  }

  const modulusEl = readDerElement(der, root.start)
  const exponentEl = readDerElement(der, modulusEl.end)
  return {
    n: bytesToBigInt(der.subarray(modulusEl.start, modulusEl.end)),
    e: bytesToBigInt(der.subarray(exponentEl.start, exponentEl.end)),
  }
}

/**
 * RSA 公钥「无填充」加密（对应 Node 的 publicEncrypt + RSA_NO_PADDING）
 *
 * 调用方需自行把明文左补零到密钥长度（音源里就是这么做的），返回等长密文。
 */
export const rsaEncrypt = (buffer: Uint8Array, publicKeyPem: string): Uint8Array => {
  const { n, e } = parsePublicKey(publicKeyPem)
  const size = Math.ceil(n.toString(16).length / 2)
  const message = bytesToBigInt(buffer)
  return bigIntToBytes(modPow(message, e, n), size)
}
