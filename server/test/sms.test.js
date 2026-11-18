import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TOKEN_SECRET = 'x'.repeat(40)
process.env.LABSMOBILE_USER = 'cuenta@izzy.com.gt'
process.env.LABSMOBILE_TOKEN = 'token-secreto'
delete process.env.LABSMOBILE_SENDER

const { sendSms, otpMessage } = await import('../src/services.js')

function mockFetch(response) {
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response }
  return calls
}
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

test('envía el SMS con el formato de labsMobile', async () => {
  const calls = mockFetch(reply({ code: '0', message: 'Message has been successfully sent, 1 message(s)' }))
  await sendSms('+50255512345', otpMessage('123456'))
  const { url, init } = calls[0]
  assert.equal(url, 'https://api.labsmobile.com/json/send')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('cuenta@izzy.com.gt:token-secreto').toString('base64'))
  const body = JSON.parse(init.body)
  assert.deepEqual(body.recipient, [{ msisdn: '50255512345' }])
  assert.equal('tpoa' in body, false, 'sin remitente configurado no se manda tpoa')
  assert.match(body.message, /123456/)
})

test('un código distinto de "0" o un HTTP de error lanza excepción', async () => {
  mockFetch(reply({ code: '23', message: 'Not enough credits' }))
  await assert.rejects(sendSms('+50255512345', 'hola'), /code 23/)
  mockFetch(reply({ message: 'Unauthorized' }, 401))
  await assert.rejects(sendSms('+50255512345', 'hola'), /HTTP 401/)
})

test('el mensaje cabe en un SMS (GSM-7, menos de 160)', () => {
  const m = otpMessage('123456')
  assert.ok(m.length < 160, String(m.length))
  assert.match(m, /^[\x20-\x7E]+$/, 'solo ASCII: sin tildes para no partir el SMS')
})
