import { config, assertConfig } from './config.js'
import { createDb, createPgPool } from './db.js'
import { buildApp } from './app.js'

for (const problem of assertConfig()) console.warn(`[config] ${problem}`)
if (config.tokenSecret.length < 32 || !config.databaseUrl) {
  console.error('Faltan variables obligatorias (TOKEN_SECRET, DATABASE_URL). Revisa .env.example.')
  process.exit(1)
}

const pool = await createPgPool()
pool.on('error', (e) => console.error('[pg]', e.message))
const app = buildApp({ db: createDb(pool), logger: { level: config.production ? 'warn' : 'info' } })

await app.listen({ port: config.port, host: '0.0.0.0' })
console.log(`Izzy listo en el puerto ${config.port} (SMS ${config.smsDryRun ? 'simulado' : 'real'})`)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close()
    await pool.end()
    process.exit(0)
  })
}
