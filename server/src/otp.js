import crypto from 'node:crypto'
import { config } from './config.js'

/**
 * OTP sin tablas: los datos pendientes y el hash del código viajan en un token
 * cifrado y autenticado (AES-256-GCM). El navegador no puede leerlo ni alterarlo.
 */
const key = () => crypto.createHash('sha256').update(config.tokenSecret).digest()

export function encryptToken(payload) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
}

export function decryptToken(token) {
  try {
    const raw = Buffer.from(String(token), 'base64url')
    if (raw.length < 29) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const out = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
    return JSON.parse(out.toString('utf8'))
  } catch {
    return null
  }
}

export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

/** HMAC del código ligado al id del token, para que no sirva en otro intento. */
export function hashCode(code, id) {
  return crypto.createHmac('sha256', config.tokenSecret).update(`${id}:${code}`).digest('hex')
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export function newId() {
  return crypto.randomBytes(12).toString('hex')
}
