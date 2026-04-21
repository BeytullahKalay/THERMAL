/* ═══════════════════════════════════════════════════════════════════
   THERMAL — messaging.js
   Elena's post-shift message conversation in the MESSAGES tab.
   Depends on: saveSystem.js
   ═══════════════════════════════════════════════════════════════════ */
;(function() {
  'use strict'

  /* ── DOM refs ─────────────────────────────────────────────────── */
  var logEl         = document.getElementById('msg-log')
  var decisionEl    = document.getElementById('msg-decision')
  var decisionRowEl = document.getElementById('msg-decision-row')
  var endedEl       = document.getElementById('msg-ended')
  var statusEl      = document.getElementById('msg-status')

  if (!logEl) return   // not on the right page

  /* ── Save state ───────────────────────────────────────────────── */
  var _save = window.saveSystem ? window.saveSystem.loadGame() : null
  if (!_save) { logEl.innerHTML = '<div class="typing-indicator">// NO DATA</div>'; return }

  var tone      = Math.max(0, Math.min(3, _save.elenaToneLevel    || 0))
  var radiation = _save.lastShiftRadiation || 0
  var shiftNum  = _save.shiftNumber        || 1

  /* This shift's pay — read from the shift report written by endShift(). */
  var money = 0
  try {
    var _rep = JSON.parse(localStorage.getItem('thermalShiftReport') || '{}')
    money = (_rep.shiftPay != null) ? _rep.shiftPay : 400
  } catch(e) { money = 400 }

  /* ── Message sets ─────────────────────────────────────────────── */
  var MESSAGE_SETS = {
    0: [
      'are you there?',
      'Mira slept all night. doctor says good sign.',
      'she asked about you this morning.',
      'when can we talk properly.',
      'how much can you send this week?'
    ],
    1: [
      'hi.',
      'Mira had a hard week. pain came back.',
      'doctor said we might need to increase dose.',
      'i know you\'re doing what you can.',
      'how much this week?'
    ],
    2: [
      'where were you this morning?',
      'i waited at the hospital.',
      'they delayed Mira\'s treatment.',
      'i know things are not in your control.',
      'but you have to do something.',
      'how much can you send?'
    ],
    3: [
      'no answer again.',
      'your daughter can\'t get out of bed.',
      'the medicine is gone.',
      'the hospital is waiting for payment.',
      'i wanted you to know.',
      'how much can you send?'
    ]
  }

  var messages = MESSAGE_SETS[tone]

  /* ── Decision persistence key ─────────────────────────────────── */
  var DECISION_KEY = 'thermalMsgDecision'

  function loadDecision() {
    try {
      var raw = localStorage.getItem(DECISION_KEY)
      if (!raw) return null
      var d = JSON.parse(raw)
      return (d && d.shiftNumber === shiftNum) ? d : null
    } catch (e) { return null }
  }

  function saveDecision(d) {
    try { localStorage.setItem(DECISION_KEY, JSON.stringify(d)) } catch (e) {}
  }

  /* ── Helpers ──────────────────────────────────────────────────── */
  function nowTime() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes()
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m)
  }

  function makeBlock(text, ts) {
    var el = document.createElement('div')
    el.className = 'msg-block'
    el.innerHTML =
      '<div class="msg-sender">ELENA:</div>' +
      '<div class="msg-text">'  + text + '</div>' +
      '<div class="msg-timestamp">' + ts + '</div>'
    return el
  }

  function makeTyping() {
    var el = document.createElement('div')
    el.className = 'typing-indicator'
    el.textContent = 'ELENA is typing...'
    return el
  }

  function scrollBottom() {
    logEl.scrollTop = logEl.scrollHeight
  }

  function setStatus(txt, glow) {
    statusEl.textContent = txt
    statusEl.style.color = glow ? 'var(--phosphor)' : ''
    statusEl.style.textShadow = glow ? '0 0 4px var(--phosphor)' : ''
  }

  /* ── Sequential message playback ──────────────────────────────── */
  function playMessages(msgs, onDone) {
    var i = 0
    function next() {
      if (i >= msgs.length) { if (onDone) onDone(); return }
      var msg = msgs[i++]
      var typingMs = 1500 + Math.floor(Math.random() * 1500)
      var gapMs    = i === 1 ? 1200 : 700

      setTimeout(function() {
        var ind = makeTyping()
        logEl.appendChild(ind)
        scrollBottom()

        setTimeout(function() {
          if (ind.parentNode) ind.parentNode.removeChild(ind)
          var block = makeBlock(msg, nowTime())
          block.style.opacity = '0'
          logEl.appendChild(block)
          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              block.style.transition = 'opacity 0.35s ease'
              block.style.opacity    = '1'
            })
          })
          scrollBottom()
          setTimeout(next, 300)
        }, typingMs)
      }, gapMs)
    }
    next()
  }

  /* ── Instant replay (decision already made) ───────────────────── */
  function replayMessages(existing) {
    var ts = existing.timestamp || nowTime()
    messages.forEach(function(msg) {
      var b = makeBlock(msg, ts)
      b.style.opacity = '1'
      logEl.appendChild(b)
    })
    if (existing.responseMsg) {
      var b2 = makeBlock(existing.responseMsg, ts)
      b2.style.opacity = '1'
      logEl.appendChild(b2)
    }
    endedEl.style.display = ''
    setStatus('OFFLINE', false)
    scrollBottom()
  }

  /* ── Decision buttons ─────────────────────────────────────────── */
  var MONTHLY_NEED = 400
  var _decided     = false

  function showDecision() {
    var enough = money >= MONTHLY_NEED
    decisionRowEl.innerHTML = ''

    var pairs = enough
      ? [['[ SEND ALL ]',            'send_all' ],
         ['[ KEEP SOME FOR SELF ]',  'keep_some']]
      : [['[ SEND WHAT I HAVE ]',    'send_what'],
         ['[ DON\'T SEND THIS WEEK ]', 'no_send' ]]

    pairs.forEach(function(pair) {
      var btn = document.createElement('button')
      btn.className   = 'decision-btn'
      btn.textContent = pair[0]
      btn.setAttribute('data-action', pair[1])
      btn.addEventListener('click', function() {
        if (_decided || btn.disabled) return
        onDecision(pair[1])
      })
      decisionRowEl.appendChild(btn)
    })

    decisionEl.style.display = ''
    scrollBottom()
  }

  /* ── Response messages by action + tone ───────────────────────── */
  function getResponse(action, toneLevel) {
    var warm = toneLevel <= 1
    var MAP = {
      send_all:  [warm ? "thank you. i'll pick up the medicine tomorrow."
                       : "ok. i hope it's enough this time."],
      keep_some: [warm ? "i understand. take care of yourself too."
                       : "i see. she's the sick one, not you."],
      send_what: [warm ? "it will help. thank you."
                       : "i'll try to make it work."],
      no_send:   [warm ? "please. next week then?"
                       : "then what are you doing there."]
    }
    return (MAP[action] || MAP.no_send)[0]
  }

  /* ── Handle decision ──────────────────────────────────────────── */
  function onDecision(action) {
    if (_decided) return
    _decided = true
    _notifyDecision()

    /* Disable buttons */
    decisionRowEl.querySelectorAll('.decision-btn').forEach(function(b) {
      b.disabled = true
      b.classList.toggle('chosen', b.getAttribute('data-action') === action)
    })

    /* Flash chosen button */
    var chosen = decisionRowEl.querySelector('.decision-btn.chosen')
    if (chosen) {
      chosen.classList.add('btn-flash')
      setTimeout(function() { chosen.classList.remove('btn-flash') }, 300)
    }

    /* Calculate sent amount */
    var sent = 0
    if      (action === 'send_all')  sent = money
    else if (action === 'keep_some') sent = Math.floor(money / 2)
    else if (action === 'send_what') sent = money
    else                             sent = 0

    /* Update save — totalMoney already updated by updateShift(); don't touch it here.
       Only record what was sent this shift and update housing/tone. */
    var s = window.saveSystem.loadGame()
    s.lastShiftMoneySent = sent

    /* shiftsWithoutRent:
       KEEP SOME or DON'T SEND → reset (money kept for self)
       SEND ALL or SEND WHAT   → +1  (nothing kept for self) */
    if (action === 'keep_some' || action === 'no_send') {
      s.shiftsWithoutRent = 0
    } else {
      s.shiftsWithoutRent = (s.shiftsWithoutRent || 0) + 1
    }

    /* elenaToneLevel adjustment */
    var goodRad = (s.lastShiftRadiation || 0) < 2.5
    if (!goodRad) {
      s.elenaToneLevel = Math.min(3, (s.elenaToneLevel || 0) + 1)
    } else {
      if      (action === 'send_all' || action === 'send_what')
        s.elenaToneLevel = Math.max(0, (s.elenaToneLevel || 0) - 1)
      else if (action === 'no_send')
        s.elenaToneLevel = Math.min(3, (s.elenaToneLevel || 0) + 1)
      /* keep_some → tone stays */
    }

    window.saveSystem.saveGame(s)

    /* Persist decision for re-read */
    var responseMsg = getResponse(action, tone)
    var ts          = nowTime()
    saveDecision({ shiftNumber: shiftNum, action: action, sent: sent, responseMsg: responseMsg, timestamp: ts })

    /* Hide decision row, show Elena's reply */
    decisionEl.style.display = 'none'
    setTimeout(function() {
      var ind = makeTyping()
      logEl.appendChild(ind)
      scrollBottom()
      var typingMs = 1500 + Math.floor(Math.random() * 500)
      setTimeout(function() {
        if (ind.parentNode) ind.parentNode.removeChild(ind)
        var b = makeBlock(responseMsg, ts)
        b.style.opacity = '0'
        logEl.appendChild(b)
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            b.style.transition = 'opacity 0.35s ease'
            b.style.opacity    = '1'
          })
        })
        scrollBottom()
        setTimeout(function() {
          endedEl.style.display = ''
          setStatus('OFFLINE', false)
          scrollBottom()
        }, 600)
      }, typingMs)
    }, 500)
  }

  function _notifyDecision() {
    try { window.dispatchEvent(new CustomEvent('thermalMsgDecision')) } catch(e) {}
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  var existing = loadDecision()

  if (existing) {
    /* Decision already made this shift — instant replay */
    replayMessages(existing)
    _decided = true
    _notifyDecision()
  } else {
    /* Fresh conversation */
    setStatus('ONLINE', true)
    setTimeout(function() {
      playMessages(messages, function() {
        setTimeout(showDecision, 500)
      })
    }, 2000)
  }

})()
