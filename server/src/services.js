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

export function welcomeEmail({ firstName, tier = null, position = null }) {
  const site = config.siteUrl
  const terms = `${site}/terminos-preregistro`
  const img = (name) => `${site}/email/${name}`
  const name = esc(firstName)
  const amount = tier ? tier.replace('Q', '') : null

  const links = {
    instagram: 'https://www.instagram.com/izzy___com/',
    tiktok: 'https://www.tiktok.com/@izzy.com.gt',
    facebook: 'https://www.facebook.com/profile.php?id=61590540479698',
    whatsapp: 'https://api.whatsapp.com/send/?phone=50246353422',
    web: 'https://www.izzy.com.gt',
  }
  const step = (icon, title, text) => `
<tr><td style="padding:0 0 16px">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td width="60" valign="top"><img src="${img(`icon-${icon}.png`)}" width="48" height="48" alt="" style="display:block;border-radius:13px"></td>
    <td valign="middle" style="font-family:Arial,Helvetica,sans-serif">
      <div style="font-size:16px;font-weight:800;color:#10182d;line-height:1.3">${title}</div>
      <div style="font-size:14px;color:#4f4a66;line-height:1.5;padding-top:2px">${text}</div>
    </td>
  </tr></table>
</td></tr>`
  const social = (icon, label) => `<td style="padding:0 5px"><a href="${links[icon]}" target="_blank"><img src="${img(`icon-${icon}.png`)}" width="44" height="44" alt="${label}" style="display:block;border-radius:12px"></a></td>`

  const ticket = tier
    ? `
<tr><td style="padding:6px 0 22px">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#5125ae;background-image:linear-gradient(135deg,#7c4bdc,#4a2299);border:2.5px solid #10182d;border-radius:20px">
    <tr>
      <td width="84" align="center" style="padding:18px 0 18px 18px"><img src="${img('icon-gift.png')}" width="64" height="64" alt="" style="display:block;border-radius:18px;border:2.5px solid #10182d"></td>
      <td style="padding:18px;font-family:Arial,Helvetica,sans-serif;color:#ffffff">
        <div style="font-size:11px;font-weight:800;letter-spacing:.14em;color:#e9defe">TU CUPÓN DE BIENVENIDA</div>
        <div style="font-size:38px;font-weight:900;letter-spacing:-1px;color:#fbbf24;line-height:1.1">Q ${amount}</div>
        <div style="font-size:13px;color:#e9defe">Para tu primera compra · Registro #${position}</div>
        <div style="font-size:13px;font-weight:800;color:#ffffff;padding-top:6px">Te lo enviaremos el día del lanzamiento.</div>
      </td>
    </tr>
  </table>
</td></tr>`
    : ''

  const couponStep = tier
    ? step('gift', 'Tu cupón de bienvenida', `Te enviaremos tu cupón de <b>Q ${amount}</b> el día del lanzamiento, para tu primera compra.`)
    : step('gift', 'Lanzamiento cerca', 'Los cupones de lanzamiento ya se agotaron, pero tu acceso quedó listo para cuando abramos.')

  const text =
    `¡Gracias por inscribirte, ${firstName}!\n\n` +
    `Tu cuenta en Izzy.com.gt ya quedó creada y tu celular está verificado. Estás dentro del Club Izzy.\n` +
    (tier ? `Tu cupón de bienvenida: Q ${amount} para tu primera compra (registro #${position}). Te lo enviaremos el día del lanzamiento.\n` : '') +
    `\nTe avisaremos por correo en cuanto la tienda esté en línea.\n\n` +
    `Términos y condiciones de la actividad:\n${terms}\n\n` +
    `Síguenos: ${links.instagram}\n\nEquipo Izzy · ${site}`

  return {
    subject: '¡Gracias por inscribirte en Izzy!',
    text,
    html: `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Gracias por inscribirte en Izzy</title></head>
<body style="margin:0;padding:0;background:#d3c3f4;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#d3c3f4">Tu cuenta ya quedó creada. Te avisaremos en cuanto abramos la tienda.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#d3c3f4"><tr><td align="center" style="padding:26px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td style="background:#ffffff;border:2.5px solid #10182d;border-radius:26px;overflow:hidden;box-shadow:6px 6px 0 #10182d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td><img src="${img('header.gif')}" width="640" alt="izzy" style="display:block;width:100%;height:auto;border:0"></td></tr>
    <tr><td style="padding:28px 26px 8px;font-family:Arial,Helvetica,sans-serif">
      <span style="display:inline-block;background:#dcfce7;border:1px solid #86efac;color:#14532d;font-size:12px;font-weight:800;letter-spacing:.08em;padding:8px 14px;border-radius:999px">&#10003;&nbsp; PRE REGISTRO CONFIRMADO</span>
      <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.15;letter-spacing:-1px;color:#10182d">¡Gracias por inscribirte, <span style="color:#6d3bd1">${name}</span>!</h1>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#4f4a66">Tu cuenta en Izzy.com.gt ya quedó creada y tu celular está verificado. Ya eres parte del <b style="color:#10182d">Club Izzy</b>.</p>
    </td></tr>
    <tr><td style="padding:0 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${ticket}
      ${step('user', 'Tu cuenta ya está lista', 'Cuando abramos la tienda, inicia sesión con tu correo y la contraseña que elegiste.')}
      ${step('bell', 'Te avisaremos del lanzamiento', 'Recibirás un correo en cuanto la tienda esté en línea.')}
      ${couponStep}
    </table></td></tr>
    <tr><td align="center" style="padding:8px 26px 26px;font-family:Arial,Helvetica,sans-serif">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td align="center" style="background:#6d3bd1;border:2.5px solid #10182d;border-radius:16px;box-shadow:4px 4px 0 #10182d">
          <a href="${terms}" target="_blank" style="display:inline-block;padding:15px 26px;font-size:16px;font-weight:800;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif">Ver términos y condiciones&nbsp; &rarr;</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;font-size:12px;color:#6b6788">Lee las reglas de la actividad cuando quieras.</p>
    </td></tr>
    <tr><td align="center" style="padding:0 26px 24px;font-family:Arial,Helvetica,sans-serif">
      <div style="border-top:1.5px dashed #cdbdf2;padding-top:20px;font-size:13px;font-weight:800;letter-spacing:.1em;color:#4a2299">SÍGUENOS</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>
        ${social('instagram', 'Instagram')}${social('tiktok', 'TikTok')}${social('facebook', 'Facebook')}${social('whatsapp', 'WhatsApp')}${social('web', 'Sitio web')}
      </tr></table>
    </td></tr>
    <tr><td align="center" style="background:#fbbf24;border-top:2.5px solid #10182d;padding:13px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:900;letter-spacing:.16em;color:#10182d">MUY PRONTO EN LÍNEA &nbsp;·&nbsp; IZZY.COM.GT</td></tr>
  </table>
</td></tr>
<tr><td align="center" style="padding:18px 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#4f4a66">
  Recibes este correo porque te pre registraste en <a href="${site}" style="color:#4a2299;font-weight:700">Izzy.com.gt</a>.
</td></tr>
</table></td></tr></table></body></html>`,
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
