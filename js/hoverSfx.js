/* ═══════════════════════════════════════════════════════════════════════
   THERMAL — Hover SFX
   A short blip played whenever the cursor enters a clickable element.
   Uses the Web Audio API so no asset files are needed. Lazy-init on the
   first user gesture to satisfy browser autoplay policy.

   Selectors matched (any interactive element is covered):
     button, a, [role="button"], .tab, .dp-btn, .vm-valve, .sv-cell,
     .decision-btn, .action-btn, .sv-mark, .log-row, [data-hover-sfx]

   Sounds can be globally muted by setting window.__hoverSfxMuted = true.
   ═══════════════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict'

  var ctx = null
  var ready = false
  var lastAt = 0

  /* ─── Category mixer ──────────────────────────────────────────────
     Every sound is routed:  source → (category gain) → (master gain) → destination
     Categories:
        master     — overall volume
        ui         — hover blip, click clack, log tick, type tick
        alerts     — warn chirp, alarm klaxon
        ambience   — spark bzzt, TV static, boom
        transition — CRT power-on / power-off
     Volumes persist in localStorage under 'thermalVolumes'. */
  var _gains = null
  var VOLUMES_KEY = 'thermalVolumes'
  var DEFAULT_VOLUMES = {
    master: 1.0, ui: 0.9, alerts: 1.0, ambience: 0.8, transition: 0.9
  }
  function _loadVolumes() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(VOLUMES_KEY)
      if (!raw) return Object.assign({}, DEFAULT_VOLUMES)
      var v = JSON.parse(raw)
      return Object.assign({}, DEFAULT_VOLUMES, v)
    } catch (e) { return Object.assign({}, DEFAULT_VOLUMES) }
  }
  function _saveVolumes(v) {
    try { if (global.localStorage) global.localStorage.setItem(VOLUMES_KEY, JSON.stringify(v)) } catch (e) {}
  }
  var volumes = _loadVolumes()

  function _init() {
    if (ready) return
    try {
      ctx = new (global.AudioContext || global.webkitAudioContext)()
      _gains = {
        master:     ctx.createGain(),
        ui:         ctx.createGain(),
        alerts:     ctx.createGain(),
        ambience:   ctx.createGain(),
        transition: ctx.createGain()
      }
      _gains.master.gain.value     = volumes.master
      _gains.ui.gain.value         = volumes.ui
      _gains.alerts.gain.value     = volumes.alerts
      _gains.ambience.gain.value   = volumes.ambience
      _gains.transition.gain.value = volumes.transition
      /* All category gains feed the master, which hits destination. */
      _gains.ui.connect(_gains.master)
      _gains.alerts.connect(_gains.master)
      _gains.ambience.connect(_gains.master)
      _gains.transition.connect(_gains.master)
      _gains.master.connect(ctx.destination)
      ready = true
    } catch (e) { ready = false }
  }

  /* Helper: every sound calls _out('category') to get its destination
     node instead of connecting to ctx.destination directly. */
  function _out(cat) {
    return (_gains && _gains[cat]) ? _gains[cat] : (ctx ? ctx.destination : null)
  }

  /* Try to bring up the audio context immediately — Electron runs with
     autoplay-policy=no-user-gesture-required so this usually succeeds
     without any gesture. If it doesn't, the fallback listeners below
     will resume it on the very first interaction. */
  function _unlock() {
    _init()
    if (ctx && ctx.state === 'suspended') { try { ctx.resume() } catch(e){} }
  }

  if (global.document && global.document.readyState !== 'loading') {
    _unlock()
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', _unlock, { once: true })
  }
  /* Also re-attempt on window load (handles late-mounting audio engines) */
  global.addEventListener('load', _unlock, { once: true })

  /* Belt-and-suspenders: any real gesture resumes a stuck context. */
  ;['pointerdown', 'pointermove', 'keydown', 'touchstart'].forEach(function(ev) {
    global.addEventListener(ev, _unlock, { once: false, passive: true })
  })

  function _blip() {
    if (!ready || global.__hoverSfxMuted) return
    var now = (ctx.currentTime || 0)
    /* Throttle: no more than ~10 blips/sec total */
    if (now - lastAt < 0.06) return
    lastAt = now
    try {
      /* Hover "tak": short muted sine tap around 360Hz. Higher than the
         click's 205Hz body so the two are clearly distinct, but still
         in the low/mid register — no bright beep. */
      var osc = ctx.createOscillator()
      var g   = ctx.createGain()
      osc.type = 'sine'
      var f = 360 + (Math.random() * 30 - 15)
      osc.frequency.setValueAtTime(f * 1.25, now)
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.012)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.09, now + 0.003)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
      osc.connect(g); g.connect(_out('ui'))
      osc.start(now); osc.stop(now + 0.06)

      /* Tiny low-passed noise tap — adds a subtle "k" transient. */
      var bufLen = Math.floor(ctx.sampleRate * 0.012)
      var buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      var data   = buf.getChannelData(0)
      for (var i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2.4)
      }
      var src = ctx.createBufferSource()
      var lp  = ctx.createBiquadFilter()
      var ng  = ctx.createGain()
      src.buffer = buf
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(900, now)
      ng.gain.setValueAtTime(0.06, now)
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.018)
      src.connect(lp); lp.connect(ng); ng.connect(_out('ui'))
      src.start(now)
    } catch (e) {}
  }

  /* Click confirmation — a "tok", deep and short. Low sine body with a
     low-passed noise thud so it reads as muted percussion, not a beep. */
  function _clack() {
    if (!ready || global.__hoverSfxMuted) return
    _init()
    if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      /* Body: low sine thump with a very brief downward pitch drop. */
      var osc = ctx.createOscillator()
      var g   = ctx.createGain()
      osc.type = 'sine'
      var f = 205 + (Math.random() * 20 - 10)
      osc.frequency.setValueAtTime(f * 1.6, now)
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.012)
      osc.frequency.exponentialRampToValueAtTime(f * 0.8, now + 0.09)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.28, now + 0.003)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
      osc.connect(g); g.connect(_out('ui'))
      osc.start(now); osc.stop(now + 0.13)

      /* Noise "thud" — low-passed burst gives the tok its wood-knock feel. */
      var bufLen = Math.floor(ctx.sampleRate * 0.035)
      var buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      var data   = buf.getChannelData(0)
      for (var i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2)
      }
      var src = ctx.createBufferSource()
      var lp  = ctx.createBiquadFilter()
      var ng  = ctx.createGain()
      src.buffer = buf
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(600, now)
      lp.Q.setValueAtTime(0.9, now)
      ng.gain.setValueAtTime(0.22, now)
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.045)
      src.connect(lp); lp.connect(ng); ng.connect(_out('ui'))
      src.start(now)
    } catch (e) {}
  }

  /* Match any element considered clickable */
  var CLICK_SELECTOR =
    'button, a[href], [role="button"], ' +
    '.tab, .dp-btn, .vm-valve, .sv-cell, .decision-btn, ' +
    '.action-btn, .sv-mark, .log-row, .file-row, ' +
    /* Menu screen */
    '.menu-item, .reset-btn, ' +
    /* Settings panel */
    '.settings-opt, .settings-apply-btn, .settings-close, ' +
    /* Boot / generic overlays */
    '.log-close, .hack-abort, .hack-cell, ' +
    '[data-hover-sfx], [onclick]'

  var DISABLED_CLASSES = [
    'locked', 'disabled', 'cooldown', 'sv4-cooldown',
    'vm-valve-off', 'tab-disabled'
  ]

  function _isDisabled(el) {
    if (!el) return true
    /* Native disabled attribute (button/input/etc.) */
    if (el.disabled === true) return true
    if (el.hasAttribute && el.hasAttribute('disabled')) return true
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true
    /* Disabled-flavour classes on the element itself or an ancestor */
    var node = el
    for (var depth = 0; depth < 4 && node; depth++) {
      if (node.classList) {
        for (var i = 0; i < DISABLED_CLASSES.length; i++) {
          if (node.classList.contains(DISABLED_CLASSES[i])) return true
        }
      }
      node = node.parentElement
    }
    /* Mini-game specific: cells/valves are only clickable while their
       host panel is in the "active" state. */
    if (el.classList) {
      if (el.classList.contains('sv-cell')) {
        var svp = el.closest('#survey-monitor, .sv-panel')
        if (!svp || !svp.classList.contains('sv-active')) return true
      }
      if (el.classList.contains('vm-valve')) {
        var vmp = el.closest('#valve-monitor, .vm-panel, .valve-panel')
        if (!vmp || !vmp.classList.contains('vm-active')) return true
      }
      /* Dispatch choice buttons only work while panel is active */
      if (el.classList.contains('dp-btn')) {
        var dpp = el.closest('#dispatch-monitor, .dp-panel')
        if (dpp && !dpp.classList.contains('dp-active')) return true
      }
    }
    /* Element contains a locked-label indicator (menu-item case) */
    if (el.querySelector && el.querySelector('.locked, .disabled')) return true
    /* Computed pointer-events: none → should not react anyway */
    try {
      var cs = global.getComputedStyle ? global.getComputedStyle(el) : null
      if (cs && cs.pointerEvents === 'none') return true
    } catch (e) {}
    return false
  }

  /* Track the last hit element so moving between child nodes of the
     same clickable doesn't retrigger the blip. A fresh blip only plays
     when we enter a *different* clickable element. */
  var _lastHit = null
  global.addEventListener('pointerover', function(ev) {
    var el = ev.target
    if (!el || !el.closest) return
    var hit = el.closest(CLICK_SELECTOR)
    if (!hit) { _lastHit = null; return }
    if (hit === _lastHit) return
    _lastHit = hit
    if (_isDisabled(hit)) return
    _blip()
  }, { passive: true })
  global.addEventListener('pointerout', function(ev) {
    /* Reset when the pointer leaves the last hit entirely (relatedTarget
       is outside). Prevents the next re-entry from being suppressed. */
    if (!_lastHit) return
    var to = ev.relatedTarget
    if (!to || !_lastHit.contains || !_lastHit.contains(to)) {
      _lastHit = null
    }
  }, { passive: true })

  /* Click confirmation — capture phase so it fires even if a handler
     stops propagation. Uses pointerdown for snappy feedback. */
  global.addEventListener('pointerdown', function(ev) {
    if (ev.button !== undefined && ev.button !== 0) return   // left button only
    var el = ev.target
    if (!el || !el.closest) return
    var hit = el.closest(CLICK_SELECTOR)
    if (!hit) return
    if (_isDisabled(hit)) return
    _clack()
  }, { capture: true, passive: true })

  /* ─── Log tick ─────────────────────────────────────────────────────
     Tiny, short "tick" used when a new line lands in the event log.
     Deliberately quieter and shorter than the hover blip so the log
     feels alive without ever being distracting. */
  var _lastLogAt = 0
  function _logTick() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    if (now - _lastLogAt < 0.04) return
    _lastLogAt = now
    try {
      var osc = ctx.createOscillator()
      var g   = ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(1650, now)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.025, now + 0.002)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.022)
      var hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.setValueAtTime(600, now)
      osc.connect(hp); hp.connect(g); g.connect(_out('ui'))
      osc.start(now); osc.stop(now + 0.03)
    } catch (e) {}
  }

  /* ─── Warning beep ─────────────────────────────────────────────────
     Short, single, mid-amber alert. Used when a system transitions
     from OK → WARN. Clearly audible but brief (~180 ms). */
  function _warning() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      var osc = ctx.createOscillator()
      var g   = ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(720, now)
      osc.frequency.setValueAtTime(540, now + 0.09)    // drop for "chirp" effect
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.01)
      g.gain.setValueAtTime(0.16, now + 0.16)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.19)
      /* Mild band-pass to tame harshness */
      var bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.setValueAtTime(700, now)
      bp.Q.setValueAtTime(1.2, now)
      osc.connect(bp); bp.connect(g); g.connect(_out('alerts'))
      osc.start(now); osc.stop(now + 0.22)
    } catch (e) {}
  }

  /* ─── Alarm klaxon (industrial buzzer) ─────────────────────────────
     Four low-frequency gated pulses — feels like a hardwired fire-
     panel buzzer, not a synth beep. Each pulse is a ~180 Hz square
     cut short with a steep envelope; the gap between pulses is
     silent so the "AHN-AHN-AHN" rhythm comes through. */
  function _alarm() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      var pulseCount = 4
      var pulseLen   = 0.14
      var gapLen     = 0.08
      for (var k = 0; k < pulseCount; k++) {
        var t0  = now + k * (pulseLen + gapLen)
        var osc = ctx.createOscillator()
        var g   = ctx.createGain()
        osc.type = 'square'
        /* Very slight downward drift inside the pulse to avoid a
           sterile sustained tone. */
        osc.frequency.setValueAtTime(185, t0)
        osc.frequency.linearRampToValueAtTime(170, t0 + pulseLen)
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.008)
        g.gain.setValueAtTime(0.22, t0 + pulseLen - 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + pulseLen)
        /* Lowpass tames the square's upper harmonics into a warm
           buzzer body rather than a bright beep. */
        var lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(900, t0)
        lp.Q.setValueAtTime(0.7, t0)
        osc.connect(lp); lp.connect(g); g.connect(_out('alerts'))
        osc.start(t0); osc.stop(t0 + pulseLen + 0.01)

        /* Mechanical clack on each pulse's leading edge — a filtered
           noise transient so the buzzer has a physical body. */
        var clkLen = Math.floor(ctx.sampleRate * 0.015)
        var cbuf   = ctx.createBuffer(1, clkLen, ctx.sampleRate)
        var cdata  = cbuf.getChannelData(0)
        for (var n = 0; n < clkLen; n++) {
          cdata[n] = (Math.random() * 2 - 1) * Math.pow(1 - n / clkLen, 2)
        }
        var csrc = ctx.createBufferSource()
        var cbp  = ctx.createBiquadFilter()
        var cg   = ctx.createGain()
        csrc.buffer = cbuf
        cbp.type = 'bandpass'
        cbp.frequency.setValueAtTime(1600, t0)
        cbp.Q.setValueAtTime(1.4, t0)
        cg.gain.setValueAtTime(0.12, t0)
        cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02)
        csrc.connect(cbp); cbp.connect(cg); cg.connect(_out('alerts'))
        csrc.start(t0)
      }
    } catch (e) {}
  }

  /* ─── Explosion / boom — distant catastrophic thud ─────────────────
     Low thump → metallic clang → long rumble tail. Avoids synth-y
     sweeps; the noise layer is long-tailed and lowpass-swept so it
     reads as "reactor somewhere deep in the building gave out" not
     "game explosion". */
  function _explosion() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      /* 1) Heavy low thump — short sine punch at 70 Hz. */
      var thump = ctx.createOscillator()
      var tg    = ctx.createGain()
      thump.type = 'sine'
      thump.frequency.setValueAtTime(90, now)
      thump.frequency.exponentialRampToValueAtTime(42, now + 0.22)
      tg.gain.setValueAtTime(0.0001, now)
      tg.gain.exponentialRampToValueAtTime(0.7, now + 0.012)
      tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
      thump.connect(tg); tg.connect(_out('ambience'))
      thump.start(now); thump.stop(now + 0.4)

      /* 2) Metallic clang — bandpassed noise burst with mild ring.
         This is the "crack" of metal giving way, not a high hiss. */
      var clangLen = Math.floor(ctx.sampleRate * 0.18)
      var cbuf     = ctx.createBuffer(1, clangLen, ctx.sampleRate)
      var cdata    = cbuf.getChannelData(0)
      for (var i = 0; i < clangLen; i++) {
        cdata[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / clangLen, 1.6)
      }
      var csrc = ctx.createBufferSource()
      var cbp  = ctx.createBiquadFilter()
      var cg   = ctx.createGain()
      csrc.buffer = cbuf
      cbp.type = 'bandpass'
      cbp.frequency.setValueAtTime(1400, now)
      cbp.Q.setValueAtTime(3.5, now)
      cg.gain.setValueAtTime(0.0001, now)
      cg.gain.exponentialRampToValueAtTime(0.28, now + 0.005)
      cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
      csrc.connect(cbp); cbp.connect(cg); cg.connect(_out('ambience'))
      csrc.start(now)

      /* 3) Long rumble tail — slowly-sweeping lowpass on brown-ish
         noise, ~2 s decay. Simulates building-shake reverberation. */
      var rumLen = Math.floor(ctx.sampleRate * 2.0)
      var rbuf   = ctx.createBuffer(1, rumLen, ctx.sampleRate)
      var rdata  = rbuf.getChannelData(0)
      /* Brown-ish noise (integrated white) for a softer low tone. */
      var lastSample = 0
      for (var j = 0; j < rumLen; j++) {
        lastSample = (lastSample + 0.02 * (Math.random() * 2 - 1)) * 0.995
        rdata[j] = lastSample * 6 * Math.pow(1 - j / rumLen, 1.3)
      }
      var rsrc = ctx.createBufferSource()
      var rlp  = ctx.createBiquadFilter()
      var rg   = ctx.createGain()
      rsrc.buffer = rbuf
      rlp.type = 'lowpass'
      rlp.frequency.setValueAtTime(600, now)
      rlp.frequency.exponentialRampToValueAtTime(90, now + 1.8)
      rlp.Q.setValueAtTime(0.8, now)
      rg.gain.setValueAtTime(0.0001, now + 0.04)
      rg.gain.exponentialRampToValueAtTime(0.55, now + 0.15)
      rg.gain.exponentialRampToValueAtTime(0.0001, now + 1.95)
      rsrc.connect(rlp); rlp.connect(rg); rg.connect(_out('ambience'))
      rsrc.start(now)

      /* 4) Secondary thump ~250 ms in — debris/settling. */
      var d = ctx.createOscillator()
      var dg = ctx.createGain()
      d.type = 'sine'
      d.frequency.setValueAtTime(55, now + 0.25)
      d.frequency.exponentialRampToValueAtTime(30, now + 0.6)
      dg.gain.setValueAtTime(0.0001, now + 0.25)
      dg.gain.exponentialRampToValueAtTime(0.25, now + 0.27)
      dg.gain.exponentialRampToValueAtTime(0.0001, now + 0.7)
      d.connect(dg); dg.connect(_out('ambience'))
      d.start(now + 0.25); d.stop(now + 0.75)
    } catch (e) {}
  }

  /* ─── Typewriter tick ──────────────────────────────────────────────
     Per-character sound for the dispatch transcript and the home-
     terminal messaging. Extremely subtle, slight random pitch, and
     throttled so dense runs don't pile up. */
  var _lastTypeAt = 0
  function _typeTick() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    if (now - _lastTypeAt < 0.018) return   // cap ~55 Hz
    _lastTypeAt = now
    try {
      var osc = ctx.createOscillator()
      var g   = ctx.createGain()
      osc.type = 'square'
      /* Small random pitch variation keeps typing organic. */
      var f = 2000 + (Math.random() * 500 - 250)
      osc.frequency.setValueAtTime(f, now)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.018, now + 0.001)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.012)
      var hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.setValueAtTime(1200, now)
      osc.connect(hp); hp.connect(g); g.connect(_out('ui'))
      osc.start(now); osc.stop(now + 0.02)
    } catch (e) {}
  }

  /* ─── Electrical spark / bzzt ─────────────────────────────────────
     A short crackling burst for deterioration "spark waves". Bandpass
     noise with a narrow Q gives the pitched buzz; a tiny sawtooth
     sting adds the electrical snap. Random pitch each call so bursts
     feel spontaneous, not metronomic. */
  function _spark() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      /* Noise burst — the "zzz" body */
      var burstMs = 40 + Math.random() * 40          // 40–80 ms
      var bufLen  = Math.floor(ctx.sampleRate * (burstMs / 1000))
      var buf     = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      var data    = buf.getChannelData(0)
      for (var i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 1.3)
      }
      var src = ctx.createBufferSource()
      var bp  = ctx.createBiquadFilter()
      var g   = ctx.createGain()
      src.buffer = buf
      bp.type = 'bandpass'
      var centre = 2200 + Math.random() * 1500       // 2.2–3.7 kHz
      bp.frequency.setValueAtTime(centre, now)
      bp.Q.setValueAtTime(6, now)                    // narrow → pitched buzz
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.14, now + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, now + burstMs / 1000)
      src.connect(bp); bp.connect(g); g.connect(_out('ambience'))
      src.start(now)

      /* Small sawtooth sting — the snap. */
      var st = ctx.createOscillator()
      var sg = ctx.createGain()
      st.type = 'sawtooth'
      st.frequency.setValueAtTime(centre * 0.55, now)
      st.frequency.exponentialRampToValueAtTime(centre * 0.3, now + 0.03)
      sg.gain.setValueAtTime(0.0001, now)
      sg.gain.exponentialRampToValueAtTime(0.08, now + 0.002)
      sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.035)
      st.connect(sg); sg.connect(_out('ambience'))
      st.start(now); st.stop(now + 0.04)
    } catch (e) {}
  }

  /* ─── CRT power-on ─────────────────────────────────────────────────
     The moment a screen wakes up: brief thud + quick high-whine rising
     then cut, like a tube monitor coming out of standby. */
  function _crtOn() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      /* Sub thump — the degauss kick */
      var th = ctx.createOscillator()
      var tg = ctx.createGain()
      th.type = 'sine'
      th.frequency.setValueAtTime(120, now)
      th.frequency.exponentialRampToValueAtTime(55, now + 0.18)
      tg.gain.setValueAtTime(0.0001, now)
      tg.gain.exponentialRampToValueAtTime(0.35, now + 0.01)
      tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
      th.connect(tg); tg.connect(_out('transition'))
      th.start(now); th.stop(now + 0.25)

      /* High whine ramping up — flyback transformer coming alive */
      var w = ctx.createOscillator()
      var wg = ctx.createGain()
      w.type = 'sine'
      w.frequency.setValueAtTime(5800, now)
      w.frequency.exponentialRampToValueAtTime(12500, now + 0.22)
      wg.gain.setValueAtTime(0.0001, now + 0.02)
      wg.gain.exponentialRampToValueAtTime(0.05, now + 0.1)
      wg.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
      w.connect(wg); wg.connect(_out('transition'))
      w.start(now); w.stop(now + 0.32)

      /* Tiny static puff as signal stabilises */
      var pLen = Math.floor(ctx.sampleRate * 0.08)
      var pbuf = ctx.createBuffer(1, pLen, ctx.sampleRate)
      var pd   = pbuf.getChannelData(0)
      for (var i = 0; i < pLen; i++) {
        pd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / pLen, 1.5)
      }
      var ps = ctx.createBufferSource()
      var pbp = ctx.createBiquadFilter()
      var pg  = ctx.createGain()
      ps.buffer = pbuf
      pbp.type = 'bandpass'
      pbp.frequency.setValueAtTime(3000, now)
      pbp.Q.setValueAtTime(0.7, now)
      pg.gain.setValueAtTime(0.12, now)
      pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
      ps.connect(pbp); pbp.connect(pg); pg.connect(_out('transition'))
      ps.start(now)
    } catch (e) {}
  }

  /* ─── CRT power-off ────────────────────────────────────────────────
     Pop + high-whine dropping to silence, classic tube TV shut-off. */
  function _crtOff() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      /* Pop — very fast low transient */
      var pp = ctx.createOscillator()
      var pg = ctx.createGain()
      pp.type = 'sine'
      pp.frequency.setValueAtTime(260, now)
      pp.frequency.exponentialRampToValueAtTime(60, now + 0.08)
      pg.gain.setValueAtTime(0.0001, now)
      pg.gain.exponentialRampToValueAtTime(0.4, now + 0.005)
      pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
      pp.connect(pg); pg.connect(_out('transition'))
      pp.start(now); pp.stop(now + 0.14)

      /* High whine falling to nothing */
      var w = ctx.createOscillator()
      var wg = ctx.createGain()
      w.type = 'sine'
      w.frequency.setValueAtTime(12500, now)
      w.frequency.exponentialRampToValueAtTime(600, now + 0.38)
      wg.gain.setValueAtTime(0.06, now)
      wg.gain.exponentialRampToValueAtTime(0.0001, now + 0.4)
      w.connect(wg); wg.connect(_out('transition'))
      w.start(now); w.stop(now + 0.42)
    } catch (e) {}
  }

  /* ─── TV static / signal loss ──────────────────────────────────────
     Wide-band noise used while the screen shakes. Short single shot by
     default; pass a duration (sec) for longer bursts. Returns a handle
     { stop() } so callers can cut it early. */
  function _static(durSec) {
    if (!ready || global.__hoverSfxMuted) return { stop: function(){} }
    _init(); if (!ctx) return { stop: function(){} }
    var dur = Math.max(0.08, Math.min(4.0, durSec || 0.45))
    var now = ctx.currentTime || 0
    try {
      var bufLen = Math.floor(ctx.sampleRate * dur)
      var buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      var data   = buf.getChannelData(0)
      /* Pure white noise with slight random envelope ripple so it feels
         like an unstable signal, not a steady hiss. */
      for (var i = 0; i < bufLen; i++) {
        var ripple = 0.85 + 0.15 * Math.sin(i * 0.0007) + (Math.random() * 0.1 - 0.05)
        data[i] = (Math.random() * 2 - 1) * ripple
      }
      var src = ctx.createBufferSource()
      var bp  = ctx.createBiquadFilter()
      var hp  = ctx.createBiquadFilter()
      var g   = ctx.createGain()
      src.buffer = buf
      bp.type = 'bandpass'
      bp.frequency.setValueAtTime(2400, now)
      bp.Q.setValueAtTime(0.35, now)
      hp.type = 'highpass'
      hp.frequency.setValueAtTime(300, now)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.28, now + 0.02)
      g.gain.setValueAtTime(0.28, now + dur - 0.08)
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
      src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(_out('ambience'))
      src.start(now)
      return { stop: function() {
        try {
          g.gain.cancelScheduledValues(ctx.currentTime)
          g.gain.setValueAtTime(g.gain.value, ctx.currentTime)
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08)
          src.stop(ctx.currentTime + 0.1)
        } catch (e) {}
      }}
    } catch (e) { return { stop: function(){} } }
  }

  /* ─── CRT transition auto-hook ─────────────────────────────────────
     Every screen plays a `crtOff` animation when navigating away and a
     `powerOn` animation when arriving. Listen for those starts on the
     .terminal so every screen transition is sonified without each one
     having to call hoverSfx manually. */
  /* powerOn is re-listed whenever another class (e.g. spark-flash)
     adds an extra animation to .terminal, which can retrigger the
     animationstart event. We only want the turn-on sound once per
     page, so guard with _crtOnFired. crtOff has no such risk. */
  var _crtOnFired = false
  function _attachCrtHooks() {
    if (!global.document) return
    global.document.addEventListener('animationstart', function(ev) {
      var name = ev.animationName
      if (!name) return
      if (name === 'crtOff') { _crtOff() }
      else if (name === 'powerOn' && !_crtOnFired) {
        _crtOnFired = true
        _crtOn()
      }
    }, true)
  }
  if (global.document && global.document.readyState !== 'loading') {
    _attachCrtHooks()
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', _attachCrtHooks, { once: true })
  }

  /* ─── Public volume API ────────────────────────────────────────────
     setVolume('master'|'ui'|'alerts'|'ambience'|'transition', 0..1)
     Writes through to the gain node live and persists to localStorage. */
  function _setVolume(cat, val) {
    if (!(cat in DEFAULT_VOLUMES)) return
    var v = Math.max(0, Math.min(1, +val || 0))
    volumes[cat] = v
    if (_gains && _gains[cat]) {
      try { _gains[cat].gain.value = v } catch (e) {}
    }
    _saveVolumes(volumes)
  }
  function _getVolumes() { return Object.assign({}, volumes) }

  /* ─── Sprint G — Pneumatic valve sounds ──────────────────────────
     Three variants for the valve mini-game. Routed to 'ambience'
     so they sit lower than the alerts channel and don't fight
     with klaxons during simultaneous events. */

  /* Short pneumatic hiss + a small mechanical clunk.
     Played when the player opens a correct valve. */
  function _valveOpen() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      /* Hiss — high-pass filtered noise, ~140 ms, slight decay */
      var hMs  = 140
      var hLen = Math.floor(ctx.sampleRate * (hMs / 1000))
      var hBuf = ctx.createBuffer(1, hLen, ctx.sampleRate)
      var hd   = hBuf.getChannelData(0)
      for (var i = 0; i < hLen; i++) {
        hd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / hLen, 0.8)
      }
      var hs = ctx.createBufferSource()
      var hp = ctx.createBiquadFilter()
      var hg = ctx.createGain()
      hs.buffer = hBuf
      hp.type = 'highpass'
      hp.frequency.setValueAtTime(900, now)
      hp.Q.setValueAtTime(0.7, now)
      hg.gain.setValueAtTime(0.0001, now)
      hg.gain.exponentialRampToValueAtTime(0.10, now + 0.012)
      hg.gain.exponentialRampToValueAtTime(0.0001, now + hMs / 1000)
      hs.connect(hp); hp.connect(hg); hg.connect(_out('ambience'))
      hs.start(now)

      /* Mechanical clunk — short sine sweep 200→80 Hz, ~45 ms */
      var co = ctx.createOscillator()
      var cg = ctx.createGain()
      co.type = 'sine'
      co.frequency.setValueAtTime(200, now + 0.04)
      co.frequency.exponentialRampToValueAtTime(80, now + 0.085)
      cg.gain.setValueAtTime(0.0001, now + 0.04)
      cg.gain.exponentialRampToValueAtTime(0.18, now + 0.05)
      cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
      co.connect(cg); cg.connect(_out('ambience'))
      co.start(now + 0.04); co.stop(now + 0.10)
    } catch(e) {}
  }

  /* Sharp short hiss + a low warning thud.
     Played on wrong sequence input — feels like a pressure spike. */
  function _valveError() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      /* Sharp hiss — narrower bandpass, brighter than valveOpen */
      var sMs  = 90
      var sLen = Math.floor(ctx.sampleRate * (sMs / 1000))
      var sBuf = ctx.createBuffer(1, sLen, ctx.sampleRate)
      var sd   = sBuf.getChannelData(0)
      for (var j = 0; j < sLen; j++) {
        sd[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / sLen, 0.5)
      }
      var ss = ctx.createBufferSource()
      var sp = ctx.createBiquadFilter()
      var sg = ctx.createGain()
      ss.buffer = sBuf
      sp.type = 'bandpass'
      sp.frequency.setValueAtTime(1500, now)
      sp.Q.setValueAtTime(2.5, now)
      sg.gain.setValueAtTime(0.0001, now)
      sg.gain.exponentialRampToValueAtTime(0.16, now + 0.006)
      sg.gain.exponentialRampToValueAtTime(0.0001, now + sMs / 1000)
      ss.connect(sp); sp.connect(sg); sg.connect(_out('alerts'))
      ss.start(now)

      /* Low thud — single sine pulse at 70Hz, ~70 ms */
      var to = ctx.createOscillator()
      var tg = ctx.createGain()
      to.type = 'sine'
      to.frequency.setValueAtTime(70, now)
      tg.gain.setValueAtTime(0.0001, now)
      tg.gain.exponentialRampToValueAtTime(0.22, now + 0.012)
      tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
      to.connect(tg); tg.connect(_out('alerts'))
      to.start(now); to.stop(now + 0.09)
    } catch(e) {}
  }

  /* Sustained pneumatic release ~700 ms — pressure dropping after
     the full sequence completes. Lowpass sweeps down to feel like
     air bleeding out. Played on _vmSuccess. */
  function _valveRelease() {
    if (!ready || global.__hoverSfxMuted) return
    _init(); if (!ctx) return
    var now = ctx.currentTime || 0
    try {
      var rMs  = 700
      var rLen = Math.floor(ctx.sampleRate * (rMs / 1000))
      var rBuf = ctx.createBuffer(1, rLen, ctx.sampleRate)
      var rd   = rBuf.getChannelData(0)
      for (var k = 0; k < rLen; k++) {
        rd[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / rLen, 1.6)
      }
      var rs = ctx.createBufferSource()
      var rl = ctx.createBiquadFilter()
      var rg = ctx.createGain()
      rs.buffer = rBuf
      rl.type = 'lowpass'
      rl.frequency.setValueAtTime(3500, now)
      rl.frequency.exponentialRampToValueAtTime(400, now + 0.6)
      rl.Q.setValueAtTime(0.4, now)
      rg.gain.setValueAtTime(0.0001, now)
      rg.gain.exponentialRampToValueAtTime(0.14, now + 0.03)
      rg.gain.exponentialRampToValueAtTime(0.0001, now + rMs / 1000)
      rs.connect(rl); rl.connect(rg); rg.connect(_out('ambience'))
      rs.start(now)

      /* Sub-bass undertone for body */
      var bo = ctx.createOscillator()
      var bg = ctx.createGain()
      bo.type = 'sine'
      bo.frequency.setValueAtTime(110, now)
      bo.frequency.exponentialRampToValueAtTime(50, now + 0.55)
      bg.gain.setValueAtTime(0.0001, now + 0.02)
      bg.gain.exponentialRampToValueAtTime(0.10, now + 0.06)
      bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
      bo.connect(bg); bg.connect(_out('ambience'))
      bo.start(now + 0.02); bo.stop(now + 0.65)
    } catch(e) {}
  }

  /* Expose for anything that wants to trigger it manually */
  global.hoverSfx = {
    play:   _blip,
    click:  _clack,
    log:    _logTick,
    warn:   _warning,
    alarm:  _alarm,
    boom:   _explosion,
    type:   _typeTick,
    spark:  _spark,
    crtOn:  _crtOn,
    crtOff: _crtOff,
    static: _static,
    /* Sprint G */
    valveOpen:    _valveOpen,
    valveError:   _valveError,
    valveRelease: _valveRelease,
    setVolume:  _setVolume,
    getVolumes: _getVolumes,
    mute:   function(v){ global.__hoverSfxMuted = !!v },
  }
})(typeof window !== 'undefined' ? window : this)
