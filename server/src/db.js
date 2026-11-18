import crypto from 'node:crypto'
import { config, tierFor } from './config.js'

const LOCK_KEY = 7311001 // bloqueo de la campaña: evita posiciones repetidas
const NOW_UTC = `(now() AT TIME ZONE 'UTC')`

const cuidLike = () => `c${Date.now().toString(36)}${crypto.randomBytes(9).toString('hex')}`

/**
 * Acceso a la tabla "Customer" de la tienda (Prisma). No se cambia el esquema:
 * los pre registros se identifican con las etiquetas `preregistro`,
 * `tel-verificado` y `prereg-<posición>`.
 */
export function createDb(pool) {
  async function status() {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "Customer" WHERE 'preregistro' = ANY("tags")`)
    const taken = rows[0].n
    const q15Total = Math.max(0, config.limit - config.q25)
    return {
      limit: config.limit,
      taken,
      left: Math.max(0, config.limit - taken),
      q25: { total: config.q25, left: Math.max(0, config.q25 - taken) },
      q15: { total: q15Total, left: taken <= config.q25 ? q15Total : Math.max(0, config.limit - taken) },
    }
  }

  /** ¿Se puede registrar este correo/teléfono? Sirve para avisar antes de gastar un SMS. */
  async function checkAvailability({ email, phone }) {
    const byEmail = await pool.query(`SELECT "passwordHash", "tags" FROM "Customer" WHERE email = $1`, [email])
    const row = byEmail.rows[0]
    if (row?.passwordHash) {
      return { ok: false, code: (row.tags ?? []).includes('preregistro') ? 'ALREADY_PREREGISTERED' : 'EMAIL_EXISTS' }
    }
    const byPhone = await pool.query(
      `SELECT 1 FROM "Customer" WHERE phone = $1 AND 'preregistro' = ANY("tags") AND email <> $2 LIMIT 1`,
      [phone, email],
    )
    if (byPhone.rows.length) return { ok: false, code: 'PHONE_EXISTS' }
    return { ok: true }
  }

  /** Crea (o completa) el cliente con el teléfono ya verificado. Todo dentro de una transacción con bloqueo. */
  async function registerCustomer({ firstName, lastName, email, phone, passwordHash, acceptsMarketing, department = null, interests = [], source = null }) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY])

      const existing = (await client.query(`SELECT id, "passwordHash", tags FROM "Customer" WHERE email = $1`, [email])).rows[0]
      if (existing?.passwordHash) {
        await client.query('ROLLBACK')
        return { ok: false, code: (existing.tags ?? []).includes('preregistro') ? 'ALREADY_PREREGISTERED' : 'EMAIL_EXISTS' }
      }
      const phoneTaken = await client.query(
        `SELECT 1 FROM "Customer" WHERE phone = $1 AND 'preregistro' = ANY("tags") AND email <> $2 LIMIT 1`,
        [phone, email],
      )
      if (phoneTaken.rows.length) {
        await client.query('ROLLBACK')
        return { ok: false, code: 'PHONE_EXISTS' }
      }

      const { rows } = await client.query(`SELECT count(*)::int AS n FROM "Customer" WHERE 'preregistro' = ANY("tags")`)
      const position = rows[0].n + 1
      const tags = ['preregistro', 'tel-verificado', `prereg-${position}`, ...interests.map((i) => `interes:${i}`)]
      if (source) tags.push(`origen:${source}`)

      let id
      if (existing) {
        // Ya compró como invitado: se reutiliza su ficha y su historial.
        id = existing.id
        await client.query(
          `UPDATE "Customer"
              SET "passwordHash" = $2, "firstName" = $3, "lastName" = $4, phone = $5, state = COALESCE($8, state),
                  "acceptsMarketing" = ("acceptsMarketing" OR $6), tags = COALESCE(tags, '{}') || $7::text[],
                  "lastSeenAt" = ${NOW_UTC}, "updatedAt" = ${NOW_UTC}
            WHERE id = $1`,
          [id, passwordHash, firstName, lastName, phone, acceptsMarketing, tags, department],
        )
      } else {
        id = cuidLike()
        await client.query(
          `INSERT INTO "Customer"
             (id, email, "passwordHash", "firstName", "lastName", phone, "acceptsMarketing", tags, state,
              "lastSeenAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, ${NOW_UTC}, ${NOW_UTC}, ${NOW_UTC})`,
          [id, email, passwordHash, firstName, lastName, phone, acceptsMarketing, tags, department],
        )
      }
      await client.query('COMMIT')
      return { ok: true, id, position, tier: tierFor(position) }
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { /* sin transacción activa */ }
      if (error?.code === '23505') return { ok: false, code: 'EMAIL_EXISTS' }
      throw error
    } finally {
      client.release()
    }
  }

  return { status, checkAvailability, registerCustomer }
}

export async function createPgPool() {
  const { default: pg } = await import('pg')
  return new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  })
}
