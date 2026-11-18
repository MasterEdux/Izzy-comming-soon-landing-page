/**
 * Normaliza un teléfono a formato E.164 (+502XXXXXXXX).
 * Acepta 8 dígitos (Guatemala), 502 + 8 dígitos, o un número internacional con "+".
 * Devuelve null si no parece un teléfono válido.
 */
export function normalizePhone(raw) {
  const input = String(raw ?? '').trim()
  const digits = input.replace(/\D/g, '')
  if (!digits) return null

  if (input.startsWith('+') || input.startsWith('00')) {
    const intl = input.startsWith('00') ? digits.slice(2) : digits
    if (intl.length < 8 || intl.length > 15) return null
    if (intl.startsWith('502') && intl.length !== 11) return null
    return `+${intl}`
  }
  if (digits.length === 8) return `+502${digits}`
  if (digits.length === 11 && digits.startsWith('502')) return `+${digits}`
  return null
}

/** labsMobile pide el número internacional sin "+". */
export function toMsisdn(e164) {
  return e164.replace(/^\+/, '')
}

export function maskPhone(e164) {
  return e164.length > 6 ? `${e164.slice(0, 4)}••••${e164.slice(-2)}` : e164
}
