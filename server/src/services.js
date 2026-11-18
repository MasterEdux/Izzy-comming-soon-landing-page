import nodemailer from 'nodemailer'
import { config } from './config.js'
import { toMsisdn } from './phone.js'

// ---------------------------------------------------------------------------
// SMS (labsMobile)
// ---------------------------------------------------------------------------
export async function sendSms(e164, text) {
  if (config.smsDryRun) {
    console.log(`[SMS simulado] ${e164}: ${text}`)
    return { dryRun: true }
  }
  const { url, user, token, sender } = config.labsmobile
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`,
    },
    // Sin remitente configurado se omite `tpoa` y labsMobile usa el de la cuenta.
    body: JSON.stringify({ message: text, ...(sender ? { tpoa: sender } : {}), recipient: [{ msisdn: toMsisdn(e164) }] }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || String(body.code) !== '0') {
    throw new Error(`labsMobile rechazó el envío (HTTP ${res.status}, code ${body.code ?? '?'}): ${body.message ?? ''}`)
  }
  return body
}

export const otpMessage = (code) =>
  `Izzy: tu codigo de verificacion es ${code}. Vence en ${config.otpTtlMinutes} min. No lo compartas con nadie.`

// ---------------------------------------------------------------------------
// Correo (SMTP)
// ---------------------------------------------------------------------------
let transport
function mailer() {
  if (!transport) {
    const { host, port, secure, user, pass } = config.smtp
    transport = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined })
  }
  return transport
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function welcomeEmail({ firstName }) {
  const terms = `${config.siteUrl}/terminos-preregistro`
  const name = esc(firstName)
  return {
    subject: '¡Gracias por inscribirte en Izzy!',
    text:
      `Hola ${firstName},\n\n` +
      `Gracias por inscribirte en el pre registro de Izzy.com.gt. Tu cuenta ya quedó creada y te avisaremos cuando lancemos la página.\n\n` +
      `Puedes consultar los términos y condiciones de la actividad aquí:\n${terms}\n\n` +
      `Equipo Izzy\n${config.siteUrl}`,
    html: `<!doctype html><html><body style="margin:0;background:#e6dcfa;font-family:Arial,Helvetica,sans-serif;color:#10182d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:#6d3bd1;padding:26px;text-align:center;color:#fff;font-size:28px;font-weight:800;letter-spacing:-1px">izzy</td></tr>
<tr><td style="padding:28px 26px;line-height:1.6;font-size:16px">
<h1 style="margin:0 0 12px;font-size:22px">¡Gracias por inscribirte, ${name}!</h1>
<p style="margin:0 0 14px">Tu cuenta en Izzy.com.gt ya quedó creada. Te avisaremos por correo en cuanto lancemos la página.</p>
<p style="margin:0 0 22px">Puedes consultar los términos y condiciones de la actividad aquí:</p>
<p style="margin:0 0 24px"><a href="${terms}" style="display:inline-block;background:#6d3bd1;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px">Ver términos y condiciones</a></p>
<p style="margin:0;color:#4f4a66;font-size:14px">Equipo Izzy · <a href="${config.siteUrl}" style="color:#4a2299">izzy.com.gt</a></p>
</td></tr></table></td></tr></table></body></html>`,
  }
}

export async function sendEmail(to, message) {
  if (!config.smtp.host || !config.smtp.from) {
    console.log(`[Correo simulado] a ${to}: ${message.subject}`)
    return { dryRun: true }
  }
  return mailer().sendMail({ from: config.smtp.from, to, ...message })
}

// ---------------------------------------------------------------------------
// Google Sheets (Apps Script)
// ---------------------------------------------------------------------------
export async function pushToSheet(row) {
  if (!config.sheets.url) {
    console.log('[Sheets simulado]', JSON.stringify(row))
    return { dryRun: true }
  }
  const res = await fetch(config.sheets.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: config.sheets.secret, ...row }),
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Sheets respondió HTTP ${res.status}`)
  return res.json().catch(() => ({}))
}

// ---------------------------------------------------------------------------
// Cloudflare Turnstile
// ---------------------------------------------------------------------------
export async function verifyTurnstile(token, ip) {
  if (!config.turnstile.secret) return true // sin llave configurada (desarrollo)
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstile.secret, response: token, remoteip: ip ?? '' }),
      signal: AbortSignal.timeout(8_000),
    })
    const body = await res.json()
    return body.success === true
  } catch {
    return false
  }
}
