// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/util/crypto.js
import md5 from 'blueimp-md5'
import { aesDecrypt, aesEncrypt, randomBytes, rsaEncrypt, type AesMode } from '../../crypto'

// src/luoxue/sdk/wy/utils/crypto.ts

const iv = Buffer.from('0102030405060708')
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud')
const linuxapiKey = Buffer.from('rFgB&h#%2?^eDg:Q')
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const publicKey =
  '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const eapiKey = 'e82ckenh8dichen8'

// Node 的 createCipheriv / createDecipheriv 由 SDK 的纯 JS AES 实现替代
const aesEncryptBuffer = (
  buffer: Buffer,
  mode: AesMode,
  key: Uint8Array | string,
  iv: Uint8Array | string
): Buffer => Buffer.from(aesEncrypt(buffer, mode, key, iv))

const aesDecryptBuffer = (
  cipherBuffer: Buffer,
  mode: AesMode,
  key: Uint8Array | string,
  iv: Uint8Array | string
): Buffer => Buffer.from(aesDecrypt(cipherBuffer, mode, key, iv))

// Node 的 publicEncrypt + RSA_NO_PADDING 由 SDK 的纯 JS RSA 实现替代
const rsaEncryptBuffer = (buffer: Buffer, key: string): Buffer => Buffer.from(rsaEncrypt(buffer, key))

export const weapi = (object: any): { params: string; encSecKey: string } => {
  const text = JSON.stringify(object)
  const secretKey = randomBytes(16).map((n) => base62.charAt(n % 62).charCodeAt(0))
  return {
    params: aesEncryptBuffer(
      Buffer.from(
        aesEncryptBuffer(Buffer.from(text), 'aes-128-cbc', presetKey, iv).toString('base64')
      ),
      'aes-128-cbc',
      secretKey,
      iv
    ).toString('base64'),
    encSecKey: rsaEncryptBuffer(Buffer.from(secretKey.reverse()), publicKey).toString('hex'),
  }
}

export const linuxapi = (object: any): { eparams: string } => {
  const text = JSON.stringify(object)
  return {
    eparams: aesEncryptBuffer(Buffer.from(text), 'aes-128-ecb', linuxapiKey, '')
      .toString('hex')
      .toUpperCase(),
  }
}

export const eapi = (url: string, object: any): { params: string } => {
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const message = `nobody${url}use${text}md5forencrypt`
  // Node 的 createHash('md5') 由 blueimp-md5 替代
  const digest = md5(message)
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return {
    params: aesEncryptBuffer(Buffer.from(data), 'aes-128-ecb', eapiKey, '').toString('hex').toUpperCase(),
  }
}

export const eapiDecrypt = (cipherBuffer: Buffer): string => {
  return aesDecryptBuffer(cipherBuffer, 'aes-128-ecb', eapiKey, '').toString()
}
