// Servidor de prueba LOCAL: usa una base Postgres en memoria (PGlite) con la misma tabla "Customer".
// No toca producción. Uso: npm run dev:local  ->  http://localhost:3000
process.env.TOKEN_SECRET ||= 'dev-secret-dev-secret-dev-secret-1234'
process.env.DATABASE_URL ||= 'postgres://local'
process.env.SMS_DRY_RUN ||= 'true'
process.env.SOCIAL_HOST ||= 'social.localhost'
const { PGlite } = await import('@electric-sql/pglite')
const { buildApp } = await import('./src/app.js')
const { createDb } = await import('./src/db.js')
const { config } = await import('./src/config.js')

const pg = new PGlite()
await pg.exec(`
  CREATE TABLE "Customer" (
    "id" TEXT NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT, "firstName" TEXT, "lastName" TEXT,
    "phone" TEXT, "company" TEXT, "state" TEXT, "acceptsMarketing" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[], "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id"));
  CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");
  INSERT INTO "Customer" (id, email, tags, "updatedAt")
    SELECT 'seed'||g, 'seed'||g||'@x.com', ARRAY['preregistro','prereg-'||g], now() FROM generate_series(1, 32) g;
`)
const pool = { query: (t, p) => pg.query(t, p), connect: async () => ({ query: (t, p) => pg.query(t, p), release() {} }) }
const app = buildApp({ db: createDb(pool), logger: false })
await app.listen({ port: config.port, host: '127.0.0.1' })
console.log(`Prueba local en http://localhost:${config.port} (32 de 100 cupos ya tomados de ejemplo)`)
