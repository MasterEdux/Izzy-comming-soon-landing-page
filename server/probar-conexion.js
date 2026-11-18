// Prueba la cadena DATABASE_URL desde tu computadora, sin mostrar la clave.
// Uso (PowerShell):
//   $env:DATABASE_URL = "postgresql://izzy_landing.ID:CLAVE@aws-0-REGION.pooler.supabase.com:6543/postgres"
//   node probar-conexion.js
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.log('Falta definir DATABASE_URL en esta terminal (mira el uso arriba).')
  process.exit(1)
}

let info = ''
try {
  const u = new URL(url)
  info = `usuario=${decodeURIComponent(u.username)}  servidor=${u.hostname}  puerto=${u.port}  base=${u.pathname.slice(1)}  largo_clave=${decodeURIComponent(u.password).length}`
} catch {
  console.log('La cadena no se puede leer como URL. Revisa que no haya espacios ni símbolos sin codificar en la clave.')
  process.exit(1)
}
const pass = decodeURIComponent(new URL(url).password)
const flags = []
if (/\s/.test(pass)) flags.push('ESPACIOS')
if (/["']/.test(pass)) flags.push('COMILLAS')
if (/[^A-Za-z0-9]/.test(pass.replace(/["'\s]/g, ''))) flags.push('SIMBOLOS')
console.log(info)
console.log('Revisión de la clave:', flags.length ? 'contiene ' + flags.join(', ') : 'solo letras y números (bien)')

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
try {
  const r = await pool.query(`SELECT count(*)::int AS clientes FROM "Customer"`)
  console.log('CONEXIÓN OK. Clientes en la tabla:', r.rows[0].clientes)
  const p = await pool.query(`SELECT count(*)::int AS preregistros FROM "Customer" WHERE 'preregistro' = ANY("tags")`)
  console.log('Pre registros:', p.rows[0].preregistros)
} catch (e) {
  console.log('ERROR:', e.message)
}
await pool.end()
