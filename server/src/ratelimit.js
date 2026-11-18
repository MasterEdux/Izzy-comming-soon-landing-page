/** Límite de peticiones en memoria (ventana deslizante). Suficiente para una sola instancia. */
const buckets = new Map()

export function hit(key, max, windowMs) {
  const now = Date.now()
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= max) {
    buckets.set(key, list)
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - list[0])) / 1000) }
  }
  list.push(now)
  buckets.set(key, list)
  return { ok: true, retryAfterSec: 0 }
}

setInterval(() => {
  const now = Date.now()
  for (const [k, list] of buckets) {
    if (!list.length || now - list[list.length - 1] > 3_600_000) buckets.delete(k)
  }
}, 600_000).unref()

/** Intentos fallidos por token de OTP y tokens ya usados (anti repetición). */
const attempts = new Map()
const used = new Set()

export const otpAttempts = {
  get: (id) => attempts.get(id) ?? 0,
  add: (id) => {
    attempts.set(id, (attempts.get(id) ?? 0) + 1)
    return attempts.get(id)
  },
  markUsed: (id) => {
    used.add(id)
    if (used.size > 5000) used.delete(used.values().next().value)
  },
  isUsed: (id) => used.has(id),
}
