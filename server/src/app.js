import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { config, tierFor } from './config.js'
import { normalizePhone, maskPhone } from './phone.js'
import { decryptToken, encryptToken, generateCode, hashCode, newId, safeEqual } from './otp.js'
import { hit, otpAttempts } from './ratelimit.js'
import { otpMessage, pushToSheet, sendEmail, sendSms, verifyTurnstile, welcomeEmail } from './services.js'

const HOUR = 3_600_000
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

const MESSAGES = {
  EMAIL_EXISTS: 'Ya existe una cuenta con este correo. Cuando lancemos, inicia sesión con ella.',
  ALREADY_PREREGISTERED: 'Este correo ya está pre registrado. ¡Gracias por tu entusiasmo!',
  PHONE_EXISTS: 'Este teléfono ya está pre registrado con otro correo.',
}

export const DEPARTMENTS = ['Alta Verapaz','Baja Verapaz','Chimaltenango','Chiquimula','El Progreso','Escuintla','Guatemala','Huehuetenango','Izabal','Jalapa','Jutiapa','Petén','Quetzaltenango','Quiché','Retalhuleu','Sacatepéquez','San Marcos','Santa Rosa','Sololá','Suchitepéquez','Totonicapán','Zacapa']
export const INTERESTS = ['glow','tecnologia','mini','mascotas','moda','hogar']
export const SOURCES = ['instagram','tiktok','facebook','whatsapp','amigo','otro']

const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, 'Ingresa tu nombre').max(60),
    lastName: z.string().trim().min(2, 'Ingresa tu apellido').max(60),
    email: z.string().trim().toLowerCase().email('Correo no válido').max(120),
    phone: z.string().trim().min(8, 'Ingresa tu teléfono').max(20),
    password: z.string().min(8, 'Usa al menos 8 caracteres').max(72, 'La contraseña es demasiado larga'),
    confirm: z.string(),
    acceptsTerms: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos y condiciones' }) }),
    acceptsMarketing: z.boolean().optional().default(false),
    department: z.enum(DEPARTMENTS).optional().or(z.literal('').transform(() => undefined)),
    interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional().default([]),
    source: z.enum(SOURCES).optional().or(z.literal('').transform(() => undefined)),
    turnstileToken: z.string().optional(),
    website: z.string().optional(), // campo trampa para bots
  })
  .refine((d) => d.password === d.confirm, { message: 'Las contraseñas no coinciden', path: ['confirm'] })

const COOKIE = 'izzy_pr'
const YEAR = 365 * 24 * 3600

function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

function registeredCookie(info) {
  const value = encryptToken({ k: 'reg', exp: Date.now() + YEAR * 1000, ...info })
  return `${COOKIE}=${value}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${config.production ? '; Secure' : ''}`
}

const fail = (reply, status, message, extra = {}) => reply.code(status).send({ ok: false, message, ...extra })

export function buildApp({ db, logger = false } = {}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 20_000 })

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
  })

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------
  app.get('/healthz', async () => ({ ok: true }))

  app.get('/api/config', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { turnstileSiteKey: config.turnstile.siteKey, limit: config.limit, q25: config.q25 }
  })

  // ¿Este dispositivo ya se registró? (cookie firmada y cifrada: no se puede falsificar)
  app.get('/api/preregistro/yo', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const data = decryptToken(readCookie(req, COOKIE))
    if (!data || data.k !== 'reg' || Date.now() > data.exp) return { ok: true, registered: false }
    return { ok: true, registered: true, name: data.name, position: data.position, tier: data.tier }
  })

  let cached = { at: 0, value: null }
  app.get('/api/preregistro/estado', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!cached.value || Date.now() - cached.at > 3000) {
      cached = { at: Date.now(), value: await db.status() }
    }
    return { ok: true, ...cached.value }
  })

  async function issueCode({ data, phone, sends = 0 }) {
    const code = generateCode()
    const id = newId()
    const exp = Date.now() + config.otpTtlMinutes * 60_000
    const token = encryptToken({ id, phone, ch: hashCode(code, id), exp, sends: sends + 1, last: Date.now(), data })
    await sendSms(phone, otpMessage(code))
    return token
  }

  app.post('/api/preregistro/enviar-codigo', async (req, reply) => {
    const ip = req.ip
    if (!hit(`send:ip:${ip}`, 8, HOUR).ok) return fail(reply, 429, 'Demasiados intentos. Inténtalo más tarde.')

    const parsed = registerSchema.safeParse(req.body ?? {})
    if (!parsed.success) return fail(reply, 400, parsed.error.issues[0]?.message ?? 'Revisa los datos.')
    const d = parsed.data

    if (d.website) return { ok: true, token: 'x', phoneMasked: '••••', resendIn: config.otpResendSeconds } // bot

    const phone = normalizePhone(d.phone)
    if (!phone) return fail(reply, 400, 'Ingresa un teléfono válido (8 dígitos de Guatemala o con código de país).')
    if (!(await verifyTurnstile(d.turnstileToken, ip))) return fail(reply, 400, 'No pudimos verificar que eres una persona. Recarga e inténtalo de nuevo.')
    if (!hit(`send:phone:${phone}`, 5, HOUR).ok) return fail(reply, 429, 'Ya enviamos varios códigos a este teléfono. Inténtalo en una hora.')

    const available = await db.checkAvailability({ email: d.email, phone })
    if (!available.ok) return fail(reply, 409, MESSAGES[available.code], { code: available.code })

    const passwordHash = await bcrypt.hash(d.password, 10)
    const data = {
      firstName: d.firstName, lastName: d.lastName, email: d.email, passwordHash, acceptsMarketing: d.acceptsMarketing,
      department: d.department ?? null, interests: [...new Set(d.interests)], source: d.source ?? null,
    }
    try {
      const token = await issueCode({ data, phone })
      return { ok: true, token, phoneMasked: maskPhone(phone), resendIn: config.otpResendSeconds, expiresIn: config.otpTtlMinutes * 60 }
    } catch (error) {
      req.log.error(error)
      console.error('[SMS] error:', error.message)
      return fail(reply, 502, 'No pudimos enviar el SMS. Revisa tu número e inténtalo de nuevo.')
    }
  })

  app.post('/api/preregistro/reenviar', async (req, reply) => {
    if (!hit(`resend:ip:${req.ip}`, 10, HOUR).ok) return fail(reply, 429, 'Demasiados intentos. Inténtalo más tarde.')
    const payload = decryptToken(req.body?.token)
    if (!payload || otpAttempts.isUsed(payload.id)) return fail(reply, 400, 'La sesión expiró. Vuelve a llenar el formulario.', { restart: true })
    if (payload.sends >= config.otpMaxResends + 1) return fail(reply, 429, 'Ya reenviamos el código varias veces. Vuelve a empezar.', { restart: true })
    const wait = config.otpResendSeconds * 1000 - (Date.now() - payload.last)
    if (wait > 0) return fail(reply, 429, `Espera ${Math.ceil(wait / 1000)} segundos para reenviar.`)
    if (!hit(`send:phone:${payload.phone}`, 5, HOUR).ok) return fail(reply, 429, 'Ya enviamos varios códigos a este teléfono. Inténtalo en una hora.')
    otpAttempts.markUsed(payload.id)
    try {
      const token = await issueCode({ data: payload.data, phone: payload.phone, sends: payload.sends })
      return { ok: true, token, phoneMasked: maskPhone(payload.phone), resendIn: config.otpResendSeconds, expiresIn: config.otpTtlMinutes * 60 }
    } catch (error) {
      console.error('[SMS] error:', error.message)
      return fail(reply, 502, 'No pudimos enviar el SMS. Inténtalo de nuevo.')
    }
  })

  app.post('/api/preregistro/verificar', async (req, reply) => {
    if (!hit(`verify:ip:${req.ip}`, 20, 600_000).ok) return fail(reply, 429, 'Demasiados intentos. Espera unos minutos.')
    const code = String(req.body?.code ?? '').replace(/\D/g, '')
    const payload = decryptToken(req.body?.token)
    if (!payload || otpAttempts.isUsed(payload.id)) return fail(reply, 400, 'La sesión expiró. Vuelve a llenar el formulario.', { restart: true })
    if (Date.now() > payload.exp) return fail(reply, 400, 'El código venció. Pide uno nuevo.', { expired: true })
    if (code.length !== 6) return fail(reply, 400, 'Escribe los 6 dígitos del código.')
    if (otpAttempts.get(payload.id) >= config.otpMaxAttempts) {
      return fail(reply, 429, 'Demasiados intentos con este código. Pide uno nuevo.', { expired: true })
    }
    if (!safeEqual(hashCode(code, payload.id), payload.ch)) {
      const used = otpAttempts.add(payload.id)
      const left = Math.max(0, config.otpMaxAttempts - used)
      return fail(reply, 400, left > 0 ? `Código incorrecto. Te quedan ${left} intentos.` : 'Demasiados intentos con este código. Pide uno nuevo.', { attemptsLeft: left })
    }

    const result = await db.registerCustomer({ ...payload.data, phone: payload.phone })
    if (!result.ok) return fail(reply, 409, MESSAGES[result.code], { code: result.code, restart: true })
    otpAttempts.markUsed(payload.id)
    cached = { at: 0, value: null }

    // Correo y hoja de cálculo: no bloquean ni tumban el registro.
    const { firstName, lastName, email } = payload.data
    const tier = result.tier
    sendEmail(email, welcomeEmail({ firstName })).catch((e) => console.error('[Correo] error:', e.message))
    pushToSheet({
      fecha: new Date().toISOString(),
      posicion: result.position,
      cupon: tier ?? 'Sin cupón',
      nombre: firstName,
      apellido: lastName,
      telefono: payload.phone,
      correo: email,
      aceptaCorreos: payload.data.acceptsMarketing ? 'Sí' : 'No',
      departamento: payload.data.department ?? '',
      intereses: (payload.data.interests ?? []).join(', '),
      origen: payload.data.source ?? '',
    }).catch((e) => console.error('[Sheets] error:', e.message))

    reply.header('Set-Cookie', registeredCookie({ name: firstName, position: result.position, tier }))
    return { ok: true, position: result.position, tier, soldOut: tierFor(result.position) === null }
  })

  // -------------------------------------------------------------------------
  // Archivos estáticos (landing y social según el dominio)
  // -------------------------------------------------------------------------
  function resolveFile(root, urlPath) {
    let rel
    try { rel = decodeURIComponent(urlPath) } catch { return null }
    if (rel.includes('\0')) return null
    const base = path.resolve(root)
    const target = path.resolve(base, '.' + path.posix.normalize('/' + rel))
    if (target !== base && !target.startsWith(base + path.sep)) return null
    const candidates = rel.endsWith('/') || rel === '' ? [path.join(target, 'index.html')] : [target, target + '.html', path.join(target, 'index.html')]
    for (const file of candidates) {
      try { if (fs.statSync(file).isFile()) return file } catch { /* siguiente */ }
    }
    return null
  }

  const serveStatic = (req, reply) => {
    const urlPath = req.url.split('?')[0]
    const isSocial = req.hostname === config.socialHost
    let file = resolveFile(isSocial ? config.socialDir : config.landingDir, urlPath)
    if (!file && isSocial && /^\/favicon\.(svg|png|ico)$/.test(urlPath)) file = resolveFile(config.landingDir, urlPath)
    if (!file) {
      const notFound = resolveFile(config.landingDir, '/404.html')
      return reply.code(404).type('text/html; charset=utf-8').send(notFound ? fs.createReadStream(notFound) : 'No encontrado')
    }
    const ext = path.extname(file).toLowerCase()
    const stat = fs.statSync(file)
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
    // HTML, CSS y JS se revalidan siempre (así tus cambios llegan al instante); las imágenes se guardan un día.
    const revalidate = ['.html', '.css', '.js'].includes(ext)
    reply.header('Cache-Control', revalidate ? 'no-cache' : 'public, max-age=86400')
    reply.header('ETag', etag)
    if (req.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply.type(MIME[ext] ?? 'application/octet-stream').send(fs.createReadStream(file))
  }
  app.get('/*', serveStatic)
  app.get('/', serveStatic)

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ ok: false, message: 'No encontrado' }))
  app.setErrorHandler((error, req, reply) => {
    req.log.error(error)
    console.error('[Error]', error.message)
    reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({ ok: false, message: 'Ocurrió un error. Inténtalo de nuevo.' })
  })

  return app
}
