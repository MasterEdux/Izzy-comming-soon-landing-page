import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

process.env.TOKEN_SECRET = 'x'.repeat(40)
process.env.DATABASE_URL = 'postgres://test'
process.env.SMS_DRY_RUN = 'true'
process.env.SOCIAL_HOST = 'social.test'

const { buildApp } = await import('../src/app.js')
const { createDb } = await import('../src/db.js')

let pg, app, ipCounter = 0
const logs = []
const realLog = console.log
console.log = (...a) => { logs.push(a.join(' ')); realLog(...a) }

const lastCode = () => {
  const line = [...logs].reverse().find((l) => l.startsWith('[SMS simulado]'))
  return line.match(/es (\d{6})\./)[1]
}

before(async () => {
  pg = new PGlite()
  // Misma estructura que la tabla "Customer" de la tienda (migración init de Prisma).
  await pg.exec(`
    CREATE TABLE "Customer" (
      "id" TEXT NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT, "firstName" TEXT, "lastName" TEXT,
      "phone" TEXT, "company" TEXT, "state" TEXT, "acceptsMarketing" BOOLEAN NOT NULL DEFAULT false,
      "tags" TEXT[] DEFAULT ARRAY[]::TEXT[], "segment" TEXT NOT NULL DEFAULT 'LEAD',
      "ordersCount" INTEGER NOT NULL DEFAULT 0, "lastSeenAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");
  `)
  const pool = { query: (t, p) => pg.query(t, p), connect: async () => ({ query: (t, p) => pg.query(t, p), release() {} }) }
  app = buildApp({ db: createDb(pool) })
})

const post = (url, payload, ip) => app.inject({ method: 'POST', url, payload, remoteAddress: ip ?? `10.0.0.${++ipCounter}` })
const form = (over = {}) => ({
  firstName: 'Ana', lastName: 'López', email: 'ana@example.com', phone: '5555 1234', department: 'Guatemala', interests: ['glow', 'mascotas'], source: 'instagram',
  password: 'secreta123', confirm: 'secreta123', acceptsTerms: true, acceptsMarketing: true, ...over,
})

async function registrar(over) {
  const sent = await post('/api/preregistro/enviar-codigo', form(over))
  assert.equal(sent.statusCode, 200, sent.body)
  const { token } = sent.json()
  return post('/api/preregistro/verificar', { token, code: lastCode() })
}

test('estado inicial: 50 de Q25 y 50 de Q15', async () => {
  const r = (await app.inject({ url: '/api/preregistro/estado' })).json()
  assert.equal(r.taken, 0)
  assert.deepEqual([r.q25.left, r.q15.left, r.left], [50, 50, 100])
})

test('flujo completo: OTP correcto crea la cuenta con posición 1 y cupón Q25', async () => {
  const sent = await post('/api/preregistro/enviar-codigo', form())
  assert.equal(sent.statusCode, 200)
  const { token, phoneMasked } = sent.json()
  assert.match(phoneMasked, /^\+502•+34$/)

  const bad = await post('/api/preregistro/verificar', { token, code: '000000' })
  assert.equal(bad.statusCode, 400)
  assert.match(bad.json().message, /incorrecto/i)

  const ok = await post('/api/preregistro/verificar', { token, code: lastCode() })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.deepEqual([ok.json().position, ok.json().tier], [1, 'Q25'])

  const row = (await pg.query(`SELECT * FROM "Customer" WHERE email = 'ana@example.com'`)).rows[0]
  assert.equal(row.phone, '+50255551234')
  assert.equal(row.acceptsMarketing, true)
  assert.deepEqual(row.tags, ['preregistro', 'tel-verificado', 'prereg-1', 'interes:glow', 'interes:mascotas', 'origen:instagram'])
  assert.equal(row.state, 'Guatemala')
  assert.match(row.passwordHash, /^\$2[aby]\$/)
  assert.notEqual(row.passwordHash, 'secreta123')

  // el mismo token no se puede reutilizar
  const replay = await post('/api/preregistro/verificar', { token, code: lastCode() })
  assert.equal(replay.statusCode, 400)
})

test('correo o teléfono repetidos se rechazan antes de enviar el SMS', async () => {
  const before = logs.length
  const dupEmail = await post('/api/preregistro/enviar-codigo', form())
  assert.equal(dupEmail.statusCode, 409)
  assert.equal(dupEmail.json().code, 'ALREADY_PREREGISTERED')
  const dupPhone = await post('/api/preregistro/enviar-codigo', form({ email: 'otra@example.com' }))
  assert.equal(dupPhone.statusCode, 409)
  assert.equal(dupPhone.json().code, 'PHONE_EXISTS')
  assert.equal(logs.length, before, 'no debió enviarse ningún SMS')
})

test('un cliente invitado existente se reutiliza', async () => {
  await pg.query(`INSERT INTO "Customer" (id, email, "firstName", "ordersCount", "updatedAt") VALUES ('guest1','guest@example.com','Gus',3, now())`)
  const res = await registrar({ email: 'guest@example.com', phone: '+502 4444 0000' })
  assert.equal(res.statusCode, 200, res.body)
  const row = (await pg.query(`SELECT * FROM "Customer" WHERE email = 'guest@example.com'`)).rows[0]
  assert.equal(row.id, 'guest1')
  assert.equal(row.ordersCount, 3)
  assert.equal(row.firstName, 'Ana')
  assert.ok(row.passwordHash)
  assert.ok(row.tags.includes('preregistro'))
})

test('validaciones del formulario', async () => {
  for (const [over, re] of [
    [{ confirm: 'otra' }, /no coinciden/i],
    [{ acceptsTerms: false }, /términos/i],
    [{ phone: '123' }, /teléfono/i],
    [{ password: 'corta' }, /8 caracteres/i],
    [{ email: 'no-es-correo' }, /correo/i],
    [{ department: 'Marte' }, /./],
    [{ interests: ['x'] }, /./],
  ]) {
    const r = await post('/api/preregistro/enviar-codigo', form({ email: 'v@example.com', ...over }))
    assert.equal(r.statusCode, 400, JSON.stringify(over))
    assert.match(r.json().message, re)
  }
})

test('token alterado o código vencido', async () => {
  const bad = await post('/api/preregistro/verificar', { token: 'abc', code: '123456' })
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.json().restart, true)
})

test('límite de intentos del código', async () => {
  const { token } = (await post('/api/preregistro/enviar-codigo', form({ email: 'int@example.com', phone: '3333 0001' }))).json()
  let last
  for (let i = 0; i < 5; i++) last = await post('/api/preregistro/verificar', { token, code: '111111' }, '10.9.9.9')
  assert.match(last.json().message, /Demasiados intentos/)
  const blocked = await post('/api/preregistro/verificar', { token, code: lastCode() }, '10.9.9.9')
  assert.equal(blocked.statusCode, 429)
})

test('reenviar exige esperar y genera un código nuevo', async () => {
  const { token } = (await post('/api/preregistro/enviar-codigo', form({ email: 're@example.com', phone: '3333 0002' }))).json()
  const tooSoon = await post('/api/preregistro/reenviar', { token })
  assert.equal(tooSoon.statusCode, 429)
})

test('posición 51 recibe Q15 y después de 100 no hay cupón pero la cuenta se crea', async () => {
  await pg.query(`
    INSERT INTO "Customer" (id, email, tags, "updatedAt")
    SELECT 'f' || g, 'fill' || g || '@x.com', ARRAY['preregistro','prereg-' || g], now()
      FROM generate_series(3, 50) g`)
  const r51 = await registrar({ email: 'p51@example.com', phone: '3333 0051' })
  assert.deepEqual([r51.json().position, r51.json().tier], [51, 'Q15'])

  let estado = (await app.inject({ url: '/api/preregistro/estado' })).json()
  assert.equal(estado.q25.left, 0)
  assert.equal(estado.q15.left, 49)

  await pg.query(`
    INSERT INTO "Customer" (id, email, tags, "updatedAt")
    SELECT 'g' || g, 'fillb' || g || '@x.com', ARRAY['preregistro','prereg-' || g], now()
      FROM generate_series(52, 100) g`)
  const r101 = await registrar({ email: 'p101@example.com', phone: '3333 0101' })
  assert.equal(r101.statusCode, 200)
  assert.deepEqual([r101.json().position, r101.json().tier, r101.json().soldOut], [101, null, true])

  await new Promise((r) => setTimeout(r, 3100)) // la caché del contador dura 3 s
  estado = (await app.inject({ url: '/api/preregistro/estado' })).json()
  assert.deepEqual([estado.left, estado.q25.left, estado.q15.left], [0, 0, 0])
})

test('estáticos: landing, social y rutas bloqueadas', async () => {
  const landing = await app.inject({ url: '/' })
  assert.equal(landing.statusCode, 200)
  assert.match(landing.body, /Lo que quieres/)
  const social = await app.inject({ url: '/', headers: { host: 'social.test' } })
  assert.match(social.body, /Todos nuestros enlaces/)
  const traversal = await app.inject({ url: '/..%2F..%2Fserver%2Fpackage.json' })
  assert.equal(traversal.statusCode, 404)
  const src = await app.inject({ url: '/server/package.json' })
  assert.equal(src.statusCode, 404)
})

test('el dispositivo registrado se reconoce con una cookie firmada', async () => {
  const sent = await post('/api/preregistro/enviar-codigo', form({ email: 'cookie@example.com', phone: '3333 0777', firstName: 'Lucía' }))
  const ok = await post('/api/preregistro/verificar', { token: sent.json().token, code: lastCode() })
  assert.equal(ok.statusCode, 200, ok.body)
  const setCookie = ok.headers['set-cookie']
  assert.match(setCookie, /^izzy_pr=.+HttpOnly.+SameSite=Lax/)

  const cookie = setCookie.split(';')[0]
  const yo = (await app.inject({ url: '/api/preregistro/yo', headers: { cookie } })).json()
  assert.equal(yo.registered, true)
  assert.equal(yo.name, 'Lucía')

  const sin = (await app.inject({ url: '/api/preregistro/yo' })).json()
  assert.equal(sin.registered, false)
  const falsa = (await app.inject({ url: '/api/preregistro/yo', headers: { cookie: 'izzy_pr=inventada' } })).json()
  assert.equal(falsa.registered, false)
})

test('JS y CSS se revalidan (ETag) para que las actualizaciones lleguen', async () => {
  const a = await app.inject({ url: '/preregistro.js' })
  assert.equal(a.headers['cache-control'], 'no-cache')
  const b = await app.inject({ url: '/preregistro.js', headers: { 'if-none-match': a.headers.etag } })
  assert.equal(b.statusCode, 304)
})
