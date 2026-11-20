(function () {
  'use strict'
  var $ = function (s, r) { return (r || document).querySelector(s) }
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)) }
  var root = $('#pr'); if (!root) return

  var cfg = { limit: 100, q25: 50, turnstileSiteKey: '' }
  var est = null            // último estado del contador
  var step = 1, token = '', phoneMasked = '', lastOpener = null
  var timers = { resend: 0, expire: 0 }
  var form = $('#pr-form')
  var TOTAL_STEPS = 3

  function buzz(n) { try { navigator.vibrate && navigator.vibrate(n || 12) } catch (e) {} }
  function api(path, body) {
    return fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, message: 'Error de conexión.' } }).then(function (j) { j.status = r.status; return j }) })
      .catch(function () { return { ok: false, message: 'No hay conexión. Revisa tu internet e inténtalo de nuevo.' } })
  }

  // ---------------------------------------------------------------- contador
  function countTo(el, to) {
    var from = parseInt(el.textContent, 10); if (isNaN(from)) from = to
    if (from === to) { el.textContent = to; return }
    var t0 = performance.now()
    ;(function tick(t) {
      var p = Math.min(1, (t - t0) / 700), v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)))
      el.textContent = v; if (p < 1) requestAnimationFrame(tick)
    })(t0)
  }
  function current() {
    if (!est) return { tier: 'Q25', amount: 25, left: cfg.q25, total: cfg.q25, soldOut: false }
    if (est.q25.left > 0) return { tier: 'Q25', amount: 25, left: est.q25.left, total: est.q25.total, soldOut: false }
    if (est.q15.left > 0) return { tier: 'Q15', amount: 15, left: est.q15.left, total: est.q15.total, soldOut: false }
    return { tier: null, amount: 0, left: 0, total: est.q15.total, soldOut: true }
  }
  function paint() {
    var c = current()
    // tarjeta de la landing
    $$('[data-q25-left]').forEach(function (e) { e.textContent = est ? est.q25.left : '–' })
    $$('[data-q15-left]').forEach(function (e) { e.textContent = est ? est.q15.left : '–' })
    $$('.club .mini [data-w25]').forEach(function (e) { e.style.setProperty('--w', est ? (est.q25.left / est.q25.total * 100) + '%' : '100%') })
    $$('.club .mini [data-w15]').forEach(function (e) { e.style.setProperty('--w', est ? (est.q15.left / Math.max(1, est.q15.total) * 100) + '%' : '100%') })
    var clubTitle = $('#club-title')
    if (clubTitle) clubTitle.textContent = c.soldOut ? 'Los cupones se agotaron, pero aún puedes crear tu acceso' : (c.tier === 'Q25' ? 'Sé de los primeros ' + cfg.q25 + ' y recibe Q 25 en tu primera compra' : 'Quedan cupones de Q 15 para tu primera compra')

    // pop-up
    var tiers = $$('.pr-tier')
    if (est) {
      tiers[0].classList.toggle('out', est.q25.left === 0); tiers[0].classList.toggle('on', c.tier === 'Q25')
      tiers[1].classList.toggle('out', est.q15.left === 0); tiers[1].classList.toggle('on', c.tier === 'Q15')
    }
    $('#pr-gift').textContent = c.soldOut ? 'Cupos agotados' : 'Q ' + c.amount + ' de regalo'
    $('#pr-title').innerHTML = c.soldOut
      ? 'Los cupones se agotaron, <b>pero tu acceso sigue abierto</b>'
      : (c.tier === 'Q25' ? 'Sé de los primeros ' + cfg.q25 + ' y recibe <b>Q 25</b> para tu primera compra' : 'Quedan cupones de <b>Q 15</b> para tu primera compra')
    $('#pr-meter-label').textContent = c.soldOut ? 'Cupones agotados' : 'Cupones de Q ' + c.amount
    countTo($('#pr-left'), c.left)
    $('#pr-total').textContent = c.total
    $('#pr-bar').style.width = (c.total ? (c.left / c.total * 100) : 0) + '%'
    $('#pr-soldnote').style.display = c.soldOut ? 'block' : 'none'
    $('#pr-send-label').textContent = c.soldOut ? 'Crear mi acceso' : 'Quiero mi cupón de Q ' + c.amount
  }
  function refresh() {
    return api('/api/preregistro/estado').then(function (r) { if (r && r.ok) { est = r; paint() } })
  }
  api('/api/config').then(function (c) { if (c && c.limit) { cfg = c; loadTurnstile() } })
  refresh()
  setInterval(function () { if (!document.hidden) refresh() }, 6000)
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh() })

  // ---------------------------------------------------------------- dispositivo ya registrado
  var reg = null
  function readLocal() { try { return JSON.parse(localStorage.getItem('izzy_prereg') || 'null') } catch (e) { return null } }
  function saveLocal(o) { try { localStorage.setItem('izzy_prereg', JSON.stringify(o)) } catch (e) {} }
  function ticketHtml(info) {
    return info.tier
      ? '<small>TU CUPÓN DE BIENVENIDA</small><span class="big">Q ' + String(info.tier).replace('Q', '') + '</span><small>PARA TU PRIMERA COMPRA</small><span class="num">Registro #' + info.position + ' de ' + cfg.limit + '</span>'
      : '<small>TU ACCESO ESTÁ LISTO</small><span class="big" style="font-size:2.2rem">¡Bienvenid@!</span><small>REGISTRO #' + info.position + '</small>'
  }
  function applyRegistered(info) {
    reg = info
    var club = $('.club'); if (club) club.classList.add('is-reg')
    var t = $('#club-title'); if (t) t.textContent = '¡Gracias por registrarte, ' + info.name + '!'
    var s = $('#club-sub'); if (s) s.textContent = 'Ya estás dentro del Club Izzy. Te avisaremos en cuanto abramos la tienda.'
    var h = $('.club-hint'); if (h) h.style.display = 'none'
  }
  function renderRegistered() {
    $('#ok-h').innerHTML = '¡Gracias por registrarte, ' + reg.name.replace(/[<>&]/g, '') + '! 🎉'
    $('#pr-ticket').innerHTML = ticketHtml(reg)
    $('#ok-text').textContent = 'Ya estás dentro del Club Izzy. Te avisaremos por correo cuando abramos la tienda' + (reg.tier ? ' y te enviaremos tu cupón.' : '.')
    show(4)
  }
  api('/api/preregistro/yo').then(function (r) {
    if (r && r.registered) { var info = { name: r.name, position: r.position, tier: r.tier }; saveLocal(info); applyRegistered(info) }
    else { var l = readLocal(); if (l && l.name) applyRegistered(l) }
  })

  // ---------------------------------------------------------------- abrir / cerrar
  function open(e) {
    if (e && e.preventDefault) e.preventDefault()
    lastOpener = document.activeElement
    root.hidden = false
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('open') }) })
    document.body.classList.add('pr-lock'); buzz(10)
    refresh()
    if (reg) renderRegistered()
    setTimeout(function () { var f = $('.pr-step.on input'); if (f && window.innerWidth > 700) f.focus() }, 450)
  }
  function close() {
    root.classList.remove('open'); document.body.classList.remove('pr-lock')
    setTimeout(function () { root.hidden = true; if (lastOpener && lastOpener.focus) lastOpener.focus() }, 420)
  }
  $$('[data-open-prereg]').forEach(function (b) { b.addEventListener('click', open) })
  $$('[data-close]', root).forEach(function (b) { b.addEventListener('click', close) })
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !root.hidden) close() })

  // arrastrar la barra superior hacia abajo para cerrar (celular)
  ;(function () {
    var sheet = $('.pr-sheet'), grab = $('.pr-grab'), y0 = null, dy = 0
    grab.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); sheet.style.transition = 'none' })
    grab.addEventListener('pointermove', function (e) { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = 'translateY(' + dy + 'px)' })
    function end() { if (y0 === null) return; sheet.style.transition = ''; sheet.style.transform = ''; if (dy > 110) close(); y0 = null }
    grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end)
  })()

  // ---------------------------------------------------------------- pasos
  function show(n, back) {
    step = n
    $$('.pr-step').forEach(function (s) {
      var on = +s.getAttribute('data-step') === n
      s.classList.toggle('on', on); s.classList.toggle('back', !!back && on)
    })
    $$('.pr-dots i').forEach(function (d, i) { d.className = i + 1 < n ? 'done' : (i + 1 === n ? 'cur' : '') })
    $('.pr-dots').style.display = n > TOTAL_STEPS ? 'none' : 'flex'
    $('.pr-sheet').classList.toggle('is-done', n > TOTAL_STEPS)
    $('.pr-sheet').scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(function () { var f = $('.pr-step.on input:not([type=checkbox]), .pr-step.on select'); if (f && window.innerWidth > 700) f.focus() }, 380)
  }
  function setBad(el, bad, msg) {
    var wrap = el.closest('.f, .chk'); if (!wrap) return
    wrap.classList.toggle('bad', !!bad)
    var err = $('.err', wrap); if (err && msg) err.textContent = msg
  }
  function alertBox(msg) {
    var a = $('.pr-step.on .pr-alert'); if (!a) return
    a.textContent = msg || ''; a.classList.remove('show'); void a.offsetWidth; if (msg) a.classList.add('show')
  }
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  function phoneDigits() { return form.phone.value.replace(/\D/g, '').replace(/^502(?=\d{8}$)/, '') }

  function validate1() {
    var ok = true
    var fn = form.firstName.value.trim().length >= 2; setBad(form.firstName, !fn, 'Ingresa tu nombre'); ok = ok && fn
    var ln = form.lastName.value.trim().length >= 2; setBad(form.lastName, !ln, 'Ingresa tu apellido'); ok = ok && ln
    var ph = phoneDigits().length === 8; setBad(form.phone, !ph, 'Escribe tus 8 dígitos'); ok = ok && ph
    var em = EMAIL.test(form.email.value.trim()); setBad(form.email, !em, 'Correo no válido'); ok = ok && em
    return ok
  }
  function validate3() {
    var ok = true
    var pw = form.password.value.length >= 8; setBad(form.password, !pw, 'Usa al menos 8 caracteres'); ok = ok && pw
    var cf = form.confirm.value === form.password.value && !!form.confirm.value; setBad(form.confirm, !cf, 'Las contraseñas no coinciden'); ok = ok && cf
    var tm = form.acceptsTerms.checked; setBad(form.acceptsTerms, !tm, 'Debes aceptar los términos y condiciones para continuar'); ok = ok && tm
    return ok
  }
  function next(from) {
    buzz(8)
    if (from === 1 && !validate1()) return buzz([20, 40, 20])
    if (from === 2 && !validate3()) return buzz([20, 40, 20])
    if (from === 2) return sendCode()
    show(from + 1)
  }
  $$('[data-next]').forEach(function (b) { b.addEventListener('click', function () { next(+b.getAttribute('data-next')) }) })
  $$('[data-back]').forEach(function (b) { b.addEventListener('click', function () { show(+b.getAttribute('data-back'), true) }) })
  form.addEventListener('submit', function (e) { e.preventDefault(); if (step <= 2) next(step) })
  $$('input', form).forEach(function (i) { i.addEventListener('input', function () { var w = i.closest('.f, .chk'); if (w) w.classList.remove('bad') }) })

  // formato de teléfono "5555 1234"
  form.phone.addEventListener('input', function () {
    var d = form.phone.value.replace(/\D/g, '').replace(/^502(?=\d{8}$)/, '').slice(0, 8)
    form.phone.value = d.length > 4 ? d.slice(0, 4) + ' ' + d.slice(4) : d
  })
  // contraseña: mostrar y fuerza
  $('#pw-eye').addEventListener('click', function () {
    var t = form.password.type === 'password'; form.password.type = t ? 'text' : 'password'; form.confirm.type = form.password.type
    this.textContent = t ? '🙈' : '👁️'
  })
  form.password.addEventListener('input', function () {
    var v = form.password.value, s = 0
    if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++
    var m = $('#pw-meter i'); m.style.width = (v ? Math.max(15, s * 25) : 0) + '%'; m.style.background = ['#dc2626', '#f59e0b', '#84cc16', '#16a34a', '#16a34a'][s]
  })

  // ---------------------------------------------------------------- Turnstile
  var tsId = null
  function loadTurnstile() {
    if (!cfg.turnstileSiteKey || window.turnstile || document.getElementById('ts-script')) return
    var s = document.createElement('script'); s.id = 'ts-script'; s.async = true
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__tsReady'
    window.__tsReady = function () { tsId = window.turnstile.render('#pr-ts', { sitekey: cfg.turnstileSiteKey, theme: 'light' }) }
    document.head.appendChild(s)
  }

  // ---------------------------------------------------------------- enviar código
  var sending = false
  function setBusy(btn, busy, label) {
    btn.disabled = busy
    var l = $('.lbl', btn); if (!l) return
    if (busy) { l.innerHTML = '<span class="spin"></span>' + label } else { l.textContent = label }
  }
  function sendCode() {
    if (sending) return; sending = true
    var btn = $('#pr-send'); alertBox('')
    setBusy(btn, true, 'Enviando código…')
    api('/api/preregistro/enviar-codigo', {
      firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim(), email: form.email.value.trim(),
      phone: phoneDigits(), password: form.password.value, confirm: form.confirm.value,
      acceptsTerms: form.acceptsTerms.checked, acceptsMarketing: form.acceptsMarketing.checked,
      turnstileToken: window.turnstile && tsId !== null ? window.turnstile.getResponse(tsId) : '',
      website: form.website.value,
    }).then(function (r) {
      sending = false; setBusy(btn, false, current().soldOut ? 'Crear mi acceso' : 'Quiero mi cupón de Q ' + current().amount)
      if (window.turnstile && tsId !== null) window.turnstile.reset(tsId)
      if (!r.ok) { buzz([30, 40, 30]); return alertBox(r.message || 'No pudimos continuar.') }
      token = r.token; phoneMasked = r.phoneMasked
      $('#otp-phone').textContent = phoneMasked
      show(3); startTimers(r.resendIn, r.expiresIn); clearOtp(); buzz(15)
    })
  }

  // ---------------------------------------------------------------- OTP
  var otpInputs = $$('.otp input')
  function otpValue() { return otpInputs.map(function (i) { return i.value }).join('') }
  function clearOtp() { otpInputs.forEach(function (i) { i.value = '' }); $('.otp').classList.remove('bad'); setTimeout(function () { otpInputs[0].focus() }, 400) }
  otpInputs.forEach(function (inp, idx) {
    inp.addEventListener('input', function () {
      inp.value = inp.value.replace(/\D/g, '').slice(-1)
      if (inp.value && idx < 5) otpInputs[idx + 1].focus()
      if (otpValue().length === 6) verify()
    })
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !inp.value && idx > 0) { otpInputs[idx - 1].focus(); otpInputs[idx - 1].value = '' }
      if (e.key === 'ArrowLeft' && idx > 0) otpInputs[idx - 1].focus()
      if (e.key === 'ArrowRight' && idx < 5) otpInputs[idx + 1].focus()
    })
    inp.addEventListener('focus', function () { inp.select() })
    inp.addEventListener('paste', function (e) {
      var t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6)
      if (!t) return; e.preventDefault()
      t.split('').forEach(function (ch, i) { otpInputs[i].value = ch })
      otpInputs[Math.min(t.length, 5)].focus(); if (t.length === 6) verify()
    })
  })
  function startTimers(resendIn, expiresIn) {
    clearInterval(timers.resend); clearInterval(timers.expire)
    var r = resendIn || 60, e = expiresIn || 600
    var rb = $('#otp-resend'), ex = $('#otp-expire')
    function paintR() { rb.disabled = r > 0; rb.textContent = r > 0 ? 'Reenviar en ' + r + ' s' : 'Reenviar código' }
    function paintE() { var m = Math.floor(e / 60), s = e % 60; ex.textContent = e > 0 ? 'Vence en ' + m + ':' + (s < 10 ? '0' : '') + s : 'El código venció' }
    paintR(); paintE()
    timers.resend = setInterval(function () { if (r > 0) { r--; paintR() } }, 1000)
    timers.expire = setInterval(function () { if (e > 0) { e--; paintE() } }, 1000)
  }
  $('#otp-resend').addEventListener('click', function () {
    var b = this; b.disabled = true; alertBox('')
    api('/api/preregistro/reenviar', { token: token }).then(function (r) {
      if (!r.ok) { alertBox(r.message); if (r.restart) { setTimeout(function () { show(2, true) }, 1600) } else { b.disabled = false } return }
      token = r.token; startTimers(r.resendIn, r.expiresIn); clearOtp(); buzz(12)
    })
  })
  var verifying = false
  function verify() {
    if (verifying) return; verifying = true; alertBox('')
    var code = otpValue(); $('.otp').classList.remove('bad')
    api('/api/preregistro/verificar', { token: token, code: code }).then(function (r) {
      verifying = false
      if (!r.ok) {
        buzz([30, 40, 30]); $('.otp').classList.add('bad'); alertBox(r.message || 'Código incorrecto.')
        if (r.restart) { setTimeout(function () { show(2, true) }, 1800) } else { setTimeout(function () { otpInputs.forEach(function (i) { i.value = '' }); $('.otp').classList.remove('bad'); otpInputs[0].focus() }, 500) }
        return
      }
      clearInterval(timers.resend); clearInterval(timers.expire)
      success(r); refresh()
    })
  }

  // ---------------------------------------------------------------- éxito + confeti
  function success(r) {
    var name = form.firstName.value.trim()
    $('#ok-h').innerHTML = '¡Listo, <span id="ok-name"></span>! 🎉'
    $('#ok-name').textContent = name
    var t = $('#pr-ticket')
    if (r.tier) {
      t.innerHTML = '<small>TU CUPÓN DE BIENVENIDA</small><span class="big">Q ' + r.tier.replace('Q', '') + '</span><small>PARA TU PRIMERA COMPRA</small><span class="num">Registro #' + r.position + ' de ' + cfg.limit + '</span>'
      $('#ok-text').textContent = 'Tu teléfono quedó verificado y tu cuenta ya está creada. Te enviaremos tu cupón cuando abramos la tienda. Revisa tu correo: te escribimos.'
    } else {
      t.innerHTML = '<small>TU ACCESO ESTÁ LISTO</small><span class="big" style="font-size:2.2rem">¡Bienvenid@!</span><small>REGISTRO #' + r.position + '</small>'
      $('#ok-text').textContent = 'Los cupones de lanzamiento ya se agotaron, pero tu cuenta quedó creada y te avisaremos en cuanto abramos la tienda.'
    }
    show(4); buzz([20, 60, 20, 60, 40]); confetti()
    var info = { name: name, position: r.position, tier: r.tier }; saveLocal(info); applyRegistered(info)
    form.reset(); token = ''
  }
  var cv = $('#pr-fx'), cx = cv.getContext('2d'), ps = [], raf = 0
  function sizeCv() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio }
  sizeCv(); addEventListener('resize', sizeCv)
  function confetti() {
    var chars = ['⚡', '✦', '★', '✧', '🎁'], cols = ['#8b5cf6', '#fbbf24', '#16a34a', '#6d3bd1', '#f472b6']
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * Math.PI * 2, v = 5 + Math.random() * 11
      ps.push({ x: innerWidth / 2, y: innerHeight * 0.42, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 7, r: Math.random() * 6, vr: (Math.random() - .5) * .35, s: 14 + Math.random() * 18, c: chars[i % 5], k: cols[i % 5], l: 1 })
    }
    if (!raf) loop()
  }
  function loop() {
    var d = devicePixelRatio; cx.clearRect(0, 0, cv.width, cv.height)
    ps = ps.filter(function (p) { return p.l > 0 })
    ps.forEach(function (p) {
      p.vy += .3; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.r += p.vr; p.l -= .011
      cx.save(); cx.globalAlpha = Math.max(p.l, 0); cx.translate(p.x * d, p.y * d); cx.rotate(p.r); cx.fillStyle = p.k
      cx.font = (p.s * d) + 'px sans-serif'; cx.textAlign = 'center'; cx.fillText(p.c, 0, 0); cx.restore()
    })
    raf = ps.length ? requestAnimationFrame(loop) : 0; if (!raf) cx.clearRect(0, 0, cv.width, cv.height)
  }
  $('#ok-share').addEventListener('click', function () {
    var data = { title: 'Club Izzy', text: 'Me pre registré en Izzy.com.gt y estoy entre los primeros para recibir un cupón. Únete tú también:', url: location.origin }
    if (navigator.share) navigator.share(data).catch(function () {})
    else window.open('https://api.whatsapp.com/send/?text=' + encodeURIComponent(data.text + ' ' + data.url), '_blank', 'noopener')
  })
  $('#ok-close').addEventListener('click', close)

  show(1)
})()
