import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = process.env
const bool = (v) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase())
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d)

export const config = {
  port: int(env.PORT, 3000),
  production: env.NODE_ENV === 'production',

  landingDir: env.LANDING_DIR || path.join(root, 'web', 'landing'),
  socialDir: env.SOCIAL_DIR || path.join(root, 'web', 'social'),
  socialHost: (env.SOCIAL_HOST || 'social.izzy.com.gt').toLowerCase(),
  siteUrl: (env.SITE_URL || 'https://www.izzy.com.gt').replace(/\/$/, ''),

  databaseUrl: env.DATABASE_URL || '',
  // Supabase exige SSL; en una base local ponlo en "false".
  dbSsl: env.DB_SSL !== 'false',

  // Campaña de pre registro
  limit: int(env.PREREG_LIMIT, 100),
  q25: int(env.PREREG_Q25, 50),

  // Cifrado/firma de los tokens del OTP (mínimo 32 caracteres)
  tokenSecret: env.TOKEN_SECRET || '',
  otpTtlMinutes: int(env.OTP_TTL_MINUTES, 10),
  otpMaxAttempts: int(env.OTP_MAX_ATTEMPTS, 5),
  otpResendSeconds: int(env.OTP_RESEND_SECONDS, 60),
  otpMaxResends: int(env.OTP_MAX_RESENDS, 3),

  // En modo simulado el SMS y el correo solo se escriben en la consola.
  smsDryRun: bool(env.SMS_DRY_RUN) || !env.LABSMOBILE_USER,
  labsmobile: {
    url: env.LABSMOBILE_URL || 'https://api.labsmobile.com/json/send',
    user: env.LABSMOBILE_USER || '',
    token: env.LABSMOBILE_TOKEN || '',
    sender: env.LABSMOBILE_SENDER || 'Izzy',
  },

  smtp: {
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
  },

  turnstile: { siteKey: env.TURNSTILE_SITE_KEY || '', secret: env.TURNSTILE_SECRET || '' },
  sheets: { url: env.SHEETS_WEBHOOK_URL || '', secret: env.SHEETS_WEBHOOK_SECRET || '' },
}

export function assertConfig() {
  const problems = []
  if (config.tokenSecret.length < 32) problems.push('TOKEN_SECRET debe tener al menos 32 caracteres.')
  if (!config.databaseUrl) problems.push('DATABASE_URL no está definida.')
  if (config.production && config.smsDryRun) problems.push('Aviso: SMS en modo simulado (faltan credenciales de labsMobile).')
  return problems
}

/** Cupón que le correspondería según su posición (se usa en el Sheets y en pantalla). */
export function tierFor(position) {
  if (!position || position < 1 || position > config.limit) return null
  return position <= config.q25 ? 'Q25' : 'Q15'
}
