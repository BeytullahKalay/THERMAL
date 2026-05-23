/* ═══════════════════════════════════════════════════════════════════
   THERMAL — error-system.js
   Cryptic error-code mechanic ("ER-3505" etc).

   Player must satisfy ALL FOUR conditions simultaneously to clear an
   active error:
     1. POWER resource at exact value
     2. PRESSURE resource at exact value
     3. Valve clicks performed in correct sequence (wrong = restart)
     4. SURVEY cell clicks performed in correct sequence (wrong = restart)

   The MANUAL tab shows a prescription that is sometimes wrong (~30%).
   When wrong, the truth lives in a previous-operator log unlockable via
   the home-terminal hack mini-game.

   While an error is active:
     • No new mini-games (anomaly/valve/CRM/dispatch) spawn
     • SURVEY grid cells become free combo-input pads (all 40 clickable)
     • Linear-interp deterioration boost worsens parameters
     • Wrong inputs trigger screen shake

   Public API:
     window.errorSystem.fire(codeId)  — start an ER (F1 / scheduler)
     window.errorSystem.cancel()      — abort current ER (debug)
     window.errorSystem.isActive()    — bool
     window.errorSystem.getCurrent()  — { code, valveProgress, surveyProgress }
     window.errorSystem.getDeterMult()— 1.0 normally, boosted while active
     window.errorSystem.getCodes()    — list of all loaded codes

   Depends on:
     • window.ER_CODES populated by game.html before this script loads
     • window.gameState exposed by game.js (resources object)
     • Existing DOM: .vm-valve elements, .sv-cell elements, .terminal,
       #er-overlay container
   ═══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  /* ── Config + state ──────────────────────────────────────────── */
  var CONFIG = (window.ER_CODES && typeof window.ER_CODES === 'object')
    ? window.ER_CODES : { codes: [], deteriorationBoost: 1.8, shakeIntensityPx: 6 }
  var CODES = CONFIG.codes || []
  var DETER_BOOST = CONFIG.deteriorationBoost || 1.8

  var _state = {
    active:          false,
    code:            null,    // current code object
    valveProgress:   0,       // index of next valve expected
    surveyProgress:  0,       // index of next survey cell expected
    firedAt:         0        // Date.now() when fire() — used for quick-fix bonus
  }

  /* ── DOM refs (resolved lazily because game.html may not be parsed yet) */
  function _q(id)  { return document.getElementById(id) }
  function _qs(s)  { return document.querySelector(s) }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _log(msg, cls) {
    /* Prefer game.js's addLog if exposed, else console fallback */
    if (typeof window.addLog === 'function') {
      window.addLog(msg, cls || 'system')
    } else {
      console.log('[ER] ' + msg)
    }
  }

  function _findCode(id) {
    for (var i = 0; i < CODES.length; i++) {
      if (CODES[i].id === id) return CODES[i]
    }
    return null
  }

  function _eligibleCodes(shiftNo) {
    /* Filter by minShift — tier 2 codes lock until later shifts. */
    var sn = shiftNo || 1
    return CODES.filter(function (c) {
      var ms = c.minShift || 1
      return sn >= ms
    })
  }
  function _randomCode(shiftNo) {
    var pool = _eligibleCodes(shiftNo)
    if (pool.length === 0) return CODES.length ? CODES[0] : null
    return pool[Math.floor(Math.random() * pool.length)]
  }

  /* ── Screen shake on wrong input ─────────────────────────────── */
  function _shakeTerminal() {
    var t = _qs('.terminal')
    if (!t) return
    t.classList.remove('er-shake')
    /* force reflow so re-add restarts the animation */
    void t.offsetWidth
    t.classList.add('er-shake')
    setTimeout(function () { t.classList.remove('er-shake') }, 350)
  }

  /* ── Overlay rendering ──────────────────────────────────────────
     Split into two phases so the static DOM (panel, header, code,
     minimize button, badge) is created ONCE per ER fire and never
     replaced. The 250ms tick polling only mutates the volatile
     fields (current power/pressure, ✓/✗ icons, progress sequences,
     cond-ok class flags). This keeps:
       • erPanelIn fade animation from re-triggering every tick
       • the minimize button stable so its mouseenter doesn't re-fire
       • clicks reliably reaching the button regardless of opacity */

  /* Minimal overlay — ONLY the error code is shown on the panel.
     The actual fix prescription lives in the MANUAL overlay (press H).
     The player must look it up themselves; this is by design — the
     manual is sometimes wrong, and the only way to learn that is to
     have the procedure live in a separate document. */
  function _buildOverlay() {
    var ov = _q('er-overlay')
    if (!ov || !_state.code) return
    var c = _state.code

    var manualKey = (window.keybinds ? window.keybinds.label('manual') : 'H')
    var miniKey   = (window.keybinds ? window.keybinds.label('erMini') : 'M')

    ov.innerHTML =
      '<div class="er-badge" id="er-badge">' +
        '<div class="er-badge-tag">// SYSTEM ERROR</div>' +
        '<div class="er-badge-code">' + c.id + '</div>' +
        '<div class="er-badge-hint">CLICK TO EXPAND</div>' +
      '</div>' +
      '<div class="er-panel er-panel-minimal">' +
        '<button class="er-min-btn" id="er-min-btn" title="Minimize (' + miniKey + ')">_</button>' +
        '<div class="er-tag">// SYSTEM ERROR</div>' +
        '<div class="er-code" id="er-code-display">' + c.id + '</div>' +
        '<div class="er-hint">// CONSULT MANUAL — PRESS [' + manualKey + ']</div>' +
      '</div>'
  }

  /* Sprint H.2 — Click-lock feedback. Fire a snap sound + brief
     badge pulse whenever a condition newly meets (false→true).
     Reads as "a piece of the puzzle locked in" — every time the
     player matches one of the 4 sub-conditions, the system
     acknowledges it. The 4th lock automatically rolls into the
     FIXED handler below. */
  function _condSnap() {
    if (window.hoverSfx && typeof window.hoverSfx.valveOpen === 'function') {
      try { window.hoverSfx.valveOpen() } catch(e){}
    }
    try {
      var els = [_q('er-code-display'), document.querySelector('#er-badge .er-badge-code')]
      els.forEach(function(el) {
        if (!el) return
        el.classList.remove('er-cond-met')
        void el.offsetWidth
        el.classList.add('er-cond-met')
        setTimeout(function(){ el.classList.remove('er-cond-met') }, 380)
      })
    } catch(e){}
  }

  /* Tick re-evaluator. Detects per-condition transitions for
     click-lock feedback and the all-conditions-met → FIXED trigger. */
  function _renderOverlay() {
    if (!_state.code) return
    var c = _state.code
    var pwr = _readPower()
    var prs = _readPressure()
    var pwrOk = (pwr === c.truePrescription.power)
    var prsOk = (prs === c.truePrescription.pressure)
    var vlvOk = (_state.valveProgress >= c.truePrescription.valveSeq.length)
    var srvOk = (_state.surveyProgress >= c.truePrescription.soundSeq.length)

    /* H.2 — snap on rising edge per condition. _state.condFlags is
       (re)initialised on each fire() so transitions are detected
       cleanly within the run of one ER. */
    if (!_state.condFlags) _state.condFlags = { pwr:false, prs:false, vlv:false, srv:false }
    if (pwrOk && !_state.condFlags.pwr) _condSnap()
    if (prsOk && !_state.condFlags.prs) _condSnap()
    if (vlvOk && !_state.condFlags.vlv) _condSnap()
    if (srvOk && !_state.condFlags.srv) _condSnap()
    _state.condFlags = { pwr:pwrOk, prs:prsOk, vlv:vlvOk, srv:srvOk }

    if (pwrOk && prsOk && vlvOk && srvOk) _markFixed()
  }

  function _renderFixedBanner() {
    var ov = _q('er-overlay')
    if (!ov) return
    /* Replace overlay content with a triumphant FIXED card */
    ov.innerHTML =
      '<div class="er-panel er-fixed">' +
        '<div class="er-fixed-tag">// RESOLVED</div>' +
        '<div class="er-fixed-code">' + _state.code.id + '</div>' +
        '<div class="er-fixed-label">— FIXED —</div>' +
      '</div>'
  }

  /* ── State reads — values from game.js gameState, fallback safe ── */
  function _readPower()    { return (window.gameState && window.gameState.resources) ? (window.gameState.resources.guc    || 0) : 0 }
  function _readPressure() { return (window.gameState && window.gameState.resources) ? (window.gameState.resources.basinc || 0) : 0 }

  /* ── Combo detector — re-evaluates each input event + on a tick ── */
  var _tick = null
  function _startTickPolling() {
    if (_tick) return
    _tick = setInterval(function () {
      if (!_state.active) return
      _renderOverlay()  /* re-render handles the FIXED check too */
    }, 250)
  }
  function _stopTickPolling() {
    if (_tick) { clearInterval(_tick); _tick = null }
  }

  /* ── Random alpha flicker — fires twice in quick succession every
        2-5 seconds while ER is active. Reads as a CRT trying and
        failing to refresh the panel. Toggles `.er-flicker` on
        every panel + badge element via the overlay class. ─────── */
  var _flickerTimer = null
  function _flickerOnce(cb) {
    var ov = _q('er-overlay')
    if (!ov || !_state.active) { if (cb) cb(); return }
    var els = ov.querySelectorAll('.er-panel, .er-panel-minimal, .er-badge')
    els.forEach(function (e) { e.classList.add('er-flicker') })
    setTimeout(function () {
      els.forEach(function (e) { e.classList.remove('er-flicker') })
      if (cb) cb()
    }, 100)
  }
  function _scheduleFlicker() {
    if (_flickerTimer) { clearTimeout(_flickerTimer); _flickerTimer = null }
    if (!_state.active) return
    var delay = 2000 + Math.random() * 3000   // 2-5 s
    _flickerTimer = setTimeout(function () {
      if (!_state.active) return
      /* Burst: flicker → 100ms recover → flicker → 100ms recover →
         schedule next random window. */
      _flickerOnce(function () {
        setTimeout(function () {
          _flickerOnce(function () {
            _scheduleFlicker()
          })
        }, 100)
      })
    }, delay)
  }
  function _stopFlicker() {
    if (_flickerTimer) { clearTimeout(_flickerTimer); _flickerTimer = null }
    var ov = _q('er-overlay')
    if (ov) ov.querySelectorAll('.er-flicker').forEach(function (e) { e.classList.remove('er-flicker') })
  }

  /* ── Alarm re-issue while ER unresolved — escalates urgency. ──
        Plays the alarm every 60s the player remains in violation.
        After 3 escalations, also adds a log entry signaling the
        approaching deterioration cliff. */
  var _alarmTimer = null
  var _alarmCount = 0
  function _startAlarmEscalation() {
    if (_alarmTimer) return
    _alarmCount = 0
    _alarmTimer = setInterval(function () {
      if (!_state.active) return
      _alarmCount++
      if (window.hoverSfx && window.hoverSfx.alarm) window.hoverSfx.alarm()
      if (_alarmCount === 3) {
        _log('// REPEATED ALARM — operator response window critical.', 'anomaly')
      }
    }, 60000)
  }
  function _stopAlarmEscalation() {
    if (_alarmTimer) { clearInterval(_alarmTimer); _alarmTimer = null }
    _alarmCount = 0
  }

  /* Brief per-element flash (green = correct, red = wrong) */
  function _flashEl(el, ok) {
    if (!el) return
    var cls = ok ? 'er-valve-ok' : 'er-valve-bad'
    if (el.classList.contains('sv-cell')) cls = ok ? 'er-cell-ok' : 'er-cell-bad'
    el.classList.remove('er-valve-ok','er-valve-bad','er-cell-ok','er-cell-bad')
    void el.offsetWidth
    el.classList.add(cls)
    setTimeout(function () { el.classList.remove(cls) }, 480)
  }

  /* Pulse the minimized badge so player sees progress even when collapsed */
  function _pulseBadge() {
    var b = _q('er-badge')
    if (!b) return
    b.classList.remove('er-badge-progress')
    void b.offsetWidth
    b.classList.add('er-badge-progress')
    setTimeout(function () { b.classList.remove('er-badge-progress') }, 520)
  }

  /* ── Valve click handler (delegated, only active during ER) ────── */
  function _onValveClick(ev) {
    if (!_state.active || !_state.code) return
    var el = ev.target.closest && ev.target.closest('.vm-valve')
    if (!el) return
    /* Stop default behaviour so the normal valve mini-game doesn't react */
    ev.stopPropagation()
    ev.preventDefault()
    var vNum = el.getAttribute('data-valve')
    if (!vNum) return
    var expected = _state.code.truePrescription.valveSeq[_state.valveProgress]
    /* Accept either "V3" or "3" form in JSON */
    var expNum = ('' + expected).replace(/^V/i, '')
    if (('' + vNum) === expNum) {
      _state.valveProgress++
      _flashEl(el, true)
      _pulseBadge()
      if (window.hoverSfx && window.hoverSfx.click) window.hoverSfx.click()
    } else {
      /* Wrong: reset valve sequence and shake */
      if (_state.valveProgress > 0) {
        _state.valveProgress = 0
        _log('// ER ' + _state.code.id + ' — valve sequence broken, restart from V' + ('' + _state.code.truePrescription.valveSeq[0]).replace(/^V/i, ''), 'warning')
      }
      _flashEl(el, false)
      _shakeTerminal()
    }
    _renderOverlay()
  }

  /* ── Survey cell click handler (delegated) ───────────────────── */
  function _onSurveyClick(ev) {
    if (!_state.active || !_state.code) return
    var el = ev.target.closest && ev.target.closest('.sv-cell')
    if (!el) return
    /* During ER, hijack the click — the normal survey logic should be
       gated off because the survey mini-game can't spawn while ER is
       active. We still preventDefault to be safe. */
    ev.stopPropagation()
    var label = el.textContent.trim()
    var expected = _state.code.truePrescription.soundSeq[_state.surveyProgress]
    if (label === expected) {
      _state.surveyProgress++
      _flashEl(el, true)
      _pulseBadge()
      if (window.hoverSfx && window.hoverSfx.click) window.hoverSfx.click()
    } else {
      if (_state.surveyProgress > 0) {
        _state.surveyProgress = 0
        _log('// ER ' + _state.code.id + ' — survey sequence broken, restart from ' + _state.code.truePrescription.soundSeq[0], 'warning')
      }
      _flashEl(el, false)
      _shakeTerminal()
    }
    _renderOverlay()
  }

  /* ── Mark fixed → close overlay after a short triumph beat ────── */
  var _fixing = false
  function _markFixed() {
    if (_fixing) return
    _fixing = true
    var fixedCode = _state.code.id
    /* Quick-fix money bonus — rewards speed. Tracked on gameState so
       endShift's report can fold it into shiftPay. <30s = +$5,
       <60s = +$2, slower = $0. */
    var elapsedMs = Date.now() - (_state.firedAt || Date.now())
    var bonus = 0
    if      (elapsedMs <  30000) bonus = 5
    else if (elapsedMs <  60000) bonus = 2
    if (bonus > 0 && window.gameState) {
      window.gameState.erBonusTotal = (window.gameState.erBonusTotal || 0) + bonus
      _log('// ER ' + fixedCode + ' — FIXED in ' + (elapsedMs/1000).toFixed(1) + 's. +$' + bonus + ' efficiency bonus.', 'normal')
    } else {
      _log('// ER ' + fixedCode + ' — FIXED. Resources held at recovery values; rebalance manually.', 'normal')
    }
    /* Achievement: ELEVEN SECONDS — ER resolved in <11 s. */
    if (elapsedMs < 11000 && window.achievements) {
      try { window.achievements.unlock('ACH_ELEVEN_SECONDS') } catch (e) {}
    }
    if (window.gameState) {
      window.gameState.ersResolved = (window.gameState.ersResolved || 0) + 1
    }
    _renderFixedBanner()
    /* H.3 — sustained pneumatic release (weightier than the old
       single blip). Also adds a one-shot screen settle pulse so the
       moment lands rather than just text-swapping. */
    if (window.hoverSfx && typeof window.hoverSfx.valveRelease === 'function') {
      try { window.hoverSfx.valveRelease() } catch(e){}
    } else if (window.hoverSfx && window.hoverSfx.play) {
      window.hoverSfx.play()
    }
    try {
      var term = document.querySelector('.terminal')
      if (term) {
        term.classList.remove('er-settle')
        void term.offsetWidth
        term.classList.add('er-settle')
        setTimeout(function(){ term.classList.remove('er-settle') }, 900)
      }
    } catch(e){}
    setTimeout(function () {
      _state.active = false
      _state.code   = null
      _state.valveProgress = 0
      _state.surveyProgress = 0
      _fixing = false
      _stopTickPolling()
      _stopFlicker()
      _stopAlarmEscalation()
      var ov = _q('er-overlay')
      if (ov) { ov.classList.remove('er-open','er-mini'); ov.style.display = 'none' }
      var sv = _q('survey-monitor')
      if (sv) sv.classList.remove('sv-er-input')
      var t = _qs('.terminal')
      if (t) t.classList.remove('er-degrading')
      document.body.classList.remove('er-active')
      /* Remove the affected gauge ring (any sys — wildcard cleanup) */
      ;['sicaklik','basinc','guc'].forEach(function (s) {
        var b = _q('gauge-block-' + s)
        if (b) b.classList.remove('er-affected')
      })
    }, 1400)
  }

  /* ── Public: fire a specific code (or random if id omitted) ────── */
  function fire(codeId) {
    if (_state.active) {
      _log('// ER ignored — another error is already active.', 'warning')
      return false
    }
    if (CODES.length === 0) {
      console.warn('[ER] no codes loaded')
      return false
    }
    var code = codeId ? _findCode(codeId) : _randomCode(_shiftNo)
    if (!code) {
      console.warn('[ER] code not found: ' + codeId)
      return false
    }
    _state.active = true
    _state.code   = code
    _state.valveProgress  = 0
    _state.surveyProgress = 0
    _state.condFlags = null   // H.2 — reset per-condition tracker
    _state.firedAt = Date.now()
    /* Mark body so CSS can force valves + survey cells fully clickable
     even though their host mini-games are idle. */
    document.body.classList.add('er-active')
    /* Highlight the gauge block matching the code's systemTag so the
       player can immediately see WHICH subsystem is in trouble. */
    if (code.systemTag) {
      var aff = _q('gauge-block-' + code.systemTag)
      if (aff) aff.classList.add('er-affected')
    }
    /* Visual gating: highlight survey cells as combo-input mode */
    var sv = _q('survey-monitor')
    if (sv) sv.classList.add('sv-er-input')
    /* Visual: deterioration cue on terminal */
    var t = _qs('.terminal')
    if (t) t.classList.add('er-degrading')
    /* Show overlay */
    var ov = _q('er-overlay')
    if (ov) { ov.style.display = 'flex'; ov.classList.add('er-open'); ov.classList.remove('er-mini') }
    /* Build the static DOM ONCE per fire (panel/badge/buttons stay
       stable across ticks so erPanelIn doesn't re-trigger and the
       minimize button doesn't re-fire its mouseenter). The 250ms
       tick only mutates volatile fields. */
    _buildOverlay()
    _renderOverlay()
    _startTickPolling()
    _scheduleFlicker()
    _startAlarmEscalation()
    /* Alarm = the 4-pulse "AHN-AHN-AHN" buzzer — characteristic enough
       that the player learns ER vs other warnings by ear alone. */
    if (window.hoverSfx && window.hoverSfx.alarm) window.hoverSfx.alarm()
    _log('// SYSTEM ERROR ' + code.id + ' — ' + (code.title || ''), 'anomaly')
    return true
  }

  function cancel() {
    if (!_state.active) return
    _state.active = false
    _state.code = null
    _state.valveProgress = 0
    _state.surveyProgress = 0
    _fixing = false
    _stopTickPolling()
    var ov = _q('er-overlay')
    if (ov) { ov.classList.remove('er-open'); ov.style.display = 'none' }
    var sv = _q('survey-monitor')
    if (sv) sv.classList.remove('sv-er-input')
    var t = _qs('.terminal')
    if (t) t.classList.remove('er-degrading')
  }

  /* ── Minimize / expand ───────────────────────────────────────── */
  function minimize() {
    var ov = _q('er-overlay')
    if (ov) ov.classList.add('er-mini')
  }
  function expand() {
    var ov = _q('er-overlay')
    if (ov) ov.classList.remove('er-mini')
  }
  function toggleMini() {
    if (!_state.active) return
    var ov = _q('er-overlay')
    if (!ov) return
    ov.classList.toggle('er-mini')
  }

  /* Click handlers for minimize button + badge expand. Delegated so
     they survive every _renderOverlay() innerHTML rebuild. */
  document.addEventListener('click', function (ev) {
    if (!_state.active) return
    var min = ev.target.closest && ev.target.closest('#er-min-btn')
    if (min) {
      ev.stopPropagation(); ev.preventDefault()
      minimize()
      return
    }
    var bdg = ev.target.closest && ev.target.closest('.er-badge')
    if (bdg) {
      ev.stopPropagation(); ev.preventDefault()
      expand()
    }
  }, true)

  /* Minimize hotkey (default M, rebindable). Skip if user typing in
     a form field (defensive). */
  document.addEventListener('keydown', function (ev) {
    if (!_state.active) return
    var tag = (ev.target && ev.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    var hit = window.keybinds
      ? window.keybinds.matches(ev, 'erMini')
      : (ev.key === 'm' || ev.key === 'M')
    if (hit) toggleMini()
  })

  /* ── Auto-spawn scheduler ────────────────────────────────────────
     A simple chain: schedule a fire after firstMs+rand on shift start,
     then after each FIXED/cancelled ER schedule the next at
     respawnMs+rand. Skips silently if a mini-game is mid-flight or
     game state has ended; the timeout uses the monkey-patched
     setTimeout so it's automatically pause-aware. */
  var SCHED = (window.ER_CODES && window.ER_CODES.schedule) ? window.ER_CODES.schedule : {}
  var _firstMs   = SCHED.firstMs    || 180000
  var _firstRnd  = SCHED.firstRnd   || 120000
  var _respawnMs = SCHED.respawnMs  || 240000
  var _respawnRnd= SCHED.respawnRnd || 180000
  var _shiftScale= SCHED.shiftScale || 1
  /* Cascade — from shift cascadeShift+, next ER fires almost
     immediately (cascadeMs + random(cascadeRnd)) after resolution. */
  var _cascadeShift = SCHED.cascadeShift || 999   // never if absent
  var _cascadeMs    = SCHED.cascadeMs    || 500
  var _cascadeRnd   = SCHED.cascadeRnd   || 2500
  var _schedTimer = null
  var _schedRunning = false
  var _shiftNo    = 1
  var _justResolved = false   // set in _markFixed wrapper, used by _scheduleNext

  function _isShiftBlocked() {
    /* Game over / shift over → don't fire. We can't reach gameState
       from here cleanly, but if the game-clock interval has been
       cleared the shift is over; check via systemFailure instead. */
    if (window.gameState && (window.gameState.systemFailure || window.gameState.meltdownOccurred)) return true
    /* Don't pile ER on top of mini-games — give the player breathing
       room. Re-poll in a few seconds. */
    if (typeof window._isMiniGameActive === 'function' && window._isMiniGameActive()) return true
    return false
  }

  function _scheduleNext(initial) {
    if (!_schedRunning) return
    if (_schedTimer) { clearTimeout(_schedTimer); _schedTimer = null }
    var base, rnd, scale, delay
    if (!initial && _justResolved && _shiftNo >= _cascadeShift) {
      /* CASCADE — late-shift back-to-back. No shiftScale on cascade
         (it's already brutal). Notify the player so the design intent
         lands rather than feeling like a bug. */
      base = _cascadeMs
      rnd  = _cascadeRnd
      delay = base + Math.random() * rnd
      _log('// CASCADE — secondary fault detected, system response window narrowing.', 'warning')
    } else {
      base = initial ? _firstMs   : _respawnMs
      rnd  = initial ? _firstRnd  : _respawnRnd
      scale = Math.pow(_shiftScale, Math.max(0, _shiftNo - 1))
      delay = (base + Math.random() * rnd) * scale
    }
    _justResolved = false
    /* Speed-scaled — at 4× game speed ERs arrive 4× sooner in real
       time so the player actually feels the difference. */
    var realDelay = (typeof window.__spawnMs === 'function')
      ? window.__spawnMs(Math.floor(delay))
      : Math.floor(delay)
    _schedTimer = setTimeout(function () {
      _schedTimer = null
      if (!_schedRunning) return
      if (_isShiftBlocked() || _state.active) {
        _scheduleNext(false)
        return
      }
      var ok = fire()  // random code
      if (!ok) _scheduleNext(false)
    }, realDelay)
  }

  function startScheduler(shiftNumber) {
    if (typeof shiftNumber === 'number') _shiftNo = shiftNumber
    _schedRunning = true
    _scheduleNext(true)
  }

  function stopScheduler() {
    _schedRunning = false
    if (_schedTimer) { clearTimeout(_schedTimer); _schedTimer = null }
  }

  /* Soft pause — keep _schedRunning true but cancel the in-flight
     timer so no ER fires until resumeScheduler() schedules the next
     one. Used by dispatch take-over so an ER can't surprise-spawn
     in the moments after _endDispatch and trap the player at 06:00. */
  function pauseScheduler() {
    if (_schedTimer) { clearTimeout(_schedTimer); _schedTimer = null }
  }
  function resumeScheduler() {
    if (!_schedRunning) return
    if (_schedTimer) return
    _scheduleNext(false)
  }

  /* When an ER closes (FIXED or cancelled) the scheduler queues the
     next one — wired by patching _markFixed / cancel via wrappers. */
  var _origMarkFixed = _markFixed
  _markFixed = function () {
    _origMarkFixed.apply(this, arguments)
    if (_schedRunning) {
      _justResolved = true
      setTimeout(function(){ _scheduleNext(false) }, 1500)
    }
  }
  var _origCancel = cancel
  cancel = function () {
    _origCancel.apply(this, arguments)
    if (_schedRunning) _scheduleNext(false)
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.errorSystem = {
    fire:           fire,
    cancel:         cancel,
    minimize:       minimize,
    expand:         expand,
    toggleMini:     toggleMini,
    startScheduler: startScheduler,
    stopScheduler:  stopScheduler,
    pauseScheduler: pauseScheduler,
    resumeScheduler:resumeScheduler,
    isActive:       function () { return _state.active },
    /* Sprint H.4 — public read of the active code object so
       manual-overlay.toggle() can auto-jump to it. */
    activeCode:     function () { return _state.active ? _state.code : null },
    getCurrent:     function () { return _state.active ? {
                       code:           _state.code,
                       valveProgress:  _state.valveProgress,
                       surveyProgress: _state.surveyProgress
                    } : null },
    getDeterMult:   function () { return _state.active ? DETER_BOOST : 1 },
    getCodes:       function () { return CODES.slice() }
  }

  /* ── Wire global click delegation (capture phase to beat normal handlers) */
  document.addEventListener('click',     _onValveClick,  true)
  document.addEventListener('click',     _onSurveyClick, true)

  /* ── Bootstrap diagnostic — confirm load + code count ─────────── */
  console.log('[errorSystem] loaded — ' + CODES.length + ' codes available')

})()
