/* ═══════════════════════════════════════════════════════════════════
   THERMAL — game.js
   Full game loop: sensors, resource system, game clock, log system,
   anomaly system, CRM frequency monitor, valve mini-game, debug
   panel, and shift-end handler.
   Depends on: saveSystem.js (loaded before this file)
   ═══════════════════════════════════════════════════════════════════ */
  /* ─── Demo build detection. The Steam demo (and Next Fest entry)
        ships as a separate package with `?demo=1` baked into the
        boot URL via a build-time HTML rewrite. Demo behaviour:
          • Shift 1 only — at endShift, route to demo-end cliffhanger
          • All other systems unchanged so the demo plays exactly
            like the real game for its duration.
        Detection: URL query first, env var second (electron-builder
        can inject via `window.__DEMO__`). */
  var _demoMode = false
  try {
    var dq = (typeof location !== 'undefined') ? (location.search || '') : ''
    _demoMode = /[?&]demo=1\b/.test(dq) || !!window.__DEMO__
  } catch (e) {}
  window.__demoMode = _demoMode
  if (_demoMode) console.log('[demo] demo build detected — shift 1 will end with cliffhanger')

  function _injectDemoBadge() {
    if (!_demoMode) return
    if (document.getElementById('demo-badge')) return
    var b = document.createElement('div')
    b.id = 'demo-badge'
    b.textContent = '// DEMO BUILD'
    b.style.cssText =
      'position:fixed;top:6px;left:8px;z-index:9998;' +
      'font-family:"Share Tech Mono",monospace;font-size:10px;' +
      'letter-spacing:3px;color:#ffb830;background:rgba(10,16,4,0.85);' +
      'border:1px solid #ffb830;padding:2px 8px;text-shadow:0 0 4px rgba(255,184,48,0.5);'
    document.body.appendChild(b)
  }
  if (_demoMode) {
    if (document.body) _injectDemoBadge()
    else document.addEventListener('DOMContentLoaded', _injectDemoBadge)
  }

  /* ─── Training mode badge injector — runs after DOM ready */
  function _injectTrainingBadge() {
    if (!_trainingMode) return
    if (document.getElementById('training-badge')) return
    var b = document.createElement('div')
    b.id = 'training-badge'
    b.textContent = '// TRAINING SIMULATION — NO CONSEQUENCES'
    b.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
      'z-index:9998;font-family:"Share Tech Mono",monospace;font-size:11px;' +
      'letter-spacing:4px;color:#ffb830;background:rgba(10,16,4,0.92);' +
      'border:1px solid #ffb830;padding:4px 16px;text-shadow:0 0 6px rgba(255,184,48,0.5);'
    document.body.appendChild(b)
  }
  /* ─── Training mode detection — `?training=1` query at boot.
     In training mode the player can practice ERs and mini-games
     without consequences: nothing writes to save, end-shift returns
     to menu, meltdown is non-fatal. */
  var _trainingMode = false
  try {
    var qs = (typeof location !== 'undefined') ? (location.search || '') : ''
    _trainingMode = /[?&]training=1\b/.test(qs)
  } catch (e) {}
  window._trainingMode = _trainingMode

  /* ─── Save system — load current run state once at boot ──────── */
  var _save = window.saveSystem.loadGame()
  if (_trainingMode) {
    /* Use a fresh in-memory save snapshot so nothing dirties the real one */
    _save = window.saveSystem.getDefault ? window.saveSystem.getDefault() : (_save || {})
    /* Stub out updateShift / saveGame on a per-call basis (only inside
       this script's references) by overlaying a sandbox proxy on the
       saveSystem methods for the duration of this page. */
    window.saveSystem._realUpdateShift = window.saveSystem.updateShift
    window.saveSystem._realSaveGame    = window.saveSystem.saveGame
    window.saveSystem.updateShift = function () { /* no-op in training */ }
    window.saveSystem.saveGame    = function () { /* no-op in training */ }
    /* Inject the badge once DOM is ready. */
    if (document.body) _injectTrainingBadge()
    else document.addEventListener('DOMContentLoaded', _injectTrainingBadge)
  }

  /* Sync legacy shift-number key so existing endShift() path keeps
     behaving identically while we migrate to the new save. */
  try { localStorage.setItem('thermalShiftNumber', String(_save.shiftNumber)) } catch (e) {}

  /* ═══════════════════════════════════════════════════════════════════
     PAUSABLE TIMERS — monkey-patch setTimeout/setInterval
     ─────────────────────────────────────────────────────────────────
     The game scatters ~80 setTimeout/setInterval calls across mini-game
     countdowns, anomaly escalations, deterioration ticks, valve
     timers, etc. Per-call `if (isPaused) return` checks would mean
     auditing every site. Instead we wrap the global timer functions
     so a single pauseAll/resumeAll freezes EVERY pending timer at
     once and resumes them with the elapsed time deducted.

     CSS animations are paused separately via `body.is-paused`.
     ═══════════════════════════════════════════════════════════════════ */
  const _origST = window.setTimeout.bind(window)
  const _origCT = window.clearTimeout.bind(window)
  const _origSI = window.setInterval.bind(window)
  const _origCI = window.clearInterval.bind(window)

  /* Active timers we manage. realId is the host-side id (or null while
     paused). For timeouts: scheduledAt + ms tells us remaining time on
     pause. For intervals we just re-create with the same ms on resume. */
  const _toReg = new Map()  // ourId → { fn, ms, realId, scheduledAt, remaining }
  const _inReg = new Map()  // ourId → { fn, ms, realId }
  let   _ourIdSeq = 1
  let   _timersPaused = false

  window.setTimeout = function (fn, ms) {
    if (typeof fn !== 'function') return _origST(fn, ms)
    ms = ms || 0
    const ourId = _ourIdSeq++
    const wrapped = function () {
      _toReg.delete(ourId)
      try { fn.apply(this, arguments) } catch (e) { console.error(e) }
    }
    if (_timersPaused) {
      _toReg.set(ourId, { fn: wrapped, ms, realId: null, remaining: ms })
    } else {
      const realId = _origST(wrapped, ms)
      _toReg.set(ourId, { fn: wrapped, ms, realId, scheduledAt: Date.now() })
    }
    return ourId
  }

  window.clearTimeout = function (ourId) {
    const t = _toReg.get(ourId)
    if (!t) return _origCT(ourId)  // pass through unknown ids (host-allocated)
    if (t.realId != null) _origCT(t.realId)
    _toReg.delete(ourId)
  }

  window.setInterval = function (fn, ms) {
    if (typeof fn !== 'function') return _origSI(fn, ms)
    ms = ms || 0
    const ourId = _ourIdSeq++
    const wrapped = function () { try { fn.apply(this, arguments) } catch (e) { console.error(e) } }
    if (_timersPaused) {
      _inReg.set(ourId, { fn: wrapped, ms, realId: null })
    } else {
      const realId = _origSI(wrapped, ms)
      _inReg.set(ourId, { fn: wrapped, ms, realId })
    }
    return ourId
  }

  window.clearInterval = function (ourId) {
    const t = _inReg.get(ourId)
    if (!t) return _origCI(ourId)
    if (t.realId != null) _origCI(t.realId)
    _inReg.delete(ourId)
  }

  function _pauseAllTimers() {
    if (_timersPaused) return
    _timersPaused = true
    const now = Date.now()
    _toReg.forEach((t) => {
      if (t.realId != null) {
        _origCT(t.realId)
        const elapsed = now - t.scheduledAt
        t.remaining   = Math.max(0, t.ms - elapsed)
        t.realId      = null
      }
    })
    _inReg.forEach((t) => {
      if (t.realId != null) { _origCI(t.realId); t.realId = null }
    })
  }

  function _resumeAllTimers() {
    if (!_timersPaused) return
    _timersPaused = false
    const now = Date.now()
    _toReg.forEach((t) => {
      if (t.realId == null) {
        const ms = (t.remaining != null) ? t.remaining : t.ms
        t.realId      = _origST(t.fn, ms)
        t.scheduledAt = now
        t.ms          = ms       // remaining becomes the new full ms going forward
        t.remaining   = null
      }
    })
    _inReg.forEach((t) => {
      if (t.realId == null) t.realId = _origSI(t.fn, t.ms)
    })
  }

  /* ─── Pause Menu ─────────────────────────────────────────────── */
  let isPaused = false;
  const overlay = document.getElementById('pause-overlay');

  function openPause() {
    isPaused = true;
    overlay.classList.add('active');
    document.body.classList.add('is-paused');   // freeze CSS animations
    _pauseAllTimers();                          // freeze every game timer
    _paintPausePrecision();                     // Sprint 1 (A) — sensor reliability snapshot
  }

  /* Populate the pause-overlay sensor-reliability strip. Only shown
     when at least one subsystem is below "ok" precision — keeps
     the pause menu tidy on clean shifts. Pulls live tier from
     _precisionTierFor() (hoisted; safe to call). */
  function _paintPausePrecision() {
    var wrap = document.getElementById('pause-precision')
    var rows = document.getElementById('pause-precision-rows')
    if (!wrap || !rows) return
    if (typeof _precisionTierFor !== 'function' || !gameState.resources) {
      wrap.style.display = 'none'; return
    }
    var t = (window.i18n && window.i18n.t) ? window.i18n.t : function (k, f) { return f }
    var SYS_LBL = {
      sicaklik: t('ui.gauge.temp',     'TEMPERATURE'),
      basinc:   t('ui.gauge.pressure', 'PRESSURE'),
      guc:      t('ui.gauge.power',    'POWER')
    }
    var TIER_LBL = {
      ok:   t('ui.status.ok',         'OK'),
      fair: t('precision.badge.fair', 'DEGRADED'),
      low:  t('precision.badge.low',  'LOW PRECISION'),
      crit: t('precision.badge.crit', 'UNRELIABLE')
    }
    var TIER_CLS = { ok: 'ok', fair: 'ok', low: 'warn', crit: 'crit' }

    var html  = ''
    var shown = 0
    ;['sicaklik','basinc','guc'].forEach(function (k) {
      var tier = _precisionTierFor(k)
      if (tier === 'ok') return
      shown++
      html += '<div class="pause-prec-row">' +
                '<span class="lbl">' + SYS_LBL[k] + '</span>' +
                '<span class="val ' + (TIER_CLS[tier] || 'ok') + '">' + TIER_LBL[tier] + '</span>' +
              '</div>'
    })
    rows.innerHTML = html
    wrap.style.display = shown > 0 ? '' : 'none'
  }

  function closePause() {
    isPaused = false;
    overlay.classList.remove('active');
    document.body.classList.remove('is-paused');
    _resumeAllTimers();
  }

  /* Pause toggle — bound to Escape by default; rebindable via
     window.keybinds. Escape ALWAYS works as a fallback so the
     player can never accidentally rebind themselves out of a pause. */
  document.addEventListener('keydown', (e) => {
    var matchPause = (e.key === 'Escape') ||
                     (window.keybinds && window.keybinds.matches(e, 'pause'))
    if (matchPause) {
      isPaused ? closePause() : openPause();
    }
  });

  /* DEVAM ET — resume */
  document.getElementById('btn-resume').addEventListener('click', closePause);

  /* ANA MENÜYE DÖN — CRT off → navigate to menu.
     closePause() FIRST so resume re-enables timers, then we use the
     real native setTimeout for the navigation delay (independent of
     game pause state). */
  document.getElementById('btn-menu').addEventListener('click', () => {
    closePause();
    const terminal = document.querySelector('.terminal');
    terminal.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards';
    _origST(() => { window.location.href = 'menu.html'; }, 620);
  });

  /* ÇIKIŞ — close window */
  document.getElementById('btn-quit').addEventListener('click', () => window.close());

  /* ═══════════════════════════════════════════════════════════════════
     SENSOR SYSTEM
     ─────────────────────────────────────────────────────────────────
     Public API (called by game loop when it exists):
       triggerAnomaly(sensorId, valueKey, type)
       resolveAnomaly(sensorId, valueKey)
     ═══════════════════════════════════════════════════════════════════ */

  /* ── State definition ────────────────────────────────────────────── */
  const sensorState = {
    A: {
      id: 'A',
      values: {
        temp:  { v: 82.4,    unit: '°C',   min: 0, max: 150, warnHi: 90,   critHi: 105,  warnLo: null, critLo: null, dec: 1 },
        flow:  { v: 4.2,     unit: ' m/s', min: 0, max: 10,  warnHi: null, critHi: null, warnLo: 2.0,  critLo: 0.5,  dec: 1 },
        valve: { v: 'CLOSED', unit: '',    type: 'state' },
      },
      anomaly: null,  // { valueKey, type, fakeValue, _showFake, escalated, timers }
    },
    B: {
      id: 'B',
      values: {
        coreTemp:  { v: 340,  unit: '°C',   min: 0, max: 800, warnHi: 500, critHi: 650, warnLo: null, critLo: null, dec: 0 },
        radiation: { v: 0.8,  unit: ' mSv', min: 0, max: 10,  warnHi: null, critHi: null, warnLo: null, critLo: null, dec: 2, noDrift: true },
        pressure:  { v: 0.61, unit: ' atm', min: 0, max: 2.0, warnHi: 1.4, critHi: 1.7, warnLo: null, critLo: null, dec: 2 },
      },
      anomaly: null,
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────────── */

  /* Format a value for display. override lets glitch show the fake value. */
  function fmtVal(vd, override) {
    const v = (override !== undefined) ? override : vd.v
    if (typeof v === 'string') return v
    return Number(v).toFixed(vd.dec) + vd.unit
  }

  /* Severity of a numeric value on its own (ignoring anomalies). */
  function valueLevel(vd) {
    if (vd.type === 'state') return 'ok'
    const v = vd.v
    if ((vd.critHi !== null && v >= vd.critHi) || (vd.critLo !== null && v <= vd.critLo)) return 'crit'
    if ((vd.warnHi !== null && v >= vd.warnHi) || (vd.warnLo !== null && v <= vd.warnLo)) return 'warn'
    return 'ok'
  }

  /* Bar fill % for numeric values; null for state values. */
  function barPct(vd) {
    if (vd.type === 'state') return null
    return Math.min(100, Math.max(0, (vd.v - vd.min) / (vd.max - vd.min) * 100))
  }

  function _nowHMS() {
    return [new Date().getHours(), new Date().getMinutes(), new Date().getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':')
  }

  /* ── Render ──────────────────────────────────────────────────────── */
  function renderSensor(id) {
    const sensor  = sensorState[id]
    const panel   = document.getElementById(`sensor-${id}`)
    const dotEl   = document.getElementById(`dot-${id}`)
    const stEl    = document.getElementById(`status-${id}`)
    const tsEl    = document.getElementById(`ts-${id}`)
    let   worst   = 'ok'

    Object.entries(sensor.values).forEach(([key, vd]) => {
      const valEl  = document.getElementById(`val-${id}-${key}`)
      const barEl  = document.getElementById(`bar-${id}-${key}`)
      const warnEl = document.getElementById(`warn-${id}-${key}`)
      if (!valEl) return

      /* Glitch interval owns the text while active — don't overwrite it. */
      if (!glitchTimers[`${id}_${key}`]) valEl.textContent = fmtVal(vd)

      /* Visual level: anomaly target escalates independently of raw value. */
      const isTarget = sensor.anomaly && sensor.anomaly.valueKey === key
      const level    = isTarget
        ? (sensor.anomaly.escalated ? 'crit' : 'warn')
        : valueLevel(vd)

      valEl.className  = 'sensor-row-value' + (level !== 'ok' ? ` ${level}` : '')

      if (barEl) {
        const w = barPct(vd)
        if (w !== null) {
          barEl.style.width = `${w.toFixed(1)}%`
          barEl.className   = 'sensor-minibar-fill' + (level !== 'ok' ? ` ${level}` : '')
        }
      }

      /* Radiation: silent colour-only progression, bypasses anomaly/warning system. */
      if (id === 'B' && key === 'radiation') {
        const rv = vd.v
        const rl = rv >= 3.0 ? 'crit' : rv >= 2.0 ? 'warn' : 'ok'
        valEl.className = 'sensor-row-value' + (rl !== 'ok' ? ` ${rl}` : '')
        if (barEl) barEl.className = 'sensor-minibar-fill' + (rl !== 'ok' ? ` ${rl}` : '')
      }

      if (warnEl) {
        if (isTarget) {
          warnEl.textContent = sensor.anomaly.escalated ? '⚠ READING CRITICAL' : '⚠ SIGNAL ERRORS'
          warnEl.className   = 'sensor-warning-text visible' + (sensor.anomaly.escalated ? ' crit' : '')
        } else {
          warnEl.textContent = ''
          warnEl.className   = 'sensor-warning-text'
        }
      }

      if (level === 'crit')                       worst = 'crit'
      else if (level === 'warn' && worst !== 'crit') worst = 'warn'
    })

    /* Panel-level indicator — anomaly state takes precedence over value drift. */
    const pLevel = sensor.anomaly ? (sensor.anomaly.escalated ? 'crit' : 'warn') : worst
    const COLOR  = { ok: 'var(--phosphor)', warn: 'var(--amber)', crit: 'var(--red-alert)' }
    const LABEL  = { ok: 'NOMINAL',           warn: 'ANOMALY',      crit: 'CRITICAL !'      }

    dotEl.style.background = COLOR[pLevel]
    dotEl.style.boxShadow  = `0 0 5px ${COLOR[pLevel]}`
    dotEl.style.animation  = pLevel !== 'ok' ? 'blink 0.8s step-end infinite' : ''
    stEl.textContent       = LABEL[pLevel]
    stEl.style.color       = COLOR[pLevel]

    panel.classList.toggle('anomaly-active', pLevel === 'warn')
    panel.classList.toggle('crit-active',    pLevel === 'crit')

    if (tsEl) tsEl.textContent = 'Last update: ' + _nowHMS()
  }

  function renderAll() { Object.keys(sensorState).forEach(renderSensor) }

  /* ── Glitch: rapid alternation between real and fake reading ─────── */
  const glitchTimers = {}

  function _glitchTick(id, key) {
    const sensor = sensorState[id]
    /* Auto-stop if anomaly was resolved between ticks. */
    if (!sensor.anomaly || sensor.anomaly.valueKey !== key) {
      delete glitchTimers[`${id}_${key}`]
      return
    }
    sensor.anomaly._showFake = !sensor.anomaly._showFake
    const el = document.getElementById(`val-${id}-${key}`)
    if (el) el.textContent = fmtVal(
      sensor.values[key],
      sensor.anomaly._showFake ? sensor.anomaly.fakeValue : sensor.values[key].v
    )
    /* Schedule next tick with 80–120 ms jitter for an organic feel. */
    glitchTimers[`${id}_${key}`] = setTimeout(
      () => _glitchTick(id, key),
      80 + Math.floor(Math.random() * 40)
    )
  }

  function _startGlitch(id, key) {
    _stopGlitch(id, key)
    sensorState[id].anomaly._showFake = false
    glitchTimers[`${id}_${key}`] = setTimeout(() => _glitchTick(id, key), 80)
  }

  function _stopGlitch(id, key) {
    clearTimeout(glitchTimers[`${id}_${key}`])
    delete glitchTimers[`${id}_${key}`]
  }

  /* ── Sensor → parent system mapping. Each sensor channel reads
     from a reactor subsystem; how much resource you allocate to
     that subsystem governs how precise the reading is. Low power
     to the temp subsystem → temp sensors drift wildly. */
  var SENSOR_SYS = {
    'A.temp':      'sicaklik',
    'A.flow':      'basinc',
    'B.coreTemp':  'sicaklik',
    'B.pressure':  'basinc',
    'B.radiation': 'guc'
  }

  /* Per-resource-tier noise amplifier. Tier table from the design
     plan (Sprint 1 — A → sensor noise):
       r ≥ 4   normal    × 1.0   (±1–5 %)
       r == 3  degraded  × 1.6   (~±%8)
       r == 2  low       × 2.8   (~±%14)  → triggers LOW PRECISION
       r ≤ 1   crit      × 4.5   (~±%22)  → triggers UNRELIABLE
     Visual badges (LOW PRECISION / UNRELIABLE) + digit flicker are
     painted by _renderPrecisionBadges() each tick.                 */
  /* Faz 2 / C — true when a demand-shift is active and the player
     has not allocated ≥4 to the targeted subsystem. While uncovered,
     the targeted system gets its normal demand-shift penalty AND
     non-target subsystems bleed extra sensor noise (collateral) +
     the dispatch panel garbles HR readouts. */
  function _demandShiftUncovered() {
    if (typeof _demandShift === 'undefined' || !_demandShift || !_demandShift.active) return false
    var sys = _demandShift.system
    if (!sys || !gameState.resources) return false
    return (gameState.resources[sys] | 0) < 4
  }

  function _noiseAmpFor(sysKey) {
    if (!sysKey || !gameState.resources) return 1
    var r = gameState.resources[sysKey] | 0
    var amp
    if (r >= 4)      amp = 1.0
    else if (r === 3) amp = 1.6
    else if (r === 2) amp = 2.8
    else              amp = 4.5
    /* Collateral: uncovered demand-shift bleeds noise into
       non-target subsystems (×1.3). Stacks with their own tier. */
    if (_demandShiftUncovered() && sysKey !== _demandShift.system) {
      amp *= 1.3
    }
    return amp
  }
  function _precisionTierFor(sysKey) {
    if (!sysKey || !gameState.resources) return 'ok'
    var r = gameState.resources[sysKey] | 0
    var tier
    if (r >= 4)      tier = 'ok'
    else if (r === 3) tier = 'fair'
    else if (r === 2) tier = 'low'
    else              tier = 'crit'
    /* Collateral bump: non-target sectors get one tier worse while
       a demand-shift is uncovered. Caps at one step — already-low
       or already-crit sectors don't escalate further. */
    if (_demandShiftUncovered() && sysKey !== _demandShift.system) {
      if (tier === 'ok')        tier = 'fair'
      else if (tier === 'fair') tier = 'low'
    }
    return tier
  }

  /* ── Normal drift: ±1-5% every 3–5 seconds, scaled by the parent
        subsystem's resource allocation. Low-power sectors swing
        much wider, giving the operator readings they can't fully
        trust — by their own resource decisions. */
  function _drift() {
    Object.entries(sensorState).forEach(([sid, sensor]) => {
      Object.entries(sensor.values).forEach(([key, vd]) => {
        if (vd.type === 'state') return
        if (vd.noDrift) return
        /* Don't drift the value that an anomaly is currently glitching. */
        if (sensor.anomaly && sensor.anomaly.valueKey === key) return

        var sysKey = SENSOR_SYS[sid + '.' + key]
        var amp    = _noiseAmpFor(sysKey)
        const sign = Math.random() < 0.5 ? 1 : -1
        const pct  = (0.01 + Math.random() * 0.04) * sign * amp
        /* Stay well inside safe zone so drift never self-triggers a warning. */
        const hiCap = vd.warnHi !== null ? vd.warnHi * 0.92 : vd.max * 0.75
        const loCap = vd.critLo !== null ? vd.critLo * 1.6
                    : vd.warnLo !== null ? vd.warnLo * 1.5
                    : vd.min + (vd.max - vd.min) * 0.25
        vd.v = Math.max(loCap, Math.min(hiCap, vd.v + vd.v * pct))
      })
    })
    renderAll()
    setTimeout(_drift, 3000 + Math.random() * 2000)
  }

  /* Keep timestamps ticking every second independently of drift cycle. */
  setInterval(() => {
    const hms = _nowHMS()
    Object.keys(sensorState).forEach(id => {
      const el = document.getElementById(`ts-${id}`)
      if (el) el.textContent = 'Last update: ' + hms
    })
  }, 1000)

  /* ── PUBLIC API ──────────────────────────────────────────────────── */

  /**
   * triggerAnomaly(sensorId, valueKey, type)
   *
   * Starts an anomaly on a specific sensor value.
   * Any previous anomaly on that sensor is resolved first.
   *
   * Anomaly types:
   *   1 — Value conflict   : sensor reads 0 / null while log says nominal
   *   2 — State conflict   : valve shows AÇIK, log says "valf B3 kapandı"
   *   3 — Physics conflict : reading drops with no physical reason
   *   4 — Cross conflict   : sensor looks normal, real value is critical
   *
   * After 60 s unacknowledged, anomaly escalates to CRIT:
   *   border pulses red, shake doubles speed, warning text turns red.
   */
  function triggerAnomaly(sensorId, valueKey, type) {
    const sensor = sensorState[sensorId]
    const vd     = sensor.values[valueKey]
    if (!vd) { console.warn(`[sensor] unknown: ${sensorId}.${valueKey}`); return }

    if (sensor.anomaly) resolveAnomaly(sensorId, sensor.anomaly.valueKey)

    const isNum = typeof vd.v === 'number'
    const fakeValue = {
      1: isNum ? 0.0             : '—',
      2: 'OPEN',
      3: isNum ? vd.v - vd.v * 0.30 : vd.v,
      4: isNum ? vd.v * 0.40    : vd.v,
    }[type] ?? (isNum ? 0.0 : 'ERR')

    sensor.anomaly = {
      valueKey,
      type,
      fakeValue,
      _showFake: false,
      escalated: false,
      timers: {
        escalate: setTimeout(() => {
          if (sensor.anomaly?.valueKey === valueKey) {
            sensor.anomaly.escalated = true
            renderSensor(sensorId)
          }
        }, 60000)
      }
    }

    _startGlitch(sensorId, valueKey)
    renderSensor(sensorId)
  }

  /**
   * resolveAnomaly(sensorId, valueKey)
   *
   * Called when the player correctly reports the anomaly.
   * Stops glitch, clears escalation timer, panel fades back to green.
   */
  function resolveAnomaly(sensorId, valueKey) {
    const sensor = sensorState[sensorId]
    if (!sensor.anomaly || sensor.anomaly.valueKey !== valueKey) return

    _stopGlitch(sensorId, valueKey)
    Object.values(sensor.anomaly.timers).forEach(clearTimeout)

    /* Snap display back to real reading immediately. */
    const vd = sensor.values[valueKey]
    const el = document.getElementById(`val-${sensorId}-${valueKey}`)
    if (el) el.textContent = fmtVal(vd)

    sensor.anomaly = null
    renderSensor(sensorId)
  }

  /* ── Boot ────────────────────────────────────────────────────────── */
  renderAll()
  setTimeout(_drift, 3000 + Math.random() * 2000)

  /* Radiation: +0.02 mSv every 30 s — no player control, no explanation. */
  setInterval(function() {
    const vd = sensorState.B.values.radiation
    vd.v = Math.min(vd.max, parseFloat((vd.v + 0.02).toFixed(2)))
    renderSensor('B')
  }, 30000)

  /* Radiation telemetry snapshots — captured at 22:00, 00:00, 02:00, 04:00 */
  var _radSnap = [parseFloat(sensorState.B.values.radiation.v.toFixed(2))]

  /* Track maximum radiation reached during the shift (for shift pay calc) */
  var _radMax = sensorState.B.values.radiation.v
  setInterval(function() {
    var v = sensorState.B.values.radiation.v
    if (v > _radMax) _radMax = v
  }, 1000)

  /* Paint header shift label from save */
  ;(function() {
    var el = document.getElementById('header-shift')
    if (el) el.textContent = 'SHIFT ' + (_save.shiftNumber || 1)
  })()

  /* ═══════════════════════════════════════════════════════════════════
     DEMAND SHIFT SYSTEM
     One demand event per shift. Doubles deterioration on the targeted
     system unless operator reallocates 5+ resources to it.
     TYPE A — Thermal surge      : window 23:00–00:00 (60–120) , 120 min
     TYPE B — Pressure event     : window 00:00–01:00 (120–180), 150 min
     TYPE C — Power fluctuation  : window 01:00–02:00 (180–240), 120 min
     ═══════════════════════════════════════════════════════════════════ */
  var _DEMAND_DEFS = [
    { type: 'A', label: 'THERMAL SURGE',      system: 'sicaklik', sysLabel: 'TEMPERATURE',
      winStart: 60,  winEnd: 120, duration: 120,
      startMsg: '▲ HIGH DEMAND: Thermal surge inbound — coolant load on TEMPERATURE rising. Reallocate to ≥5 units or deterioration will double.',
      endMsg:   'Thermal surge subsiding. TEMPERATURE load returning to nominal.' },
    { type: 'B', label: 'PRESSURE EVENT',     system: 'basinc',   sysLabel: 'PRESSURE',
      winStart: 120, winEnd: 180, duration: 150,
      startMsg: '▲ HIGH DEMAND: Primary loop pressure event — PRESSURE control taxed. Reallocate to ≥5 units or deterioration will double.',
      endMsg:   'Pressure event resolved. PRESSURE control margin restored.' },
    { type: 'C', label: 'POWER FLUCTUATION',  system: 'guc',      sysLabel: 'POWER',
      winStart: 180, winEnd: 240, duration: 120,
      startMsg: '▲ HIGH DEMAND: Grid demand fluctuation detected — POWER regulation strained. Reallocate to ≥5 units or deterioration will double.',
      endMsg:   'Grid fluctuation cleared. POWER regulation stable.' },
  ]
  var _demandShift = (function() {
    var def = _DEMAND_DEFS[Math.floor(Math.random() * _DEMAND_DEFS.length)]
    var startElapsed = def.winStart + Math.floor(Math.random() * (def.winEnd - def.winStart))
    return {
      type:         def.type,
      label:        def.label,
      system:       def.system,
      sysLabel:     def.sysLabel,
      startElapsed: startElapsed,
      endElapsed:   startElapsed + def.duration,
      startMsg:     def.startMsg,
      endMsg:       def.endMsg,
      active:       false,
      ended:        false,
    }
  })()

  /* ── DEMAND SPIKES — short bursts of stress that arrive every
        2-4 game-min, last 30-60 game-sec, and apply +40 % drift
        on a random system. Lighter than _demandShift (one big
        event per shift) — these create constant micro-pressure
        so the player always has something to watch.
        Mid-late shifts can have multiple stacked spikes. */
  var _spike = {
    active: false,
    system: null,            // 'sicaklik' | 'basinc' | 'guc'
    sysLabel: '',
    nextStart: 90,           // first spike ~game-min 90 (1.5h in shift)
    endAt: 0,
    multiplier: 1.4
  }
  var SPIKE_SYS = [
    { id: 'sicaklik', label: 'TEMPERATURE' },
    { id: 'basinc',   label: 'PRESSURE' },
    { id: 'guc',      label: 'POWER' }
  ]
  function _spikeStart() {
    var pick = SPIKE_SYS[Math.floor(Math.random() * SPIKE_SYS.length)]
    _spike.active = true
    _spike.system = pick.id
    _spike.sysLabel = pick.label
    var dur = 30 + Math.floor(Math.random() * 30)        // 30–60 game-sec
    _spike.endAt = _gcElapsed + dur
    _lsAdd('▲ DEMAND SPIKE — ' + pick.label + ' load surge. Drift +40 % until ' +
           _gcTimeAt(_spike.endAt) + '.', 'warning')
  }
  function _spikeEnd() {
    if (!_spike.active) return
    _lsAdd('▽ Demand spike on ' + _spike.sysLabel + ' cleared.', 'system')
    _spike.active = false
    _spike.system = null
    /* Next spike 2-4 game-min away */
    _spike.nextStart = _gcElapsed + 120 + Math.floor(Math.random() * 120)
  }
  function _gcTimeAt(elapsedMin) {
    var total = (22 * 60 + elapsedMin) % 1440
    var h = Math.floor(total / 60), m = total % 60
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0')
  }

  /* ═══════════════════════════════════════════════════════════════════
     RESOURCE DISTRIBUTION SYSTEM
     ═══════════════════════════════════════════════════════════════════ */

  /* ── State ─────────────────────────────────────────────────────────── */
  const gameState = {
    resources:        { sicaklik: 4, basinc: 3, guc: 3 },
    systemValues:     { sicaklik: 65.0, basinc: 52.0, guc: 72.0 },
    systemStatus:     { sicaklik: 'ok', basinc: 'ok', guc: 'ok' },
    critSeconds:      { sicaklik: 0, basinc: 0, guc: 0 },
    systemFailure:    false,
    freqBonus:        true,   // true when SYNC ≥ 90%; reduces TEMP deterioration 10%
    valveBonus:       false,  // true after successful valve sequence; pauses PRESSURE deterioration
    valvePenalty:     false,  // true after failed valve sequence; +25% PRESSURE deterioration
    correctDecisions: 0,
    wrongDecisions:   0,
    missedAnomalies:  0,
    totalCritSeconds: 0,
    freqCalSuccess:   0,
    freqCalFail:      0,
    meltdownOccurred: false,
    ventCount:        0,    // times player authorized external discharge this shift
    ventRads:         0,    // total Sv discharged externally this shift
    workerDeathsThisShift: 0,   // Faz 2/E — per-shift deaths; feeds news continuity
    erBonusTotal:     0,    // sum of quick-fix bonuses earned this shift ($)
    ersResolved:      0,    // count of ERs cleared this shift
    /* Per-subsystem accumulator: real seconds the resource was held
       at "low" (≤2) or "crit" (≤1) — drives Sprint 1's shift-end
       sensor-reliability readout + the in-shift LOW PRECISION badge. */
    lowPrecisionSeconds: { sicaklik: 0, basinc: 0, guc: 0 },
    critPrecisionSeconds: { sicaklik: 0, basinc: 0, guc: 0 },
    /* Sprint 2 (B) — per-anomaly severity / reasons / outcome log,
       surfaces in the shift-end report's "anomaly history" table. */
    anomalyEvents: [],
  }

  /* Expose to error-system.js (and any future module) so live resource
     reads can drive the ER combo lock without needing to scrape the DOM. */
  window.gameState = gameState

  /* ── Balance config — reads from window.BALANCE (balance.json) ───── */
  var _B = (function() {
    var src = window.BALANCE || {}
    function _get(path, fallback) {
      var parts = path.split('.'), v = src
      for (var i = 0; i < parts.length; i++) {
        if (v == null || typeof v !== 'object') return fallback
        v = v[parts[i]]
      }
      return (v != null) ? v : fallback
    }
    return {
      /* Systems — applied to SYSTEMS const below */
      sys: _get('systems', {}),
      res: _get('resources.init', { sicaklik: 4, basinc: 3, guc: 3 }),
      /* Meltdown */
      critMax:   _get('meltdown.critTimerMax', 120),
      /* Difficulty */
      diffInit:  _get('difficulty.initScale', 0.4),
      diffSteps: _get('difficulty.steps', [
        { elapsed:   0, scale: 0.4 },
        { elapsed:  60, scale: 0.7 },
        { elapsed: 180, scale: 1.0 },
        { elapsed: 300, scale: 1.4 },
        { elapsed: 420, scale: 1.8 },
      ]),
      /* Shift-to-shift escalation */
      shiftDeterPerShift: _get('shiftScaling.deterPerShift',     0.030),
      shiftAnomPerShift:  _get('shiftScaling.anomSpeedPerShift', 0.020),
      shiftDispPerShift:  _get('shiftScaling.dispSpeedPerShift', 0.022),
      shiftMaxBonus:      _get('shiftScaling.maxBonusShifts',      10),
      shiftFloorMult:     _get('shiftScaling.intervalFloorMult', 0.60),
      /* Radiation */
      radWarnLeak:    _get('radiation.warnLeakRate', 0.004),
      radCritLeak:    _get('radiation.critLeakRate', 0.010),
      radCap:         _get('radiation.cap', 9.9),
      radVentThresh:  _get('radiation.ventThreshold', 2.2),
      /* Vent */
      ventAuthCD:     _get('vent.authorizeCooldown', 120),
      ventContainCD:  _get('vent.containCooldown', 90),
      ventDischarge:  _get('vent.dischargeMultiplier', 0.65),
      ventRelief:     _get('vent.systemReliefFactor', 0.35),
      ventDecision:   _get('vent.decisionWindowSeconds', 25),
      /* Anomaly */
      anomFirstMs:    _get('anomaly.firstSpawnMs', 180000),
      anomFirstRnd:   _get('anomaly.firstSpawnRandMs', 120000),
      anomEarlyEl:    _get('anomaly.earlyElapsed', 240),
      anomEarlyMin:   _get('anomaly.earlyMinMs', 60000),
      anomEarlyRnd:   _get('anomaly.earlyRandMs', 120000),
      anomMidEl:      _get('anomaly.midElapsed', 120),
      anomMidMin:     _get('anomaly.midMinMs', 120000),
      anomMidRnd:     _get('anomaly.midRandMs', 120000),
      anomLateMin:    _get('anomaly.lateMinMs', 240000),
      anomLateRnd:    _get('anomaly.lateRandMs', 180000),
      anomDecide:     _get('anomaly.decideWindowMs', 90000),
      anomStage1:     _get('anomaly.stage1WindowMs', 60000),
      anomClueMin:    _get('anomaly.fakeClueMinMs', 60000),
      anomClueRnd:    _get('anomaly.fakeClueRandMs', 30000),
      anomPostOk:     _get('anomaly.postResolveDelayMs', 5000),
      anomPostMiss:   _get('anomaly.postMissDelayMs', 3000),
      /* CRM */
      crmFirstMs:     _get('crm.firstSpawnMs', 240000),
      crmFirstRnd:    _get('crm.firstSpawnRandMs', 120000),
      crmRespawnMs:   _get('crm.respawnMs', 240000),
      crmRespawnRnd:  _get('crm.respawnRandMs', 240000),
      crmWindowSec:   _get('crm.windowSeconds', 60),
      crmDriftMs:     _get('crm.driftIntervalMs', 20000),
      crmDriftRnd:    _get('crm.driftRandMs', 10000),
      crmPen2At:      _get('crm.penalty2AtSeconds', 90),
      crmPen3At:      _get('crm.penalty3AtSeconds', 120),
      /* Valve */
      vmFirstMs:      _get('valve.firstSpawnMs', 300000),
      vmFirstRnd:     _get('valve.firstSpawnRandMs', 180000),
      vmRespawnMs:    _get('valve.respawnMs', 300000),
      vmRespawnRnd:   _get('valve.respawnRandMs', 240000),
      vmWindowSec:    _get('valve.windowSeconds', 45),
      vmIdleMs:       _get('valve.idleBreathMs', 40000),
      vmIdleRnd:      _get('valve.idleBreathRandMs', 20000),
    }
  })()

  /* ── Shift-to-shift escalation ─────────────────────────────────────
     Three correlated levers, all driven by the player's shift number
     and tuned in config/balance.json → shiftScaling:

       _shiftDeterMult  (>= 1) — multiplied into _diffScale so every
                                 tick of deterioration is slightly
                                 faster on later shifts.
       _shiftAnomMult   (<= 1) — multiplied into anomaly spawn delays.
                                 Smaller = anomalies come sooner.
       _shiftDispMult   (<= 1) — multiplied into dispatch spawn delays.

     The ramp is capped at maxBonusShifts so very late runs don't
     collapse into chaos; intervals are floored so events never pile
     on top of each other. Shift 1 is always baseline (mult = 1). */
  var _shiftIdx        = Math.max(0, (_save.shiftNumber || 1) - 1)
  var _shiftBonus      = Math.min(_shiftIdx, _B.shiftMaxBonus)
  var _shiftDeterMult  = 1 + _B.shiftDeterPerShift * _shiftBonus
  var _shiftAnomMult   = Math.max(_B.shiftFloorMult, 1 - _B.shiftAnomPerShift * _shiftBonus)
  var _shiftDispMult   = Math.max(_B.shiftFloorMult, 1 - _B.shiftDispPerShift * _shiftBonus)

  /* Per-shift anomaly event log — written to localStorage at endShift() */
  var _shiftAnomalyLog = []
  function _logAnom(text, cls) {
    _shiftAnomalyLog.push({ ts: _gcTime(), text: text, cls: cls || '' })
  }

  /* External vent cooldown (real seconds) — resets between vent events */
  var _ventCooldownSecs = 0

  /* ── System physics config ─────────────────────────────────────────── */
  /*  Physics formula (per second):
      res ≤ 3 : mag = lerp(deterRate, 0.05, res/3)   [deterRate at res=0, 0.05 at res=3]
      res > 3 : mag = 0.05 − (res−3) × 0.06          [negative = improvement]
      rate    = (mag > 0 ? mag × diffScale : mag) × direction
      direction: +1 = value rises when deteriorating (TEMP, PRESSURE)
                 −1 = value falls when deteriorating (POWER)            */
  /* SYSTEMS — seeded from balance.json, falls back to hardcoded defaults */
  function _sysField(key, field, fallback) {
    return (_B.sys[key] && _B.sys[key][field] != null) ? _B.sys[key][field] : fallback
  }
  const SYSTEMS = {
    sicaklik: {
      label:     _sysField('sicaklik','label',    'TEMPERATURE'),
      unit:      _sysField('sicaklik','unit',     '°C'),
      dec:       _sysField('sicaklik','dec',       1),
      safe:      _sysField('sicaklik','safe',      [40, 85]),
      warn:      _sysField('sicaklik','warn',      [37, 88]),
      crit:      _sysField('sicaklik','crit',      [34, 92]),
      deterRate: _sysField('sicaklik','deterRate', 0.30),
      direction: _sysField('sicaklik','direction', +1),
      gaugeMin:  _sysField('sicaklik','gaugeMin',  0),
      gaugeMax:  _sysField('sicaklik','gaugeMax',  120),
      hintSafe:  _sysField('sicaklik','hintSafe',  'SAFE: 40–85°C'),
    },
    basinc: {
      label:     _sysField('basinc','label',    'PRESSURE'),
      unit:      _sysField('basinc','unit',     '%'),
      dec:       _sysField('basinc','dec',       1),
      safe:      _sysField('basinc','safe',      [40, 80]),
      warn:      _sysField('basinc','warn',      [36, 84]),
      crit:      _sysField('basinc','crit',      [32, 88]),
      deterRate: _sysField('basinc','deterRate', 0.22),
      direction: _sysField('basinc','direction', +1),
      gaugeMin:  _sysField('basinc','gaugeMin',  0),
      gaugeMax:  _sysField('basinc','gaugeMax',  100),
      hintSafe:  _sysField('basinc','hintSafe',  'SAFE: 40–80%'),
    },
    guc: {
      label:     _sysField('guc','label',    'POWER'),
      unit:      _sysField('guc','unit',     '%'),
      dec:       _sysField('guc','dec',       1),
      safe:      _sysField('guc','safe',      [50, 90]),
      warn:      _sysField('guc','warn',      [42, 93]),
      crit:      _sysField('guc','crit',      [35, 95]),
      deterRate: _sysField('guc','deterRate', 0.15),
      direction: _sysField('guc','direction', -1),
      gaugeMin:  _sysField('guc','gaugeMin',  0),
      gaugeMax:  _sysField('guc','gaugeMax',  100),
      hintSafe:  _sysField('guc','hintSafe',  'SAFE: 50–90%'),
    }
  }

  /* ── Apply balance.json overrides to gameState initial values ──────
     (gameState is const so we mutate its properties, not replace it)  */
  gameState.resources.sicaklik    = _B.res.sicaklik
  gameState.resources.basinc      = _B.res.basinc
  gameState.resources.guc         = _B.res.guc
  gameState.systemValues.sicaklik = _sysField('sicaklik', 'initValue', 65.0)
  gameState.systemValues.basinc   = _sysField('basinc',   'initValue', 52.0)
  gameState.systemValues.guc      = _sysField('guc',      'initValue', 72.0)

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function _getStatus(val, cfg) {
    if (val >= cfg.crit[1] || val <= cfg.crit[0]) return 'crit'
    if (val >= cfg.warn[1] || val <= cfg.warn[0]) return 'warn'
    return 'ok'
  }

  function _flashBtn(id) {
    const btn = document.getElementById(id)
    if (!btn) return
    btn.classList.add('blocked')
    setTimeout(() => btn.classList.remove('blocked'), 400)
  }

  /* ── addLog — delegates to _lsAdd (hoisted function declaration) ───── */
  function addLog(msg, type) {
    _lsAdd(msg, type || 'normal')
  }

  /* ── renderResources ─────────────────────────────────────────────── */
  function renderResources() {
    Object.keys(SYSTEMS).forEach(function(sys) {
      const res    = gameState.resources[sys]
      const valEl  = document.getElementById('res-val-' + sys)
      const dotsEl = document.getElementById('res-dots-' + sys)
      if (valEl)  valEl.textContent = res
      if (dotsEl) {
        dotsEl.innerHTML = Array.from({ length: 10 }, function(_, i) {
          return '<div class="dot' + (i < res ? ' filled' : '') + '"></div>'
        }).join('')
      }
    })
  }

  /* ── renderGauges ────────────────────────────────────────────────── */
  function renderGauges() {
    Object.keys(SYSTEMS).forEach(function(sys) {
      const cfg     = SYSTEMS[sys]
      const val     = gameState.systemValues[sys]
      const status  = gameState.systemStatus[sys]
      const pct     = Math.min(100, Math.max(0,
        (val - cfg.gaugeMin) / (cfg.gaugeMax - cfg.gaugeMin) * 100
      ))

      const valEl   = document.getElementById('gauge-val-' + sys)
      const barEl   = document.getElementById('gauge-bar-' + sys)
      const hintEl  = document.getElementById('gauge-hint-' + sys)
      const blockEl = document.getElementById('gauge-block-' + sys)

      if (valEl) {
        const arrow = status === 'ok' ? '' : (val > cfg.safe[1] ? ' ▲' : ' ▼')
        valEl.textContent = val.toFixed(cfg.dec) + cfg.unit + arrow
        valEl.className   = 'val ' + status
      }
      if (barEl) {
        barEl.style.width = pct.toFixed(1) + '%'
        barEl.className   = 'gauge-bar-fill ' + status
      }
      if (hintEl) {
        if (status === 'crit') {
          hintEl.textContent       = 'CRITICAL THRESHOLD: ' + val.toFixed(cfg.dec) + cfg.unit
          hintEl.style.color       = 'var(--red-alert)'
          hintEl.style.animation   = 'blink 0.6s step-end infinite'
        } else if (status === 'warn') {
          hintEl.textContent       = 'WARNING: ' + val.toFixed(cfg.dec) + cfg.unit
          hintEl.style.color       = 'var(--amber)'
          hintEl.style.animation   = ''
        } else {
          hintEl.textContent       = cfg.hintSafe
          hintEl.style.color       = 'var(--phosphor-dim)'
          hintEl.style.animation   = ''
        }
      }
      if (blockEl) {
        blockEl.classList.toggle('crit-active', status === 'crit')
      }
      /* ── Precision badge (Sprint 1 A): show LOW PRECISION /
            UNRELIABLE when the subsystem is starved of resources.
            Block-level class drives the digit flicker animation
            defined in game.html. */
      var precTier = _precisionTierFor(sys)
      var badgeEl  = document.getElementById('precision-badge-' + sys)
      if (badgeEl) {
        var t = (window.i18n && window.i18n.t) ? window.i18n.t : function (k, f) { return f }
        badgeEl.className = 'precision-badge ' + (precTier === 'ok' ? '' : precTier)
        if      (precTier === 'crit') badgeEl.textContent = t('precision.badge.crit', 'UNRELIABLE')
        else if (precTier === 'low')  badgeEl.textContent = t('precision.badge.low',  'LOW PRECISION')
        else if (precTier === 'fair') badgeEl.textContent = t('precision.badge.fair', 'DEGRADED')
        else                          badgeEl.textContent = ''
      }
      if (blockEl) {
        blockEl.classList.toggle('precision-low',  precTier === 'low')
        blockEl.classList.toggle('precision-crit', precTier === 'crit')
      }
    })
  }

  /* ── systemTick — called every second ───────────────────────────── */
  function systemTick() {
    if (gameState.systemFailure) return

    /* Accumulate per-subsystem low-precision time. Runs at system
       speed (1×/2×/4× tick rate), so the counter advances in
       game-seconds equivalent — what the shift-end "reliability
       readout" reports back to the player. */
    if (gameState.resources) {
      var _resKeys = ['sicaklik', 'basinc', 'guc']
      for (var _i = 0; _i < _resKeys.length; _i++) {
        var _sk = _resKeys[_i]
        var _r  = gameState.resources[_sk] | 0
        if (_r <= 1)      gameState.critPrecisionSeconds[_sk]++
        else if (_r <= 2) gameState.lowPrecisionSeconds[_sk]++
      }
    }

    /* Faz 2 / C — surface collateral state transitions in the log
       so the player can connect cause (uncovered demand-shift) to
       effect (extra noise everywhere + dispatch garble). */
    var _colNow = _demandShiftUncovered()
    if (_colNow !== systemTick._colPrev) {
      var _t = (window.i18n && window.i18n.t) ? window.i18n.t : function (k, f) { return f }
      if (_colNow) {
        _lsAdd(_t('demandCollateral.warn',
          '⚠ COLLATERAL — non-target sensors degraded + dispatch HR data garbled until demand-shift covered.'),
          'warning')
      } else if (systemTick._colPrev === true) {
        _lsAdd(_t('demandCollateral.clear',
          '▽ Collateral cleared — sensors and dispatch readouts restored.'),
          'system')
      }
      systemTick._colPrev = _colNow
    }

    Object.keys(SYSTEMS).forEach(function(sys) {
      const cfg  = SYSTEMS[sys]
      const res  = gameState.resources[sys]
      /* Deterioration magnitude (always expressed as a positive number = "getting worse"):
         res ≤ 3 : linear interp from deterRate (res=0) down to 0.05 (res=3)
         res > 3 : each unit above 3 cuts 0.06; goes negative when ≥4 (= improvement) */
      var mag
      if (res <= 3) {
        mag = cfg.deterRate - (cfg.deterRate - 0.05) * (res / 3)
      } else {
        mag = 0.05 - (res - 3) * 0.06
      }
      /* Apply difficulty scaling to deterioration only; improvement is unscaled */
      var   rate = (mag > 0 ? mag * _diffScale : mag) * cfg.direction
      /* Frequency monitor modifiers — TEMPERATURE only, deterioration only */
      if (sys === 'sicaklik' && rate > 0) {
        if (gameState.freqBonus)  rate *= 0.90   // SYNC ≥ 90 %: −10 %
        if (_fcPenaltyLevel >= 1) rate *= 1.20   // SYNC < 50 % for 30 s+: +20 %
        if (_fcPermDebuff)        rate *= 1.15   // permanent level-3 debuff: +15 %
      }
      /* Valve mini-game modifiers — PRESSURE only, deterioration only */
      if (sys === 'basinc' && mag > 0) {
        if (gameState.valveBonus)   rate  = 0       // pause deterioration entirely
        if (gameState.valvePenalty) rate *= 1.25    // +25 %
      }
      /* Demand shift modifier — 2× deterioration unless target system has ≥5 resources */
      if (_demandShift.active && _demandShift.system === sys && mag > 0 && res < 5) {
        rate *= 2.0
      }
      /* DEMAND SPIKE — short-burst micro-stress that adds +40 %
         drift on the targeted system. Stacks with demand-shift. */
      if (_spike.active && _spike.system === sys && mag > 0) {
        rate *= _spike.multiplier
      }
      let   val  = Math.max(cfg.gaugeMin, Math.min(cfg.gaugeMax,
                     gameState.systemValues[sys] + rate
                   ))
      gameState.systemValues[sys] = val

      const prev   = gameState.systemStatus[sys]
      const next   = _getStatus(val, cfg)

      if (next !== prev) {
        var _wMsg, _cMsg, _nMsg
        if (sys === 'sicaklik') {
          _wMsg = '⚠ TEMP deviation: ' + val.toFixed(1) + '°C — coolant flow adjustment required.'
          _cMsg = '⚠ CRITICAL TEMP: ' + val.toFixed(1) + '°C — emergency coolant activation required.'
          _nMsg = 'Core temperature stabilized. Coolant equilibrium restored.'
        } else if (sys === 'basinc') {
          _wMsg = '⚠ PRIMARY PRESSURE trending: ' + val.toFixed(1) + '% — verify valve V-114 position.'
          _cMsg = '⚠ CRITICAL PRESSURE: ' + val.toFixed(1) + '% — primary circuit integrity at risk.'
          _nMsg = 'Primary circuit pressure normalized. No structural impact recorded.'
        } else {
          _wMsg = '⚠ REACTOR POWER drift: ' + val.toFixed(1) + '% — control rod position check required.'
          _cMsg = '⚠ CRITICAL POWER: ' + val.toFixed(1) + '% — SCRAM threshold approached. Reduce load.'
          _nMsg = 'Reactor power within authorized band. Monitoring resumed.'
        }
        if      (next === 'warn') { addLog(_wMsg, 'warning'); _logAnom(_wMsg, 'lo') }
        else if (next === 'crit') { addLog(_cMsg, 'anomaly'); _logAnom(_cMsg, 'lo') }
        else                      { addLog(_nMsg, 'normal');  _logAnom(_nMsg, '')  }
        gameState.systemStatus[sys] = next
        /* Audio cues for status transition.
           - Escalation into warn/crit → alert sound.
           - Recovery back to ok → subtle, no sound (the normal log
             tick already covers it). */
        if (window.hoverSfx) {
          if      (next === 'crit') { try { window.hoverSfx.alarm() } catch(e){} }
          else if (next === 'warn' && prev !== 'crit') { try { window.hoverSfx.warn() } catch(e){} }
        }
      }

      if (next === 'crit') {
        gameState.critSeconds[sys]++
        gameState.totalCritSeconds++
        _meltdownUpdate(sys, gameState.critSeconds[sys])
        if (gameState.critSeconds[sys] >= _B.critMax) {
          gameState.systemFailure = true
          gameState.meltdownOccurred = true
          var _fMsg
          if      (sys === 'sicaklik') _fMsg = '⚠ FATAL: Thermal ceiling exceeded — fuel assembly damage probable. Shift terminated.'
          else if (sys === 'basinc')   _fMsg = '⚠ FATAL: Primary circuit failure — containment boundary compromised. Shift terminated.'
          else                         _fMsg = '⚠ FATAL: Uncontrolled power excursion — SCRAM engaged. Shift terminated.'
          addLog(_fMsg, 'anomaly')
          /* The fatal moment is announced with the same alarm used for
             the first red trip — no synthetic boom. The shake + static
             below provides the visceral "signal lost" layer instead. */
          if (window.hoverSfx) { try { window.hoverSfx.alarm() } catch(e){} }
          _triggerMeltdownShake()
          setTimeout(function() { endShift() }, 4000)
        }
      } else {
        if (gameState.critSeconds[sys] > 0) {
          gameState.critSeconds[sys] = 0
          _meltdownReset(sys)
        }
      }
    })

    /* If no system is currently critical, kill any active meltdown bar */
    var _anyCrit = Object.keys(gameState.critSeconds).some(function(s) {
      return gameState.critSeconds[s] > 0
    })
    if (!_anyCrit) _meltdownReset(null)

    /* Radiation rises from system stress — the core of the moral dilemma.
       warn → slow leak; crit → fast leak. Values cap at 9.9 to avoid
       instant meltdown-level readings from pure stress alone.           */
    Object.keys(gameState.systemStatus).forEach(function(s) {
      var st = gameState.systemStatus[s]
      if (st === 'crit') sensorState.B.values.radiation.v = Math.min(_B.radCap,
        sensorState.B.values.radiation.v + _B.radCritLeak)
      else if (st === 'warn') sensorState.B.values.radiation.v = Math.min(_B.radCap,
        sensorState.B.values.radiation.v + _B.radWarnLeak)
    })

    /* Vent cooldown tick + button state update */
    if (_ventCooldownSecs > 0) _ventCooldownSecs--
    _checkVentOpportunity()

    renderGauges()
  }

  /* ── updateResources ─────────────────────────────────────────────── */
  function updateResources(sys, delta) {
    const cur  = gameState.resources[sys]
    const next = cur + delta
    if (next < 0 || next > 10) {
      _flashBtn('res-' + (delta > 0 ? 'plus' : 'minus') + '-' + sys)
      return
    }

    const others = Object.keys(SYSTEMS).filter(function(s) { return s !== sys })

    if (delta > 0) {
      // Increasing sys: steal 1 from the other with most resources
      const donor = others.reduce(function(a, b) {
        return gameState.resources[a] >= gameState.resources[b] ? a : b
      })
      if (gameState.resources[donor] <= 0) { _flashBtn('res-plus-' + sys); return }
      gameState.resources[donor]--
      addLog(SYSTEMS[sys].label + ' +1 → ' + next + ' units. ' + SYSTEMS[donor].label + ' reduced.', 'normal')
    } else {
      // Decreasing sys: give 1 to the other with fewest resources
      const recipient = others.reduce(function(a, b) {
        return gameState.resources[a] <= gameState.resources[b] ? a : b
      })
      gameState.resources[recipient]++
      addLog(SYSTEMS[sys].label + ' −1 → ' + next + ' units. ' + SYSTEMS[recipient].label + ' increased.', 'normal')
    }

    gameState.resources[sys] = next
    renderResources()
  }

  /* ── Button wiring ───────────────────────────────────────────────── */
  document.getElementById('res-minus-sicaklik').addEventListener('click', function() { updateResources('sicaklik', -1) })
  document.getElementById('res-plus-sicaklik' ).addEventListener('click', function() { updateResources('sicaklik', +1) })
  document.getElementById('res-minus-basinc'  ).addEventListener('click', function() { updateResources('basinc',   -1) })
  document.getElementById('res-plus-basinc'   ).addEventListener('click', function() { updateResources('basinc',   +1) })
  document.getElementById('res-minus-guc'     ).addEventListener('click', function() { updateResources('guc',      -1) })
  document.getElementById('res-plus-guc'      ).addEventListener('click', function() { updateResources('guc',      +1) })

  /* ── Resource system boot ────────────────────────────────────────── */
  renderResources()
  renderGauges()
  var _systemTickHandle = setInterval(systemTick, 1000)

  /* ── Spark / bzzt ambience while systems deteriorate ─────────────
     Every ~1 s we roll per system:
       warn → ~12 % chance of a spark this tick
       crit → ~32 % chance of a spark this tick
     Ticks stop during the ending screens (systemFailure). Multiple
     stressed systems compound — a plant that's all-red will crackle
     a lot, which is exactly the desired "everything is arcing" feel. */
  /* Retrigger the amber spark-flash CSS on .terminal. Reflow is forced
     between removal and re-add so the animation restarts every call. */
  function _sparkFlash() {
    var el = document.querySelector('.terminal')
    if (!el) return
    el.classList.remove('spark-flash')
    /* force reflow */ void el.offsetWidth
    el.classList.add('spark-flash')
  }

  /* Meltdown: full-screen shake + TV-static audio for the duration. */
  function _triggerMeltdownShake() {
    var el = document.querySelector('.terminal')
    if (el) {
      el.classList.add('meltdown-shake')
      setTimeout(function() { if (el) el.classList.remove('meltdown-shake') }, 3500)
    }
    if (window.hoverSfx && typeof window.hoverSfx.static === 'function') {
      try { window.hoverSfx.static(3.5) } catch (e) {}
    }
  }

  var _sparkTickHandle = setInterval(function() {
    if (!gameState || gameState.systemFailure) return
    if (!window.hoverSfx || typeof window.hoverSfx.spark !== 'function') return
    var keys = Object.keys(gameState.systemStatus || {})
    for (var i = 0; i < keys.length; i++) {
      var st = gameState.systemStatus[keys[i]]
      var chance = st === 'crit' ? 0.32 : (st === 'warn' ? 0.12 : 0)
      if (chance > 0 && Math.random() < chance) {
        try { window.hoverSfx.spark() } catch(e){}
        /* Visual flash paired with the spark so the sound lines up
           exactly with a visible amber flicker around the screen. */
        _sparkFlash()
      }
    }
  }, 1000)

  /* ═══════════════════════════════════════════════════════════════════
     GAME CLOCK — flat declarations (no IIFE)
     1 real second = 1 game minute.  Shift: 22:00 → 06:00 (480 min).
     ═══════════════════════════════════════════════════════════════════ */

  var _gcElapsed  = 0
  var _gcStart    = 22 * 60   // 1320 — shift begins at 22:00
  var _gcDuration = 8  * 60   // 480  — shift ends at 06:00
  var _gcInterval

  /* Difficulty scale — step function by shift phase, applied to deterioration only.
     22:00–23:00 → 0.4×   23:00–01:00 → 0.7×   01:00–03:00 → 1.0×
     03:00–05:00 → 1.4×   05:00–06:00 → 1.8×                          */
  var _diffScale = _B.diffInit * _shiftDeterMult

  function _getDiffScale() {
    var steps = _B.diffSteps
    var scale = steps[0].scale
    for (var i = 1; i < steps.length; i++) {
      if (_gcElapsed >= steps[i].elapsed) scale = steps[i].scale
    }
    /* Layer the shift-to-shift multiplier on top of the intra-shift
       phase curve so later shifts feel progressively heavier without
       the early hours becoming impossible. */
    /* While an ER is active the reactor degrades faster — error-system
       returns 1.0 normally and the configured boost (e.g. 1.8×) while
       the player is racing to satisfy all four conditions. */
    var erBoost = (window.errorSystem && window.errorSystem.getDeterMult)
                  ? window.errorSystem.getDeterMult() : 1
    return scale * _shiftDeterMult * erBoost
  }

  /* Hoisted function declarations — safe to call from anywhere. */
  function _gcTime() {
    var total = (_gcStart + _gcElapsed) % 1440
    var h = Math.floor(total / 60)
    var m = total % 60
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
  }

  function _gcBar() {
    var pct    = Math.min(100, Math.floor(_gcElapsed / _gcDuration * 100))
    var filled = Math.floor(pct / 100 * 15)
    var bar    = ''
    for (var i = 0; i < 15; i++) {
      bar += (i < filled - 1 ? '▓' : i === filled - 1 ? '▒' : '░')
    }
    return bar + ' ' + pct + '%'
  }

  function _gcRemain() {
    var rem = _gcDuration - _gcElapsed
    if (rem <= 0) return 'SHIFT ENDED'
    var h = Math.floor(rem / 60)
    var m = rem % 60
    if (h > 0) return h + ' HR. ' + String(m).padStart(2, '0') + ' MIN. TO 06:00'
    return m + ' MIN. TO 06:00'
  }

  function _gcPaint() {
    var t = _gcTime()
    var e
    e = document.getElementById('header-clock');     if (e) e.textContent = t
    e = document.getElementById('action-clock');     if (e) e.textContent = t
    e = document.getElementById('action-remaining'); if (e) e.textContent = _gcRemain()
    e = document.getElementById('shift-bar');        if (e) e.textContent = _gcBar()
    e = document.querySelector('.pause-shift-time'); if (e) e.textContent = t
  }

  function _gcTick() {
    _gcElapsed++
    /* If we've overshot 06:00 (because the shift end is being held
       open for an active mini-game), clamp BEFORE painting so the HUD
       never flickers past 06:00. */
    if (_gcElapsed > _gcDuration) _gcElapsed = _gcDuration
    _gcPaint()

    /* Update difficulty step every tick */
    _diffScale = _getDiffScale()

    /* Phase-transition log messages at key thresholds */
    if (_gcElapsed === 60)        // 23:00 — difficulty steps to 0.7×
      _lsAdd('23:00 — Load profile shifting. Thermal margins narrowing.', 'system')
    else if (_gcElapsed === 120)  // 00:00 — difficulty steps to 1.0×... wait, 120min = 00:00
      _lsAdd('00:00 — Night phase transition. Thermal baseline climbing. Increased vigilance required.', 'system')
    else if (_gcElapsed === 180)  // 01:00 — difficulty 1.0×
      _lsAdd('01:00 — Nominal load. All systems require active monitoring.', 'system')
    else if (_gcElapsed === 300)  // 03:00 — difficulty 1.4×
      _lsAdd('⚠ 03:00 — High-load phase active. All parameters trend adverse. Intervention threshold reduced.', 'warning')
    else if (_gcElapsed === 420)  // 05:00 — difficulty 1.8×
      _lsAdd('⚠ 05:00 — Final phase. Reactor load at maximum. Critical response time halved.', 'warning')

    /* Radiation snapshots at 00:00, 02:00, 04:00 (elapsed 120, 240, 360) */
    if (_gcElapsed === 120 || _gcElapsed === 240 || _gcElapsed === 360)
      _radSnap.push(parseFloat(sensorState.B.values.radiation.v.toFixed(2)))

    /* Demand shift trigger / end */
    /* DEMAND SPIKE tick — start when nextStart hits, end when endAt hits */
    if (!_spike.active && _gcElapsed >= _spike.nextStart) _spikeStart()
    else if (_spike.active && _gcElapsed >= _spike.endAt) _spikeEnd()

    if (!_demandShift.active && !_demandShift.ended && _gcElapsed === _demandShift.startElapsed) {
      _demandShift.active = true
      _lsAdd(_demandShift.startMsg, 'warning')
      var _di = document.getElementById('demand-ind-' + _demandShift.system)
      if (_di) _di.style.display = ''
    }
    if (_demandShift.active && _gcElapsed === _demandShift.endElapsed) {
      _demandShift.active = false
      _demandShift.ended  = true
      _lsAdd(_demandShift.endMsg, 'system')
      var _di2 = document.getElementById('demand-ind-' + _demandShift.system)
      if (_di2) _di2.style.display = 'none'
    }

    if (_gcElapsed >= _gcDuration) {
      /* 06:00 reached. If a mini-game is still running, hold at 06:00
         and wait — a player mid-valve-sequence or mid-dispatch shouldn't
         have the scene ripped away. The clock is kept at the max value
         (no further advance) and endShift is deferred until the
         mini-game closes. */
      _gcElapsed = _gcDuration   // clamp so the HUD shows 06:00 exactly
      var blocker = _whatBlocks()
      if (blocker) {
        /* Log the hold once with diagnostic blocker name so the player
           (and us) can see WHAT is keeping the shift open. */
        if (!_shiftEndHoldLogged) {
          _shiftEndHoldLogged = true
          _lsAdd('06:00 — Shift end held by: ' + blocker + '. Will force-end in 8s if not cleared.', 'warning')
          console.warn('[SHIFT-END] held by:', blocker)
        }
        return
      }
      clearInterval(_gcInterval)
      console.log('[SHIFT-END] no blocker → calling endShift() naturally')
      endShift()
    }
  }

  /* One-shot guard so the "awaiting task completion" log prints only
     once even though the tick re-enters every second. */
  var _shiftEndHoldLogged = false

  /* True while any of the interactive mini-games is running. Dispatch
     uses a full-screen overlay, Survey and Valve Manager use inline
     active classes. */
  /* Exposed so error-system's auto-spawn scheduler can defer firing
     while the player is mid-task. */
  window._isMiniGameActive = function () { return _isMiniGameActive() }
  /* Diagnostic: returns the name of whatever's blocking, or null. */
  function _whatBlocks() {
    if (window.errorSystem && window.errorSystem.isActive && window.errorSystem.isActive()) return 'ER'
    var dpo = document.getElementById('dispatch-overlay')
    if (dpo) {
      var shown = dpo.classList.contains('dpo-open') ||
                  (dpo.style && dpo.style.display && dpo.style.display !== 'none')
      if (shown && !dpo.classList.contains('dpo-closing')) return 'dispatch-overlay'
    }
    if (document.querySelector('#dispatch-monitor.dp-active, .dp-panel.dp-active')) return 'dispatch-inline'
    if (document.querySelector('#survey-monitor.sv-active, .sv-panel.sv-active')) return 'survey'
    if (document.querySelector('#valve-monitor.vm-active, .vm-panel.vm-active, .valve-panel.vm-active')) return 'valve'
    return null
  }
  window._whatBlocks = _whatBlocks
  function _isMiniGameActive() {
    /* Active ER blocks new spawns and holds the shift-end ticker open
       so the player can finish unlocking it. */
    if (window.errorSystem && window.errorSystem.isActive && window.errorSystem.isActive()) return true
    /* Dispatch overlay visible = active call */
    var dpo = document.getElementById('dispatch-overlay')
    if (dpo) {
      var shown = dpo.classList.contains('dpo-open') ||
                  (dpo.style && dpo.style.display && dpo.style.display !== 'none')
      if (shown && !dpo.classList.contains('dpo-closing')) return true
    }
    /* Inline dispatch panel (if still present) */
    if (document.querySelector('#dispatch-monitor.dp-active, .dp-panel.dp-active')) return true
    /* Survey mini-game */
    if (document.querySelector('#survey-monitor.sv-active, .sv-panel.sv-active')) return true
    /* Valve Manager mini-game */
    if (document.querySelector('#valve-monitor.vm-active, .vm-panel.vm-active, .valve-panel.vm-active')) return true
    return false
  }

  /* Public API — getCurrentTime() used by _lsAdd and external callers. */
  var gameClock = { getCurrentTime: _gcTime }

  _gcPaint()                                          // set display to 22:00 immediately
  _gcInterval = setInterval(_gcTick, 1000)            // advance one game-minute per second

  /* ═══════════════════════════════════════════════════════════════════
     TIME CONTROL — player-facing speed keys
       [  slower   (cycles 1× → 0.5×)
       ]  faster   (cycles 1× → 2× → 4×)
       0  reset to 1×
     Only the game-clock and system-deterioration ticks are rescaled;
     mini-game sequencing intervals keep real-time feel on purpose.
     ═══════════════════════════════════════════════════════════════════ */
  var _gcSpeed      = 1
  var _systemInterval = null

  function _installTicks() {
    /* Tear down any existing tick handles (including the original
       systemTick started above line 791). */
    if (_gcInterval)         { clearInterval(_gcInterval);         _gcInterval = null }
    if (_systemInterval)     { clearInterval(_systemInterval);     _systemInterval = null }
    if (_systemTickHandle)   { clearInterval(_systemTickHandle);   _systemTickHandle = null }
    if (_gcSpeed <= 0) return
    var period = Math.max(40, Math.round(1000 / _gcSpeed))
    _gcInterval     = setInterval(_gcTick, period)
    _systemInterval = setInterval(systemTick, period)
  }

  /* While the game is "frozen" (e.g. during a dispatch take-over),
     _frozenSpeed remembers the player's chosen pace so we can resume
     at the same speed afterwards. Speed buttons clicked DURING a
     freeze update _frozenSpeed only — the change applies on resume. */
  var _frozenSpeed = null

  function _setSpeed(mult) {
    if (_frozenSpeed != null) {
      _frozenSpeed = mult
      _showSpeedBadge()
      return
    }
    _gcSpeed  = mult
    _installTicks()
    _showSpeedBadge()
  }

  /* Pause the game-clock + system deterioration ticks while keeping
     UI alive. Used by dispatch (full-screen take-over) so the shift
     clock doesn't run past 06:00 while the operator is on the radio. */
  function _freezeGameTime() {
    if (_frozenSpeed != null) return     // already frozen
    _frozenSpeed = _gcSpeed
    _gcSpeed     = 0
    _installTicks()                       // tears down (guard at top)
    /* Pause the ER auto-spawn scheduler so an ER can't surprise-fire
       in the moments after dispatch closes — that race traps the
       player at 06:00 because the new ER keeps _isMiniGameActive true. */
    if (window.errorSystem && window.errorSystem.pauseScheduler) {
      window.errorSystem.pauseScheduler()
    }
  }
  function _unfreezeGameTime() {
    if (_frozenSpeed == null) return
    _gcSpeed     = _frozenSpeed
    _frozenSpeed = null
    _installTicks()
    /* Defensive: if shift end was reached while frozen and nothing is
       holding it open anymore, fire endShift now so we never get stuck
       at 06:00 with deteriorating systems and no exit. */
    if (_gcElapsed >= _gcDuration && !_isMiniGameActive()) {
      if (_gcInterval) { clearInterval(_gcInterval); _gcInterval = null }
      endShift()
      return    // skip ER resume — shift is over
    }
    /* Resume ER scheduler with a fresh interval (next ER starts the
       full respawn delay from now, which is the friendliest behavior
       for the player after a long dispatch). */
    if (window.errorSystem && window.errorSystem.resumeScheduler) {
      window.errorSystem.resumeScheduler()
    }
  }
  /* Exposed so the dispatch IIFE (and any future take-over UI) can
     stop / resume background time. */
  window.__gameTime = { freeze: _freezeGameTime, unfreeze: _unfreezeGameTime }

  /* ── Crash-recovery autosave — periodic snapshot every 60 game-min
        (~1 game-hour worth of progress). Written via the saveSystem
        autosave API. Cleared by endShift on clean shift completion.
        Distinct from the canonical thermalSave so a crash doesn't
        retroactively corrupt the player's career save. */
  ;(function autosaveTicker() {
    if (!window.saveSystem || !window.saveSystem.writeAutosave) return
    var nativeSI = (typeof _origSI === 'function') ? _origSI : window.setInterval
    /* Write every 30 real seconds — survives crashes within that
       window, doesn't hammer storage. */
    nativeSI(function () {
      if (_shiftEnded) return
      try {
        window.saveSystem.writeAutosave({
          saveSnapshot: (window.saveSystem.loadGame && window.saveSystem.loadGame()) || null,
          shiftSnapshot: {
            gcElapsed:        _gcElapsed,
            erBonusTotal:     gameState.erBonusTotal,
            ersResolved:      gameState.ersResolved,
            correctDecisions: gameState.correctDecisions,
            wrongDecisions:   gameState.wrongDecisions,
            missedAnomalies:  gameState.missedAnomalies,
            totalCritSeconds: gameState.totalCritSeconds,
            ventCount:        gameState.ventCount,
            ventRads:         gameState.ventRads,
          },
          timestamp: Date.now()
        })
      } catch (e) {}
    }, 30000)
  })()

  /* Speed-scaled spawn delay helper. Spawn timers (anomaly / CRM /
     valve / ER scheduler) are scheduled in REAL ms but the player
     experiences time at GAME speed — so at 4× the screen feels
     dead between events. Dividing by _gcSpeed at scheduling time
     keeps event density roughly constant in game-minutes regardless
     of speed. Speed changes mid-wait accept slight inaccuracy.
     Floor at 500 ms so we never schedule absurdly fast bursts. */
  function _spawnMs(realMs) {
    var spd = (typeof _gcSpeed === 'number' && _gcSpeed > 0) ? _gcSpeed : 1
    return Math.max(500, Math.floor(realMs / spd))
  }
  /* Expose to error-system.js's auto-spawn scheduler */
  window.__spawnMs = _spawnMs

  /* ═══════════════════════════════════════════════════════════════════
     BULLETPROOF SHIFT-END WATCHDOG (mini-game aware)
     Force-ends the shift only if it has been stuck WITHOUT a legitimate
     mini-game in progress. This protects against the original bug
     (dispatch-overlay stuck visible after _active was nulled) without
     ripping the player out of an actively-played survey / valve / CRM
     / ER they haven't finished yet.
     - If blocker is null: end after 5s (something else is wrong).
     - If blocker is dispatch-overlay / dispatch-inline AND no _active:
         end after 8s (the dispatch-stuck pathology).
     - If blocker is survey / valve / ER (legitimate mini-game):
         NEVER force-end. Let the player finish.
     ═══════════════════════════════════════════════════════════════════ */
  var _stuckTicks = 0
  ;(function installShiftEndWatchdog() {
    var nativeSI = (typeof _origSI === 'function') ? _origSI : window.setInterval
    nativeSI(function () {
      if (_shiftEnded) return
      if (typeof _gcElapsed !== 'number' || typeof _gcDuration !== 'number') return
      if (_gcElapsed < _gcDuration) {
        _stuckTicks = 0
        return
      }

      var blocker = _whatBlocks()

      /* Legitimate mini-games — let the player finish. */
      if (blocker === 'survey' || blocker === 'valve' || blocker === 'ER') {
        _stuckTicks = 0   // reset; we're not "stuck", we're waiting
        return
      }

      _stuckTicks++

      /* Pathological dispatch-overlay-stuck case → 8s timeout. */
      var isDispatchStuck = (blocker === 'dispatch-overlay' || blocker === 'dispatch-inline')
      var threshold = isDispatchStuck ? 8 : 5

      if (_stuckTicks >= threshold) {
        console.warn('[WATCHDOG] shift stuck at 06:00 for ' + _stuckTicks + 's — force-ending. blocker was:', blocker)
        try { _lsAdd('// WATCHDOG — shift force-ended. Blocker: ' + (blocker || 'unknown'), 'warning') } catch(e){}
        if (window.errorSystem && window.errorSystem.isActive && window.errorSystem.isActive()) {
          try { window.errorSystem.cancel() } catch(e){}
        }
        if (_frozenSpeed != null) {
          try { _unfreezeGameTime() } catch(e){}
        }
        if (_gcInterval) { clearInterval(_gcInterval); _gcInterval = null }
        try { endShift() } catch(e){ console.error('[WATCHDOG] endShift threw:', e) }
        _stuckTicks = 0
      }
    }, 1000)
  })()

  /* On-screen speed badge (auto-hides) */
  var _speedBadge = null
  var _speedBadgeTimer = null
  function _ensureSpeedBadge() {
    if (_speedBadge) return _speedBadge
    _speedBadge = document.createElement('div')
    _speedBadge.id = 'game-speed-badge'
    _speedBadge.style.cssText =
      'position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'font-family:"VT323",monospace;font-size:22px;letter-spacing:3px;' +
      'color:var(--amber,#ffb830);background:rgba(10,16,4,0.88);' +
      'border:1px solid var(--amber,#ffb830);padding:4px 18px;' +
      'text-shadow:0 0 6px currentColor;opacity:0;' +
      'transition:opacity 0.25s;pointer-events:none;'
    document.body.appendChild(_speedBadge)
    return _speedBadge
  }
  function _showSpeedBadge() {
    var el = _ensureSpeedBadge()
    var label
    if      (_gcSpeed === 1)    label = '▶ 1×'
    else                        label = '▶▶ ' + _gcSpeed + '×'
    el.textContent = label
    el.style.opacity = '1'
    if (_speedBadgeTimer) clearTimeout(_speedBadgeTimer)
    _speedBadgeTimer = setTimeout(function() {
      if (_gcSpeed === 1) el.style.opacity = '0'
      else el.style.opacity = '0.55'   // stay visible but dim when non-normal
    }, 1500)
    _syncSpeedButtons()
  }

  /* Sync visual state of the header speed buttons */
  function _syncSpeedButtons() {
    var btns = document.querySelectorAll('.speed-btn')
    btns.forEach(function(b) {
      b.classList.remove('speed-active')
      var s = b.getAttribute('data-speed')
      if (s === String(_gcSpeed)) b.classList.add('speed-active')
    })
  }

  /* Wire header buttons */
  ;(function wireSpeedButtons() {
    var btns = document.querySelectorAll('.speed-btn')
    btns.forEach(function(b) {
      b.addEventListener('click', function() {
        var s = b.getAttribute('data-speed')
        _setSpeed(parseFloat(s))
      })
    })
    _syncSpeedButtons()
  })()

  document.addEventListener('keydown', function(e) {
    /* Ignore while typing in inputs (none currently, but future-proof) */
    var tag = (e.target && e.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    /* Block while meltdown/end screens */
    if (gameState && gameState.systemFailure) return

    var speedList = [0.5, 1, 2, 4]
    /* Step bracket controls (always-on) */
    if (e.key === ']' || e.key === '+') {
      e.preventDefault()
      var i = speedList.indexOf(_gcSpeed)
      if (i < speedList.length - 1) _setSpeed(speedList[i + 1])
      return
    }
    if (e.key === '[' || e.key === '-') {
      e.preventDefault()
      var j = speedList.indexOf(_gcSpeed)
      if (j > 0) _setSpeed(speedList[j - 1])
      return
    }
    /* Direct speed selection — rebindable via window.keybinds.
       Defaults are '1', '2', '4'. Falls back to those literals if
       the keybinds module didn't load. */
    var kb = window.keybinds
    function hit(act, lit) { return kb ? kb.matches(e, act) : (e.key === lit) }
    if (hit('speed1', '1')) { e.preventDefault(); _setSpeed(1) }
    else if (hit('speed2', '2')) { e.preventDefault(); _setSpeed(2) }
    else if (hit('speed3', '4')) { e.preventDefault(); _setSpeed(4) }
    else if (e.key === '0') { _setSpeed(1) }
  })

  /* ═══════════════════════════════════════════════════════════════════
     LOG SYSTEM — flat declarations (no IIFE)
     _lsAdd(msg, category)   — internal + used by addLog wrapper above
     addLogEntry(msg, cat)   — global alias for external callers
     ═══════════════════════════════════════════════════════════════════ */

  var _lsEl          = document.getElementById('log-entries')
  var _lsMax         = 80
  var _lsAutoScroll  = true
  var _lsNewBadge    = document.getElementById('log-new-entries')

  function _lsAtBottom() {
    return _lsEl.scrollTop >= _lsEl.scrollHeight - _lsEl.clientHeight - 20
  }

  function _lsAdd(msg, category) {
    if (!_lsEl) return
    var ts  = _gcTime()
    var div = document.createElement('div')
    div.className = 'log-entry ' + (category || 'normal')
    div.innerHTML = '<span class="timestamp">' + ts + '</span> — ' + msg
    _lsEl.appendChild(div)
    while (_lsEl.children.length > _lsMax) _lsEl.removeChild(_lsEl.firstChild)
    if (_lsAutoScroll) {
      _lsEl.scrollTop = _lsEl.scrollHeight
    } else {
      if (_lsNewBadge) _lsNewBadge.classList.add('visible')
    }
    /* Subtle tick for each new log entry. Skipped for 'warning' and
       'anomaly' categories because they get bigger alert sounds from
       the status-transition handler, and a second tick on top would
       muddy those. */
    if (window.hoverSfx && typeof window.hoverSfx.log === 'function') {
      if (category !== 'warning' && category !== 'anomaly') window.hoverSfx.log()
    }
  }

  /* Smart auto-scroll: pause when player scrolls up, resume at bottom. */
  _lsEl.addEventListener('scroll', function() {
    if (_lsAtBottom()) {
      _lsAutoScroll = true
      if (_lsNewBadge) _lsNewBadge.classList.remove('visible')
    } else {
      _lsAutoScroll = false
    }
  })

  if (_lsNewBadge) {
    _lsNewBadge.addEventListener('click', function() {
      _lsAutoScroll = true
      _lsEl.scrollTop = _lsEl.scrollHeight
      _lsNewBadge.classList.remove('visible')
    })
  }

  var logSystem = { addEntry: _lsAdd }

  function addLogEntry(msg, category) { _lsAdd(msg, category) }

  /* ── Shift-start entries ─────────────────────────────────────────── */
  _lsAdd('Shift 3 handover accepted. Previous operator departed 21:58.', 'system')
  _lsAdd('Unit 4 parameters within operating envelope. Night-shift monitoring commenced.', 'normal')

  /* ── EARLY-SHIFT QUICKEN — applies to EVERY shift. Halves the
        first-spawn delays for anomaly/CRM/valve so the player
        actually has something to do in the first few real minutes
        instead of staring at static gauges. The respawn intervals
        AFTER the first event are unchanged — pacing only tightens
        the opening. */
  ;(function quickenEarlyShift() {
    if (!_B) return
    _B.anomFirstMs    = Math.min(_B.anomFirstMs,  60000)   // 60 s real, was 180 s
    _B.anomFirstRnd   = Math.min(_B.anomFirstRnd, 30000)
    _B.crmFirstMs     = Math.min(_B.crmFirstMs,   90000)   // 90 s, was 240 s
    _B.crmFirstRnd    = Math.min(_B.crmFirstRnd,  60000)
    _B.vmFirstMs      = Math.min(_B.vmFirstMs,   120000)   // 120 s, was 300 s
    _B.vmFirstRnd     = Math.min(_B.vmFirstRnd,   90000)
  })()

  /* ── EARLY FLAVOR CHATTER — periodic system noise in the first
        few real minutes so the log feels alive even before the
        first interactive event. Status / sensor / log-roll style
        lines, no action required from the player. Stops once an
        anomaly fires or 5 real minutes elapse. */
  ;(function ambientChatter() {
    var FLAVOR = [
      '// auto-cal: SEN.A flow trim within ±0.02 m/s.',
      '// coolant pump CP-3 vibration: nominal.',
      '// lighting circuit LP-2 cycling complete.',
      '// network: facility intranet idle. Last sync 21:54.',
      '// rack ventilation: 18 °C — within tolerance.',
      '// shift register: previous operator clock-out logged 21:58.',
      '// SEN.B differential: 0.04 — drift below logging threshold.',
      '// turbine bearing temp: 48 °C, nominal.',
      '// service tunnel motion sensor: idle.',
      '// telemetry uplink heartbeat: ok.',
      '// BIOS audit: no integrity errors.',
      '// containment door MAG-7: SEAL CONFIRMED.',
      '// ozone scrubber: operating window 87 %.',
      '// environmental log mark.'
    ]
    var fired = 0
    var maxLines = 8
    var stopAt = Date.now() + 5 * 60 * 1000   // 5 real-min cap
    function tick() {
      if (fired >= maxLines || Date.now() > stopAt) return
      if (_anom && _anom.active) return       // shut up once real action starts
      var line = FLAVOR[Math.floor(Math.random() * FLAVOR.length)]
      _lsAdd(line, 'normal')
      fired++
      var next = 12000 + Math.random() * 14000  // 12–26 s between
      setTimeout(tick, next)
    }
    /* Kick off after the orientation tips so the screen isn't a wall
       of text in the first ten seconds. */
    setTimeout(tick, 6000)
  })()

  /* ── SHIFT 1 ONBOARDING — only fires on the very first shift.
        Goal: orient the player to the four things they'll touch
        in this shift (resources, manual, anomaly buttons, Elena's
        existence) without creating a fake mini-game they don't
        know how to resolve. The first real anomaly arrives
        naturally a few minutes later. */
  ;(function shift1Intro() {
    if (!_save || (_save.shiftNumber || 1) !== 1) return

    /* 22:08 — resources */
    setTimeout(function () {
      _lsAdd('// ORIENTATION — Use the +/− buttons under TEMP / PRESS / POWER to move resources between systems. Total pool is fixed.', 'system')
    }, 8000)

    /* 22:18 — anomaly buttons (explicit) */
    setTimeout(function () {
      _lsAdd('// ORIENTATION — When a sensor flags ⚠, look at the gauge. If the reading looks WRONG, click [ ▲ ANOMALY REPORT ]. If you believe it is a routine fluctuation, click [ ✓ NORMAL ]. Both buttons sit in the action bar.', 'system')
    }, 18000)

    /* 22:28 — manual (with current keybind) */
    setTimeout(function () {
      var k = (window.keybinds ? window.keybinds.label('manual') : 'H')
      _lsAdd('// ORIENTATION — Press [' + k + '] at any time to open the PROCEDURE MANUAL. Mini-games and ER fixes are documented there.', 'system')
    }, 28000)

    /* 22:40 — Elena-channel one-liner. Tagged distinctly from the
       facility log noise so the player notices a personal voice
       has just appeared. */
    setTimeout(function () {
      _lsAdd('// PERSONAL — ELENA: First night. Don\'t push too hard. I left soup in the fridge.', 'normal')
    }, 40000)

    /* 22:55 — last orientation: housing + the unspoken rule */
    setTimeout(function () {
      _lsAdd('// ORIENTATION — At 06:00 you go home, eat, send rent. Miss rent three shifts in a row and the chair becomes someone else\'s. Try not to die. Good luck.', 'system')
    }, 55000)
  })()

  /* ── ADAPTIVE HINT SYSTEM — refund-prevention.
        New players freeze when the first ER fires. Without help they
        watch the reactor degrade and refund. This watchdog drops
        contextual hints into the log if the player appears stuck.
        Hints fire ONCE each per shift, only on shift 1 + 2 (after
        that the player either knows the game or has refunded). */
  ;(function adaptiveHints() {
    var sn = (_save && _save.shiftNumber) || 1
    if (sn > 2) return            // veteran territory; no hand-holding
    var fired = {}
    var nativeSI = (typeof _origSI === 'function') ? _origSI : window.setInterval
    nativeSI(function () {
      if (_shiftEnded) return
      var er = window.errorSystem
      var erActive = er && er.isActive && er.isActive()
      var current  = er && er.getCurrent && er.getCurrent()
      var manualOpen = window.manualOverlay && window.manualOverlay.isOpen && window.manualOverlay.isOpen()

      /* Hint 1 — ER fired and player hasn't opened the manual within 20s */
      if (erActive && current && !manualOpen && !fired.h1) {
        var elapsedMs = Date.now() - (current.code && current.code._fireTime || 0)
        /* Approximate elapsed via a separate check: if hint hasn't fired
           in 20s of ER, assume player is stuck. Use simple counter. */
        fired._erTicks = (fired._erTicks || 0) + 5
        if (fired._erTicks >= 20) {
          _lsAdd('// HINT — A SYSTEM ERROR is active. Press [' +
                 (window.keybinds ? window.keybinds.label('manual') : 'H') +
                 '] to open the manual; the prescription for this code is in there.', 'warning')
          fired.h1 = true
        }
      }
      if (!erActive) fired._erTicks = 0

      /* Hint 2 — ER active for ≥40s (estimated), still not solved */
      if (erActive && fired.h1 && !fired.h2) {
        fired._erTicks2 = (fired._erTicks2 || 0) + 5
        if (fired._erTicks2 >= 40) {
          _lsAdd('// HINT — Apply the four conditions in the manual: POWER value, PRESSURE value, then click VALVES and SURVEY cells in order.', 'warning')
          fired.h2 = true
        }
      }
      if (!erActive) fired._erTicks2 = 0

      /* Hint 3 — any system has been CRIT for 30 game-sec */
      if (!fired.h3 && gameState.critSeconds) {
        var cs = gameState.critSeconds
        var maxCrit = Math.max(cs.sicaklik || 0, cs.basinc || 0, cs.guc || 0)
        if (maxCrit >= 30) {
          _lsAdd('// HINT — A system has been CRITICAL for too long. Use the +/− buttons under that gauge to allocate more resources to it.', 'warning')
          fired.h3 = true
        }
      }
    }, 5000)
  })()

  /* ── Previous operator note — fires once between 22:30–23:30 game time ── */
  setTimeout(function() {
    _lsAdd('[PREV.OP. LOG — 21:47] Noticed vibration in pump room near CP-3. Reported to foreman Ivanov. Told: normal. I do not think it is normal. — V. Morozov', 'system')
  }, 30000 + Math.floor(Math.random() * 60000))

  /* ── Routine log generator — randomised values with range-based responses ── */
  function _routineEntry() {
    function rnd(a, b, dec) {
      var v = a + Math.random() * (b - a)
      return dec ? parseFloat(v.toFixed(dec)) : Math.floor(v)
    }

    var GEN = [

      /* Coolant pump CP-3 flow (m/s) */
      function() {
        var v = rnd(2.5, 7.0, 1)
        if (v < 3.6) return 'Coolant pump CP-3 flow: ' + v + ' m/s — LOW. Pump speed setpoint raised.'
        if (v > 5.3) return 'Coolant pump CP-3 flow: ' + v + ' m/s — ELEVATED. Throttle valve partially closed.'
        return 'Coolant pump CP-3 flow verified: ' + v + ' m/s. No deviation.'
      },

      /* Control rod bank D position (cm) */
      function() {
        var v = rnd(70, 112)
        if (v < 85)  return 'Control rod bank D: inserted ' + v + ' cm — below target. Withdrawal sequence initiated.'
        if (v > 100) return 'Control rod bank D: inserted ' + v + ' cm — DEEP insertion. Reactivity monitor standby.'
        return 'Control rod bank D: inserted ' + v + ' cm. Position confirmed.'
      },

      /* Primary circuit pressure (bar) */
      function() {
        var v = rnd(140, 176, 1)
        if (v < 153) return 'Primary circuit pressure: ' + v + ' bar — LOW. Pressurizer heaters activated.'
        if (v > 163) return 'Primary circuit pressure: ' + v + ' bar — ELEVATED. Pressurizer spray valve opened.'
        return 'Primary circuit pressure: ' + v + ' bar. Within tolerance.'
      },

      /* Steam generator SG-2 level (%) */
      function() {
        var v = rnd(58, 86)
        if (v < 67) return 'Steam generator SG-2 level: ' + v + '% — LOW. Feedwater flow rate increased.'
        if (v > 78) return 'Steam generator SG-2 level: ' + v + '% — HIGH. Feedwater throttled.'
        return 'Steam generator SG-2 level stable at ' + v + '%. No deviation.'
      },

      /* Reactor neutron flux (×10¹³ n/cm²·s) */
      function() {
        var v = rnd(2.8, 4.2, 2)
        if (v < 3.25) return 'Neutron flux ch.12: ' + v + ' ×10¹³ n/cm²·s — below setpoint. Control rod withdrawal initiated.'
        if (v > 3.70) return 'Neutron flux ch.12: ' + v + ' ×10¹³ n/cm²·s — ABOVE setpoint. Rod insertion 2 cm.'
        return 'Reactor neutron flux ch.12: ' + v + ' ×10¹³ n/cm²·s. Nominal.'
      },

      /* Turbine hall temperature (°C) */
      function() {
        var v = rnd(27, 48)
        if (v < 32) return 'Turbine hall temperature: ' + v + '°C — below normal. HVAC output increased.'
        if (v > 40) return 'Turbine hall temperature: ' + v + '°C — WARM. Ventilation rate increased.'
        return 'Turbine hall temperature: ' + v + '°C. Ventilation circuits normal.'
      },

      /* Boric acid concentration (mg/kg) */
      function() {
        var v = rnd(680, 862)
        if (v < 748) return 'Boric acid concentration: ' + v + ' mg/kg — below target. Makeup system activated.'
        if (v > 808) return 'Boric acid concentration: ' + v + ' mg/kg — HIGH. Dilution sequence initiated.'
        return 'Boric acid concentration: ' + v + ' mg/kg. Record logged.'
      },

      /* Radiation area monitor RAM-6 (mSv/h) */
      function() {
        var v = rnd(0.14, 0.52, 2)
        if (v > 0.36) return 'Radiation area monitor RAM-6: ' + v + ' mSv/h — ELEVATED. Area inspection dispatched.'
        return 'Radiation area monitor RAM-6: ' + v + ' mSv/h. Below threshold.'
      },

      /* Primary coolant delta-T (°C) */
      function() {
        var v = rnd(11, 35)
        if (v < 17) return 'Primary coolant ΔT: ' + v + '°C — LOW. Thermal output check initiated.'
        if (v > 27) return 'Primary coolant ΔT: ' + v + '°C — HIGH. Secondary flow rate increased.'
        return 'Primary coolant ΔT: ' + v + '°C. Heat transfer nominal.'
      },

      /* Feed pump FP-2 discharge pressure (bar) */
      function() {
        var v = rnd(61, 96)
        if (v < 71) return 'Feed pump FP-2 discharge: ' + v + ' bar — LOW. Speed setpoint raised.'
        if (v > 84) return 'Feed pump FP-2 discharge: ' + v + ' bar — ELEVATED. Relief valve check logged.'
        return 'Feed pump FP-2 discharge pressure: ' + v + ' bar. Nominal.'
      },

      /* Containment atmosphere humidity (%) */
      function() {
        var v = rnd(27, 65)
        if (v < 37) return 'Containment humidity: ' + v + '% — DRY. Moisture monitoring flag raised.'
        if (v > 54) return 'Containment humidity: ' + v + '% — ELEVATED. Ventilation rate adjusted.'
        return 'Containment atmosphere humidity: ' + v + '%. Within parameters.'
      },

      /* Valve V-114 actuation time (s) */
      function() {
        var v = rnd(1.0, 2.4, 1)
        if (v > 1.55) return 'Valve V-114 cycle test: ' + v + ' s — SLUGGISH. Actuator maintenance flag raised.'
        return 'Valve V-114 cycle test complete. Actuation time: ' + v + ' s. Nominal.'
      },

      /* Condenser vacuum (mbar — lower is better) */
      function() {
        var v = rnd(34, 66)
        if (v > 52) return 'Condenser vacuum: ' + v + ' mbar — POOR. Air ejector rate increased.'
        return 'Condenser vacuum: ' + v + ' mbar. Within tolerance.'
      },

      /* Makeup water tank level (%) */
      function() {
        var v = rnd(37, 89)
        if (v < 52) return 'Makeup water tank: ' + v + '% — LOW. Refill request submitted to auxiliary ops.'
        if (v > 78) return 'Makeup water tank: ' + v + '%. Transfer to drain line initiated.'
        return 'Makeup water tank level: ' + v + '%. Nominal.'
      },

      /* Emergency feedwater valve EFV-07 */
      function() {
        var roll = Math.random()
        if (roll < 0.08) return 'Emergency feedwater valve EFV-07: position indicator FAULT. Manual verification required.'
        if (roll < 0.18) return 'Emergency feedwater valve EFV-07: cycling — scheduled test in progress. Standby.'
        return 'Emergency feedwater valve EFV-07: closed, sealed. Standby confirmed.'
      },

      /* Coolant loop A outlet temperature (°C) */
      function() {
        var v = rnd(293, 332, 1)
        if (v < 304) return 'Coolant loop A outlet: ' + v + '°C — LOW. Thermal setpoint check underway.'
        if (v > 321) return 'Coolant loop A outlet: ' + v + '°C — HIGH. Flow rate being adjusted.'
        return 'Coolant loop A outlet temperature: ' + v + '°C. Nominal.'
      },

      /* Containment sump level (cm) */
      function() {
        var v = rnd(3, 28)
        if (v > 20) return 'Containment sump level: ' + v + ' cm — RISING. Sump pump activated. Source under investigation.'
        return 'Containment sump level: ' + v + ' cm. Nominal.'
      },

      /* Diesel generator DG-1 standby check */
      function() {
        var roll = Math.random()
        if (roll < 0.12) return 'Diesel generator DG-1 standby test: START delay ' + rnd(3,9) + ' s — marginal. Maintenance notified.'
        return 'Diesel generator DG-1 standby test: ready. Start time ' + rnd(1,2,1) + ' s. Nominal.'
      },

      /* Spent fuel pool temperature (°C) */
      function() {
        var v = rnd(28, 52)
        if (v > 44) return 'Spent fuel pool temperature: ' + v + '°C — WARM. Cooling pump duty cycle increased.'
        return 'Spent fuel pool temperature: ' + v + '°C. Cooling nominal.'
      },

    ]

    return GEN[Math.floor(Math.random() * GEN.length)]()
  }

  function _scheduleRoutine() {
    setTimeout(function() {
      _lsAdd(_routineEntry(), 'normal')
      _scheduleRoutine()
    }, 15000 + Math.floor(Math.random() * 10000))
  }

  _scheduleRoutine()

  /* ═══════════════════════════════════════════════════════════════════
     ANOMALY SYSTEM
     ─────────────────────────────────────────────────────────────────
     Lifecycle
       _anomSpawn()       picks a type (30 % chance false alarm),
                          calls triggerAnomaly(), logs a CONFLICT entry,
                          enables the two action buttons, starts 90 s timer.
       _anomDecide(bool)  player presses a button (true = report).
       _anomEscalate(n)   missed deadline → intensify (stage 1, 90 s)
                          then auto-fail  (stage 2, +60 s).
     ═══════════════════════════════════════════════════════════════════ */

  /* ── Active anomaly tracking ─────────────────────────────────────── */
  var _anom = {
    active:      false,
    isFake:      false,   // true = plain false alarm (no clue)
    isLogClue:   false,   // true = LOG_CLUE false alarm (sensor fires, clue was planted)
    sensorId:    null,
    valueKey:    null,
    decideTimer: null,
    escTimer:    null,
    stage:       0,
    severity:    1.0,     // Sprint 2 (B) — set per-spawn in real branch
    targetSys:   null,    // Sprint 2 (B)
    reasons:     [],      // Sprint 2 (B)
  }

  /* Sprint 2 (B) helper — find the most-recent anomaly event whose
     outcome is still 'pending' and stamp the given outcome. Fakes
     don't push events, so this safely no-ops for them. */
  function _setLastAnomalyOutcome(outcome) {
    if (!gameState || !Array.isArray(gameState.anomalyEvents)) return
    var arr = gameState.anomalyEvents
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].outcome === 'pending') {
        arr[i].outcome = outcome
        return
      }
    }
  }

  /* ── Button refs ─────────────────────────────────────────────────── */
  var _btnReport = document.getElementById('btn-anomaly-report')
  var _btnNormal = document.getElementById('btn-status-normal')

  /* ── Button enable / disable ─────────────────────────────────────── */
  function _anomSetButtons(enabled) {
    _btnReport.disabled = !enabled
    _btnNormal.disabled = !enabled
    _btnReport.classList.toggle('btn-disabled', !enabled)
    _btnNormal.classList.toggle('btn-disabled', !enabled)
  }

  /* ── Real-anomaly templates ────────────────────────────────────────
     Each carries a `baseSeverity` (1.0) and `targetSys` so the spawner
     can scale the decide window + escalation pressure by current
     reactor state (Sprint 2 — B). Severity multipliers come from
     player decisions: ignored demand-shift, valve penalty active,
     CRM out of sync, gauge already in warn/crit, sensor unreliable. */
  var ANOM_TYPES = [
    {
      sensorId: 'A', valueKey: 'flow', type: 1,
      targetSys: 'basinc',   baseSeverity: 1.0,
      logMsg: '⚠ CONFLICT: Line 2 flow log: 4.2 m/s — SEN.A reads 0.0 m/s. Total discrepancy.',
    },
    {
      sensorId: 'A', valueKey: 'valve', type: 2,
      targetSys: 'basinc',   baseSeverity: 1.0,
      logMsg: '⚠ CONFLICT: Valve V-114 log: CLOSED — SEN.A contact reads: OPEN.',
    },
    {
      sensorId: 'B', valueKey: 'coreTemp', type: 3,
      targetSys: 'sicaklik', baseSeverity: 1.0,
      logMsg: '⚠ CONFLICT: Core temperature declining — no coolant activation registered. SEN.B unresponsive.',
    },
    {
      sensorId: 'A', valueKey: 'temp', type: 4,
      targetSys: 'sicaklik', baseSeverity: 1.0,
      logMsg: '⚠ CONFLICT: SEN.A reads nominal — operator log parameters inconsistent. Source unknown.',
    },
  ]

  /* ── Severity calculator — reads current reactor state and
        compounds multipliers + collects human-readable reason
        strings the player sees in the log. Returns:
          { factor: Number, reasons: [String] }                       */
  function _calcAnomSeverity(targetSys, baseSeverity) {
    var factor  = baseSeverity || 1.0
    var reasons = []
    if (!targetSys || !gameState) return { factor: factor, reasons: reasons }

    var status = (gameState.systemStatus && gameState.systemStatus[targetSys]) || 'ok'
    if (status === 'warn') { factor *= 1.3; reasons.push('target system already in warn zone') }
    else if (status === 'crit') { factor *= 1.6; reasons.push('target system already CRITICAL') }

    /* Pressure-related anomaly with valve penalty active */
    if (targetSys === 'basinc' && gameState.valvePenalty) {
      factor *= 1.5
      reasons.push('valve subsystem unstable')
    }
    /* Temperature anomaly while CRM sync bonus is missing */
    if (targetSys === 'sicaklik' && !gameState.freqBonus) {
      factor *= 1.2
      reasons.push('coolant resonance out of sync')
    }
    /* Demand-shift active on the target system and operator failed
       to reallocate → ×1.4 (matches existing _demandShift behaviour) */
    if (_demandShift && _demandShift.active && _demandShift.system === targetSys) {
      var res = (gameState.resources && gameState.resources[targetSys]) | 0
      if (res < 4) {
        factor *= 1.4
        reasons.push('demand shift uncovered')
      }
    }
    /* Demand spike on the same system (Sprint earlier addition) */
    if (typeof _spike !== 'undefined' && _spike.active && _spike.system === targetSys) {
      factor *= 1.2
      reasons.push('demand spike concurrent')
    }
    /* Player ran the subsystem at low/crit power → sensor reliability
       degraded → anomaly response window shrinks further */
    var precTier = (typeof _precisionTierFor === 'function') ? _precisionTierFor(targetSys) : 'ok'
    if (precTier === 'low')   { factor *= 1.15; reasons.push('low-precision sensor reading') }
    if (precTier === 'crit')  { factor *= 1.3;  reasons.push('unreliable sensor reading') }

    /* Cap so brutal combos don't make decide window dip below 15 s */
    if (factor > 3.0) factor = 3.0
    return { factor: parseFloat(factor.toFixed(2)), reasons: reasons }
  }

  /* ── Plain false-alarm messages (no clue) ───────────────────────── */
  var FAKE_MSGS = [
    '⚠ CONFLICT: SEN.A read cycle delayed 14 s — transmission desynchronized. Verify.',
    '⚠ CONFLICT: Reactor outlet log: 308°C. Historical trend: 311°C. Delta 3°C — investigate.',
    '⚠ CONFLICT: Line 2 pressure transducer bouncing. Log shows stable. Manual check required.',
  ]

  /* ── LOG_CLUE templates ──────────────────────────────────────────── */
  /*  Each entry: sensorId/valueKey/type for triggerAnomaly,
      conflictMsg shown when the sensor fires (same style as real),
      clueMsg planted 60-90 s earlier in 'system' category.          */
  var LOG_CLUE_TYPES = [
    {
      sensorId: 'A', valueKey: 'flow', type: 1,
      conflictMsg: '⚠ CONFLICT: Line 2 flow log: 4.2 m/s — SEN.A reads 0.0 m/s. Total discrepancy.',
      clueMsg: 'Coolant flow sensor A scheduled recalibration. Brief zero-reading expected. No action required.',
    },
    {
      sensorId: 'A', valueKey: 'valve', type: 2,
      conflictMsg: '⚠ CONFLICT: Valve V-114 log: CLOSED — SEN.A contact reads: OPEN.',
      clueMsg: 'Valve B3 entering scheduled maintenance cycle. State indicator may show incorrectly during cycle.',
    },
    {
      sensorId: 'B', valueKey: 'coreTemp', type: 3,
      conflictMsg: '⚠ CONFLICT: Core temperature declining — no coolant activation registered. SEN.B unresponsive.',
      clueMsg: 'Planned thermal test in progress. Core temperature reduction is intentional.',
    },
    {
      sensorId: 'A', valueKey: 'temp', type: 4,
      conflictMsg: '⚠ CONFLICT: SEN.A reads nominal — operator log parameters inconsistent. Source unknown.',
      clueMsg: 'Sensor array diagnostic running. Temporary discrepancies between arrays are expected.',
    },
  ]

  /* ── _anomSpawn ──────────────────────────────────────────────────── */
  function _anomSpawn() {
    if (_anom.active || gameState.systemFailure) return
    /* Don't pile a sensor anomaly on top of an active ER. Reschedule
       a few seconds out so it surfaces shortly after the player clears
       the error. */
    if (window.errorSystem && window.errorSystem.isActive()) {
      setTimeout(_anomSpawn, 5000)
      return
    }
    _anom.active    = true
    _anom.stage     = 0
    _anom.isFake    = false
    _anom.isLogClue = false

    var roll = Math.random()

    if (roll < 0.40) {
      /* ── LOG_CLUE false alarm (40%) ─────────────────────────────── */
      _anom.isLogClue = true
      _anom.isFake    = true
      var tpl = LOG_CLUE_TYPES[Math.floor(Math.random() * LOG_CLUE_TYPES.length)]
      _anom.sensorId = tpl.sensorId
      _anom.valueKey = tpl.valueKey

      /* Plant the clue 60–90 s before the sensor fires */
      var clueDelay = _B.anomClueMin + Math.floor(Math.random() * _B.anomClueRnd)
      _lsAdd(tpl.clueMsg, 'system')

      /* Sensor fires after the clue delay */
      setTimeout(function() {
        if (!_anom.active || !_anom.isLogClue) return   // cleared early
        triggerAnomaly(tpl.sensorId, tpl.valueKey, tpl.type)
        _lsAdd(tpl.conflictMsg, 'conflict')
        /* Decision window starts NOW (when sensor fires) */
        _anom.decideTimer = setTimeout(function() { _anomEscalate(1) }, _B.anomDecide)
      }, clueDelay)

      /* Buttons become active immediately when the sensor fires.
         We use a small flag so _anomSetButtons is called from inside the timer. */
      /* Override: defer button enable until sensor fires. Disable now if they were on. */
      _anomSetButtons(false)
      /* The inner setTimeout above will call _anomSetButtons(true) — proxy via flag: */
      _anom._logClueTimer = setTimeout(function() {
        if (!_anom.active || !_anom.isLogClue) return
        _anomSetButtons(true)
      }, clueDelay)

    } else if (roll < 0.60) {
      /* ── Plain false alarm (20%) ─────────────────────────────────── */
      _anom.isFake   = true
      _anom.sensorId = null
      _anom.valueKey = null
      _lsAdd(FAKE_MSGS[Math.floor(Math.random() * FAKE_MSGS.length)], 'conflict')
      _anomSetButtons(true)
      _anom.decideTimer = setTimeout(function() { _anomEscalate(1) }, 90000)

    } else {
      /* ── Real anomaly (60%) ────────────────────────────────────────
            Sprint 2 (B): pick the template, compute a severity factor
            from current reactor state, shrink the operator's decide
            window proportionally, and surface the reason in the log
            so the player can trace cause-and-effect. */
      var tpl = ANOM_TYPES[Math.floor(Math.random() * ANOM_TYPES.length)]
      _anom.sensorId = tpl.sensorId
      _anom.valueKey = tpl.valueKey

      var sev = _calcAnomSeverity(tpl.targetSys, tpl.baseSeverity || 1.0)
      _anom.severity = sev.factor
      _anom.targetSys = tpl.targetSys
      _anom.reasons  = sev.reasons

      triggerAnomaly(tpl.sensorId, tpl.valueKey, tpl.type)
      _lsAdd(tpl.logMsg, 'conflict')
      _logAnom(tpl.logMsg, 'lo')

      /* If the severity escalator fired, append a short reason hint
         to the log so the player can connect this anomaly to their
         earlier decisions. Example:
           ⚠ ANOMALY — severity ×1.95 (valve subsystem unstable; demand shift uncovered) */
      if (sev.factor > 1.05 && sev.reasons.length > 0) {
        _lsAdd('⚠ ANOMALY — severity ×' + sev.factor.toFixed(2) +
               ' (' + sev.reasons.join('; ') + ')', 'warning')
      }

      /* Push to per-shift event log for the shift-end report. */
      if (Array.isArray(gameState.anomalyEvents)) {
        gameState.anomalyEvents.push({
          ts:        (typeof _gcTime === 'function') ? _gcTime() : '',
          sensor:    tpl.sensorId + '.' + tpl.valueKey,
          targetSys: tpl.targetSys,
          severity:  sev.factor,
          reasons:   sev.reasons.slice(),
          isFake:    false,
          outcome:   'pending'
        })
      }

      _anomSetButtons(true)
      /* Decide window scales inversely with severity. Severity 1.0
         keeps the legacy 90 s; severity 2.0 cuts to ~45 s; capped
         at minimum 25 s so even the worst combo stays playable. */
      var decideMs = Math.max(25000, Math.floor((_B.anomDecide || 90000) / sev.factor))
      _anom.decideTimer = setTimeout(function() { _anomEscalate(1) }, decideMs)
    }
  }

  /* ── _anomEscalate ───────────────────────────────────────────────── */
  function _anomEscalate(stage) {
    if (!_anom.active) return
    _anom.stage = stage

    if (stage === 1) {
      gameState.missedAnomalies++
      _lsAdd('⚠ OVERDUE: No operator response within 90 s. Situation advancing. Supervisor on standby.', 'warning')
      _logAnom('⚠ OVERDUE: No response within 90 s. Situation advancing.', 'lo')
      if (!_anom.isFake && _anom.sensorId) {
        var snsr = sensorState[_anom.sensorId]
        if (snsr.anomaly) { snsr.anomaly.escalated = true; renderSensor(_anom.sensorId) }
      }
      _anom.escTimer = setTimeout(function() { _anomEscalate(2) }, _B.anomStage1)

    } else if (stage === 2) {
      _lsAdd('⚠ FATAL: Anomaly unresolved. Automatic protocol initiated. Operator incident filed.', 'anomaly')
      _logAnom('⚠ FATAL: Anomaly unresolved. Automatic protocol initiated.', 'lo')
      _setLastAnomalyOutcome('escalated')
      _anomClear()
      setTimeout(_scheduleNextAnomaly, 5000)
    }
  }

  /* ── _anomClear — wipe state, no scheduling ──────────────────────── */
  function _anomClear() {
    clearTimeout(_anom.decideTimer)
    clearTimeout(_anom.escTimer)
    clearTimeout(_anom._logClueTimer)
    if (_anom.sensorId) resolveAnomaly(_anom.sensorId, _anom.valueKey)
    _anom.active      = false
    _anom.isFake      = false
    _anom.isLogClue   = false
    _anom.sensorId    = null
    _anom.valueKey    = null
    _anom.stage       = 0
    _anom._logClueTimer = null
    _anomSetButtons(false)
  }

  /* ── _anomDecide — player presses a button ───────────────────────── */
  function _anomDecide(isReport) {
    if (!_anom.active) return

    var btn = isReport ? _btnReport : _btnNormal
    btn.classList.add('btn-flash')
    setTimeout(function() { btn.classList.remove('btn-flash') }, 220)

    _anomSetButtons(false)
    clearTimeout(_anom.decideTimer)
    clearTimeout(_anom.escTimer)
    clearTimeout(_anom._logClueTimer)

    /* Correct:
       real anomaly   → isReport true
       plain fake     → isReport false
       LOG_CLUE fake  → isReport false (clue revealed it was scheduled) */
    var correct = _anom.isFake ? !isReport : isReport

    /* Update the latest tracked anomaly event's outcome — only real
       anomalies live in gameState.anomalyEvents, so fakes silently
       no-op via the pending guard. */
    _setLastAnomalyOutcome(correct ? 'correct' : 'wrong')

    if (correct) {
      gameState.correctDecisions++
      if (_anom.sensorId) resolveAnomaly(_anom.sensorId, _anom.valueKey)
      if (_anom.isLogClue) {
        _lsAdd('Operator assessment confirmed. No anomaly. Scheduled event as logged.', 'system')
        _logAnom('Operator assessment confirmed. No anomaly. Scheduled event as logged.', 'hi')
      } else {
        var _okMsg = isReport
          ? '✓ Anomaly logged and resolved. Supervisory system notified. Record updated.'
          : '✓ False alarm confirmed. Sensor transient only — no active anomaly. Log cleared.'
        _lsAdd(_okMsg, 'system')
        _logAnom(_okMsg, 'hi')
      }
    } else {
      gameState.wrongDecisions++
      if (_anom.sensorId) resolveAnomaly(_anom.sensorId, _anom.valueKey)
      if (_anom.isLogClue) {
        _lsAdd('False anomaly report filed. Operator error recorded. Review shift log.', 'warning')
        _logAnom('False anomaly report filed. Operator error recorded.', 'lo')
      } else {
        var _errMsg = isReport
          ? '✗ Report filed — post-review: no anomaly confirmed. Protocol deviation noted.'
          : '✗ Status cleared — anomaly was active. Escalation unmanned. Supervisor alerted.'
        _lsAdd(_errMsg, 'warning')
        _logAnom(_errMsg, 'lo')
      }
    }

    _anom.active    = false
    _anom.isFake    = false
    _anom.isLogClue = false
    _anom.sensorId  = null
    _anom.valueKey  = null
    _anom.stage     = 0

    setTimeout(_scheduleNextAnomaly, 3000)
  }

  /* ── Adaptive spawn scheduling ───────────────────────────────────── */
  function _scheduleNextAnomaly() {
    if (gameState.systemFailure) return
    var delay
    if      (_gcElapsed >= _B.anomEarlyEl) delay = _B.anomEarlyMin + Math.floor(Math.random() * _B.anomEarlyRnd)
    else if (_gcElapsed >= _B.anomMidEl)  delay = _B.anomMidMin   + Math.floor(Math.random() * _B.anomMidRnd)
    else                                  delay = _B.anomLateMin  + Math.floor(Math.random() * _B.anomLateRnd)
    /* Later shifts tighten anomaly spacing. Floor baked into the
       multiplier itself so delay never collapses to zero. */
    delay = Math.floor(delay * _shiftAnomMult)
    setTimeout(_anomSpawn, _spawnMs(delay))
  }

  /* ── Button listeners ────────────────────────────────────────────── */
  _btnReport.addEventListener('click', function() { if (_anom.active) _anomDecide(true)  })
  _btnNormal.addEventListener('click', function() { if (_anom.active) _anomDecide(false) })

  /* ── First anomaly: 180–300 s after shift start (shortened on later shifts).
        Speed-scaled so 4× actually means 4× sooner in real time. */
  setTimeout(_anomSpawn,
    _spawnMs(Math.floor((_B.anomFirstMs + Math.random() * _B.anomFirstRnd) * _shiftAnomMult)))

  /* ═══════════════════════════════════════════════════════════════════
     COOLANT RESONANCE MONITOR — always-on bottom bar (idle / active modes)
     ─────────────────────────────────────────────────────────────────
     IDLE   : waves always draw; target drifts continuously toward a
              destination that changes every 20-30 s.
              SYNC ≥ 90 % → gameState.freqBonus (-10 % TEMP rate).
     ACTIVE : 60 s countdown + confirm btn.
     PENALTY: tracked by _fcPenaltyTick every second.
              L1 @30 s <50%: +20 % TEMP rate.
              L2 @90 s <50%: triggerAnomaly('A','flow',1).
              L3 @120s <50%: permanent +15 % TEMP rate (_fcPermDebuff).
              L1/L2 reset when sync recovers; L3 never resets.
     DRIFT SPEED (Hz/s):  22-00 → 0.02  |  00-03 → 0.05  |  03-06 → 0.09
     ═══════════════════════════════════════════════════════════════════ */

  /* ── State ───────────────────────────────────────────────────────── */
  var _fcMode        = 'idle'
  var _fcTargetFreq  = 2.4   // current drawn target (moves toward dest)
  var _fcTargetAmp   = 0.8
  var _fcDestFreq    = 2.4   // drift destination (chosen every 20-30 s)
  var _fcDestAmp     = 0.8
  var _fcPlayerFreq  = 2.4   // player starts in sync
  var _fcPlayerAmp   = 0.8
  var _fcSecondsLeft = 60
  var _fcTimerInt    = null
  var _fcRafId       = null
  var _fcAnimStart   = null
  var _fcLastTs      = null  // previous RAF timestamp for dt
  var _fcDriftTimer  = null

  /* Penalty state */
  var _fcLowSyncSecs  = 0     // seconds below 50 % (resets on recovery)
  var _fcPenaltyLevel = 0     // 0-3; levels 1-2 reset on recovery
  var _fcPermDebuff   = false // set to true by level 3; never resets

  /* ── Element refs ────────────────────────────────────────────────── */
  var _fmTitleEl  = document.getElementById('fm-title')
  var _fcCanvas   = document.getElementById('fc-canvas')
  var _fcTimerEl  = document.getElementById('fc-timer')
  var _fcFreqVal  = document.getElementById('fc-freq-val')
  var _fcAmpVal   = document.getElementById('fc-amp-val')
  var _fcMatchBar = document.getElementById('fc-match-bar')
  var _fcMatchLbl = document.getElementById('fc-match-label')
  var _fcConfirm  = document.getElementById('fc-confirm')
  var _fcMonitor  = document.getElementById('freq-monitor')

  /* ── Sync canvas pixel dimensions ───────────────────────────────── */
  function _fcSyncCanvas() {
    var w = _fcCanvas.offsetWidth  || 400
    var h = _fcCanvas.offsetHeight || 48
    if (_fcCanvas.width  !== w) _fcCanvas.width  = w
    if (_fcCanvas.height !== h) _fcCanvas.height = h
  }

  /* ── Match score 0–100 ───────────────────────────────────────────── */
  function _fcMatch() {
    var fDiff = Math.abs(_fcPlayerFreq - _fcTargetFreq)
    var aDiff = Math.abs(_fcPlayerAmp  - _fcTargetAmp)
    var score = 100 - (fDiff / 4.5 * 50 + aDiff / 1.9 * 50)
    return Math.max(0, Math.min(100, score))
  }

  /* ── Refresh freq-monitor UI (called on button press + 1 s tick) ──
     Note: the sync-label and horizontal bar are owned by _kvUpdate
     (80 ms interval). Touching them here caused a text/colour flicker
     because the two writers used different formats ("SYNC: 87%" vs
     "87%"). Keep only the readouts and game-state flag here. */
  function _fcRefresh() {
    var match = _fcMatch()
    _fcFreqVal.textContent  = _fcPlayerFreq.toFixed(1) + ' Hz'
    _fcAmpVal.textContent   = _fcPlayerAmp.toFixed(1)  + ' V'

    gameState.freqBonus = (match >= 85)

    if (_fcMode === 'active') {
      var ready = match >= 85
      _fcConfirm.disabled = !ready
      _fcConfirm.classList.toggle('fc-confirm-ready', ready)
      if (!ready) _mgFlagAlert('crm')
    }
  }

  /* ── Drift speed: Hz/s based on game-clock phase ────────────────── */
  function _fcDriftSpeed() {
    if      (_gcElapsed >= 300) return 0.09  // 03:00–06:00
    else if (_gcElapsed >= 120) return 0.05  // 00:00–03:00
    else                        return 0.02  // 22:00–00:00
  }

  /* ── Per-frame target movement toward destination ────────────────── */
  function _fcDriftStep(dt) {
    if (dt <= 0 || dt > 0.5) return   // skip huge gaps (tab switch, etc.)
    var fSpd = _fcDriftSpeed()
    var aSpd = fSpd * 0.60            // amp drifts at 60 % of freq speed

    var fDiff = _fcDestFreq - _fcTargetFreq
    if (Math.abs(fDiff) > 0.001)
      _fcTargetFreq += Math.min(Math.abs(fDiff), fSpd * dt) * (fDiff > 0 ? 1 : -1)

    var aDiff = _fcDestAmp - _fcTargetAmp
    if (Math.abs(aDiff) > 0.001)
      _fcTargetAmp  += Math.min(Math.abs(aDiff), aSpd * dt) * (aDiff > 0 ? 1 : -1)
  }

  /* ── Always-running oscilloscope RAF ────────────────────────────── */
  function _fcDraw(ts) {
    /* dt — capped to avoid huge jumps after tab-switches */
    var dt = (_fcLastTs !== null) ? (ts - _fcLastTs) / 1000 : 0
    _fcLastTs = ts
    if (!_fcAnimStart) _fcAnimStart = ts
    var elapsed = (ts - _fcAnimStart) / 1000

    /* Advance target toward its drift destination */
    _fcDriftStep(dt)

    /* Recompute freqBonus every frame — cheap, no DOM */
    gameState.freqBonus = (_fcMatch() >= 85)

    _fcSyncCanvas()
    var ctx = _fcCanvas.getContext('2d')
    var W   = _fcCanvas.width
    var H   = _fcCanvas.height
    var mid = H / 2

    ctx.clearRect(0, 0, W, H)

    /* Target wave — dim grey */
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(160,160,160,0.38)'
    ctx.lineWidth   = 1.5
    for (var x = 0; x <= W; x++) {
      var tx = (x / W) * 2.0 + elapsed * 0.5
      var ty = mid - (_fcTargetAmp * (H * 0.36)) * Math.sin(2 * Math.PI * _fcTargetFreq * tx)
      if (x === 0) ctx.moveTo(x, ty); else ctx.lineTo(x, ty)
    }
    ctx.stroke()

    /* Player wave — phosphor green with glow pass */
    for (var pass = 0; pass < 2; pass++) {
      ctx.beginPath()
      if (pass === 0) {
        ctx.strokeStyle = 'rgba(168,255,62,0.20)'
        ctx.lineWidth   = 6
        ctx.filter      = 'blur(3px)'
      } else {
        ctx.strokeStyle = '#a8ff3e'
        ctx.lineWidth   = 2
        ctx.filter      = 'none'
      }
      for (var x2 = 0; x2 <= W; x2++) {
        var px = (x2 / W) * 2.0 + elapsed * 0.5
        var py = mid - (_fcPlayerAmp * (H * 0.36)) * Math.sin(2 * Math.PI * _fcPlayerFreq * px)
        if (x2 === 0) ctx.moveTo(x2, py); else ctx.lineTo(x2, py)
      }
      ctx.stroke()
      ctx.filter = 'none'
    }

    _fcRafId = requestAnimationFrame(_fcDraw)
  }

  /* ── Active mode: countdown tick ─────────────────────────────────── */
  function _fcTimerTick() {
    _fcSecondsLeft--
    var m = Math.floor(_fcSecondsLeft / 60)
    var s = _fcSecondsLeft % 60
    _fcTimerEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    _fcTimerEl.className = 'fc-timer'
    if      (_fcSecondsLeft <= 10) _fcTimerEl.classList.add('fc-timer-crit')
    else if (_fcSecondsLeft <= 30) _fcTimerEl.classList.add('fc-timer-warn')
    if (_fcSecondsLeft <= 0) _fcFail()
  }

  /* ── Visual flash on freq-monitor panel ─────────────────────────── */
  function _fcFlash(cls) {
    _fcMonitor.classList.remove('fm-active', 'fm-flash-green', 'fm-flash-red')
    void _fcMonitor.offsetWidth
    _fcMonitor.classList.add(cls)
    setTimeout(function() { _fcMonitor.classList.remove(cls) }, 750)
  }

  /* ── Return to idle ──────────────────────────────────────────────── */
  function _fcReturnToIdle() {
    clearInterval(_fcTimerInt)
    _fcTimerInt    = null
    _fcMode        = 'idle'
    _fcTimerEl.style.display = 'none'
    _fcConfirm.style.display = 'none'
    _fcConfirm.disabled      = true
    _fcConfirm.classList.remove('fc-confirm-ready')
    _fcMonitor.classList.remove('fm-active')
    _fmTitleEl.textContent   = '// COOLANT RESONANCE MONITOR'
    _fmTitleEl.style.color   = ''
  }

  /* ── Success ─────────────────────────────────────────────────────── */
  function _fcSuccess() {
    gameState.freqCalSuccess++
    _fcReturnToIdle()
    _fcFlash('fm-flash-green')
    _lsAdd('CRM calibration complete. Primary loop nominal.', 'system')
    setTimeout(_scheduleNextFreqCal, 3000)
  }

  /* ── Failure ─────────────────────────────────────────────────────── */
  function _fcFail() {
    gameState.freqCalFail++
    _fcReturnToIdle()
    _fcFlash('fm-flash-red')
    _lsAdd('⚠ CRM calibration failed. Primary loop resonance unstable.', 'anomaly')
    if (!_anom.active && !gameState.systemFailure) triggerAnomaly('A', 'flow', 1)
    setTimeout(_scheduleNextFreqCal, 5000)
  }

  /* ── Switch to ACTIVE mode ───────────────────────────────────────── */
  function triggerFreqCalibration() {
    if (_fcMode === 'active' || _anom.active || gameState.systemFailure) return
    if (window.errorSystem && window.errorSystem.isActive()) {
      setTimeout(triggerFreqCalibration, 8000)
      return
    }

    _fcMode = 'active'

    /* New target; also update dest so drift starts from here */
    _fcTargetFreq = parseFloat((1.0 + Math.random() * 3.0).toFixed(1))
    _fcTargetAmp  = parseFloat((0.3 + Math.random() * 1.2).toFixed(1))
    _fcDestFreq   = _fcTargetFreq
    _fcDestAmp    = _fcTargetAmp

    _fcSecondsLeft         = 60
    _fcTimerEl.textContent = '01:00'
    _fcTimerEl.className   = 'fc-timer'
    _fcTimerEl.style.display = ''

    _fcConfirm.disabled = true
    _fcConfirm.classList.remove('fc-confirm-ready')
    _fcConfirm.style.display = 'block'

    _fmTitleEl.textContent = '// CRM CALIBRATION REQUIRED !'
    _fmTitleEl.style.color = 'var(--amber)'
    _fcMonitor.classList.add('fm-active')

    _fcTimerInt = setInterval(_fcTimerTick, 1000)
    _fcRefresh()

    _lsAdd('⚠ Coolant resonance deviation detected on primary loop. Manual calibration window open — 60 s.', 'warning')

    if (typeof _mgFlagAlert === 'function') _mgFlagAlert('crm')
  }

  /* ── Pick new drift destination every 20–30 s ───────────────────── */
  function _fcScheduleDrift() {
    _fcDriftTimer = setTimeout(function() {
      /* Pick a new destination within valid range */
      _fcDestFreq = parseFloat((0.8 + Math.random() * 3.7).toFixed(1))  // 0.8–4.5
      _fcDestAmp  = parseFloat((0.2 + Math.random() * 1.6).toFixed(1))  // 0.2–1.8
      _fcScheduleDrift()
    }, 20000 + Math.floor(Math.random() * 10000))
  }

  /* ── Sync penalty tracker — runs every real second ───────────────── */
  function _fcPenaltyTick() {
    var match = _fcMatch()

    if (match < 85) {
      _fcLowSyncSecs++

      /* Level 3 — permanent debuff (fires once, never again) */
      if (_fcLowSyncSecs >= 120 && !_fcPermDebuff) {
        _fcPenaltyLevel = 3
        _fcPermDebuff   = true
        _lsAdd('⚠ CRITICAL: Line 2 sustained signal loss for 120 s. Thermal coupling permanently degraded — shift penalty active.', 'anomaly')
      }
      /* Level 2 — trigger anomaly */
      else if (_fcLowSyncSecs >= 90 && _fcPenaltyLevel < 2) {
        _fcPenaltyLevel = 2
        _lsAdd('⚠ WARNING: Line 2 signal degraded for 90 s. Sensor reliability compromised. Anomaly probability elevated.', 'warning')
        if (!_anom.active && !gameState.systemFailure) triggerAnomaly('A', 'flow', 1)
      }
      /* Level 1 — deterioration penalty */
      else if (_fcLowSyncSecs >= 15 && _fcPenaltyLevel < 1) {
        _fcPenaltyLevel = 1
        _lsAdd('⚠ CRM hold below 75 % sustained 15 s. Coolant flow rate fluctuating.', 'warning')
      }

    } else {
      /* Sync recovered above 75 % — reset transient level.
         _fcPermDebuff is permanent and tracked independently. */
      if (_fcPenaltyLevel > 0) _fcPenaltyLevel = 0
      _fcLowSyncSecs = 0
    }

    /* Update SYNC display once per second */
    _fcRefresh()
  }

  /* ── Hold-to-repeat helper ───────────────────────────────────────── */
  function _fcHold(btn, action) {
    var _ht = null, _hi = null
    btn.addEventListener('mousedown', function() {
      action()
      _ht = setTimeout(function() { _hi = setInterval(action, 80) }, 380)
    })
    function _rel() { clearTimeout(_ht); clearInterval(_hi) }
    btn.addEventListener('mouseup',    _rel)
    btn.addEventListener('mouseleave', _rel)
  }

  /* ── Freq / Amp buttons — always interactive (both modes) ────────── */
  _fcHold(document.getElementById('fc-freq-minus'), function() {
    _fcPlayerFreq = parseFloat(Math.max(0.5, _fcPlayerFreq - 0.1).toFixed(1))
    _fcRefresh()
  })
  _fcHold(document.getElementById('fc-freq-plus'), function() {
    _fcPlayerFreq = parseFloat(Math.min(5.0, _fcPlayerFreq + 0.1).toFixed(1))
    _fcRefresh()
  })
  _fcHold(document.getElementById('fc-amp-minus'), function() {
    _fcPlayerAmp = parseFloat(Math.max(0.1, _fcPlayerAmp - 0.1).toFixed(1))
    _fcRefresh()
  })
  _fcHold(document.getElementById('fc-amp-plus'), function() {
    _fcPlayerAmp = parseFloat(Math.min(2.0, _fcPlayerAmp + 0.1).toFixed(1))
    _fcRefresh()
  })

  /* ── Confirm button ──────────────────────────────────────────────── */
  _fcConfirm.addEventListener('click', function() {
    if (_fcMode !== 'active' || _fcConfirm.disabled) return
    _fcSuccess()
  })

  /* ── Adaptive re-scheduling ──────────────────────────────────────── */
  function _scheduleNextFreqCal() {
    if (gameState.systemFailure) return
    setTimeout(triggerFreqCalibration, _spawnMs(_B.crmRespawnMs + Math.floor(Math.random() * _B.crmRespawnRnd)))
  }

  /* ── Boot ────────────────────────────────────────────────────────── */
  _fcRefresh()
  _fcRafId = requestAnimationFrame(_fcDraw)
  _fcScheduleDrift()
  setInterval(_fcPenaltyTick, 1000)
  setTimeout(triggerFreqCalibration, _spawnMs(_B.crmFirstMs + Math.floor(Math.random() * _B.crmFirstRnd)))

  /* ═══════════════════════════════════════════════════════════════════
     MINI-GAME TABS  (CRM / VALVES / SURVEY)
     DISPATCH no longer has a tab — it takes over the screen via the
     full-viewport overlay the moment a call comes in. _mgFlagAlert is
     still invoked with 'dispatch' from dispatch code; it no-ops safely
     because there is no entry in the tab registry.
     ═══════════════════════════════════════════════════════════════════ */
  var _mgTabCrm      = document.getElementById('mg-tab-crm')
  var _mgTabValve    = document.getElementById('mg-tab-valve')
  var _mgTabSurvey   = document.getElementById('mg-tab-survey')
  var _crmPanel      = document.getElementById('freq-monitor')
  var _valvePanel    = document.getElementById('valve-monitor')
  var _surveyPanel   = document.getElementById('survey-monitor')

  var _mgPanels = { crm: _crmPanel, valve: _valvePanel, survey: _surveyPanel }
  var _mgTabs   = { crm: _mgTabCrm, valve: _mgTabValve, survey: _mgTabSurvey }

  function _mgShow(which) {
    if (!_mgPanels[which]) return
    Object.keys(_mgPanels).forEach(function(k) {
      _mgPanels[k].style.display = (k === which) ? '' : 'none'
      _mgTabs[k].classList.toggle('mg-tab-active', k === which)
    })
    _mgTabs[which].classList.remove('mg-tab-alert')
  }
  function _mgFlagAlert(which) {
    var t = _mgTabs[which]
    if (t && !t.classList.contains('mg-tab-active')) t.classList.add('mg-tab-alert')
  }
  _mgTabCrm.addEventListener('click',      function() { _mgShow('crm')      })
  _mgTabValve.addEventListener('click',    function() { _mgShow('valve')    })
  _mgTabSurvey.addEventListener('click',   function() { _mgShow('survey')   })

  /* ═══════════════════════════════════════════════════════════════════
     PRESSURE VALVE SEQUENCING MINI-GAME
     ═══════════════════════════════════════════════════════════════════ */
  var _vmPanel      = _valvePanel
  var _vmTitleEl    = document.getElementById('vm-title')
  var _vmTimerEl    = document.getElementById('vm-timer')
  var _vmValveEls   = [1,2,3,4].map(function(i){ return document.querySelector('.vm-valve[data-valve="'+i+'"]') })
  var _vmStateEls   = [1,2,3,4].map(function(i){ return document.getElementById('vm-state-'+i) })
  var _vmSeqSlots   = [1,2,3,4].map(function(i){ return document.getElementById('vm-seq-'+i) })

  /* State */
  var _vmMode         = 'idle'           // 'idle' | 'active'
  var _vmValveOpen    = [false, false, false, false]   // current visible state of each valve
  var _vmCorrectSeq   = []               // correct sequence (array of valve numbers 1-4)
  var _vmDisplayedSeq = []               // sequence shown in log (may differ from correct)
  var _vmInput        = []               // player's current input
  var _vmTimeLeft     = 45
  var _vmTimerInt     = null
  var _vmIdleTimer    = null
  var _vmBonusTimer   = null
  var _vmPenaltyTimer = null
  var _vmBonusRemain  = 0
  var _vmPenaltyRemain= 0
  var _vmWasWrongLog  = false

  /* ── Render valve visual states ──────────────────────────────────── */
  function _vmRender() {
    for (var i = 0; i < 4; i++) {
      var open = _vmValveOpen[i]
      _vmStateEls[i].textContent = open ? 'OPEN' : 'CLSD'
      if (open) _vmValveEls[i].classList.add('vm-valve-open')
      else      _vmValveEls[i].classList.remove('vm-valve-open')
    }
  }

  function _vmRenderSeq() {
    for (var i = 0; i < 4; i++) {
      if (_vmMode === 'active') {
        if (_vmInput[i]) {
          _vmSeqSlots[i].textContent = '[ V' + _vmInput[i] + ' ]'
          _vmSeqSlots[i].classList.add('vm-seq-filled')
        } else {
          _vmSeqSlots[i].textContent = '[ _ ]'
          _vmSeqSlots[i].classList.remove('vm-seq-filled')
        }
      } else {
        _vmSeqSlots[i].textContent = '[ _ ]'
        _vmSeqSlots[i].classList.remove('vm-seq-filled')
      }
    }
    document.getElementById('vm-sequence').style.opacity = _vmMode === 'active' ? '1' : '0.35'
  }

  /* ── Log helper: describe which valves opened or closed ──────────── */
  function _vmLogChanges(prev, next, reason) {
    var opened = [], closed = []
    for (var i = 0; i < 4; i++) {
      if (!prev[i] && next[i]) opened.push('V' + (i + 1))
      if (prev[i] && !next[i]) closed.push('V' + (i + 1))
    }
    if (!opened.length && !closed.length) return
    var parts = []
    if (opened.length) parts.push(opened.join(',') + ' OPEN')
    if (closed.length) parts.push(closed.join(',') + ' CLSD')
    var msg = (reason || 'Valve state change') + ' — ' + parts.join(' · ') + '.'
    _lsAdd(msg, 'system')
  }

  /* ── IDLE breathing — toggle 1-2 random valves every 40-60s ─────── */
  function _vmIdleBreath() {
    if (_vmMode !== 'idle' || gameState.systemFailure) {
      _vmIdleTimer = setTimeout(_vmIdleBreath, 30000)
      return
    }
    var n = 1 + Math.floor(Math.random() * 2)
    var picks = [0,1,2,3].sort(function(){ return Math.random() - 0.5 }).slice(0, n)
    var prev = _vmValveOpen.slice()
    picks.forEach(function(i) { _vmValveOpen[i] = !_vmValveOpen[i] })
    _vmRender()
    _vmLogChanges(prev, _vmValveOpen, 'Loop balancing')
    _vmIdleTimer = setTimeout(_vmIdleBreath, _B.vmIdleMs + Math.floor(Math.random() * _B.vmIdleRnd))
  }

  /* ── Wrong-log probability scaled by shift phase ─────────────────── */
  function _vmWrongLogChance() {
    if      (_gcElapsed < 180) return 0.20    // 22:00–01:00
    else if (_gcElapsed < 360) return 0.40    // 01:00–04:00
    else                       return 0.60    // 04:00–06:00
  }

  /* ── Generate a 4-step random permutation of valves 1-4 ──────────── */
  function _vmRandomSeq() {
    var arr = [1,2,3,4]
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t
    }
    return arr
  }

  /* ── triggerValveSequence — switch IDLE → ACTIVE ─────────────────── */
  function triggerValveSequence() {
    if (gameState.systemFailure) return
    if (_vmMode === 'active') return                    // already active
    if (window.errorSystem && window.errorSystem.isActive()) {
      setTimeout(triggerValveSequence, 8000)
      return
    }
    if (_fcMode === 'active') {                          // do not collide with CRM active
      setTimeout(triggerValveSequence, 30000)
      return
    }
    if (_anom && _anom.active) {                         // do not collide with anomaly decision
      setTimeout(triggerValveSequence, 20000)
      return
    }

    _vmMode = 'active'
    /* Reset all valves to CLOSED at sequence start */
    var _prevOpen = _vmValveOpen.slice()
    _vmValveOpen = [false, false, false, false]
    _vmRender()
    _vmLogChanges(_prevOpen, _vmValveOpen, 'Pre-sequence purge')

    _vmCorrectSeq = _vmRandomSeq()
    _vmInput = []

    /* Decide whether to show wrong sequence in log */
    _vmWasWrongLog = Math.random() < _vmWrongLogChance()
    if (_vmWasWrongLog) {
      /* Swap two adjacent positions in displayed sequence */
      _vmDisplayedSeq = _vmCorrectSeq.slice()
      var swap = Math.floor(Math.random() * 3)            // 0,1,2 → swap with next
      var tmp = _vmDisplayedSeq[swap]
      _vmDisplayedSeq[swap] = _vmDisplayedSeq[swap + 1]
      _vmDisplayedSeq[swap + 1] = tmp
    } else {
      _vmDisplayedSeq = _vmCorrectSeq.slice()
    }

    _vmTimeLeft = 45
    _vmTitleEl.textContent = '// SEQUENCE REQUIRED !'
    _vmTitleEl.style.color = 'var(--amber)'
    _vmTimerEl.style.display = ''
    _vmTimerEl.textContent   = _vmTimeLeft + 's'
    _vmTimerEl.classList.remove('vm-timer-crit')
    _vmPanel.classList.add('vm-active')
    _vmRenderSeq()

    _vmTimerInt = setInterval(_vmTimerTick, 1000)

    _lsAdd('⚠ Pressure relief sequence initiated. Open valves in order: [V' +
           _vmDisplayedSeq.join(', V') + '].', 'warning')

    _mgFlagAlert('valve')
  }

  function _vmTimerTick() {
    _vmTimeLeft--
    if (_vmTimeLeft <= 0) {
      _vmFail('timeout')
      return
    }
    _vmTimerEl.textContent = _vmTimeLeft + 's'
    if (_vmTimeLeft <= 10) _vmTimerEl.classList.add('vm-timer-crit')
  }

  /* ── Valve click handler — Sprint G polish ───────────────────────
     Correct  → 300ms valve-turn pulse → state commit + pneumatic
                hiss/clunk via hoverSfx.valveOpen()
     Wrong    → screen pulse + brief shake + error hiss + 3s timer
                penalty. Previously opened valves stay open (G.5);
                player can try the next valve immediately.
     ────────────────────────────────────────────────────────────── */
  _vmValveEls.forEach(function(el, idx) {
    el.addEventListener('click', function() {
      if (_vmMode !== 'active') return
      /* Block re-clicks during the 300ms turn pulse */
      if (el.classList.contains('vm-valve-turning')) return
      var valveNum = idx + 1
      var pos      = _vmInput.length
      var prev     = _vmValveOpen.slice()
      if (_vmCorrectSeq[pos] === valveNum) {
        /* G.2 — start the valve-turn pulse, defer state commit */
        el.classList.remove('vm-valve-turning')
        void el.offsetWidth
        el.classList.add('vm-valve-turning')
        /* G.3 — pneumatic open sound at the moment of action */
        if (window.hoverSfx && typeof window.hoverSfx.valveOpen === 'function') {
          try { window.hoverSfx.valveOpen() } catch(e){}
        }
        setTimeout(function() {
          el.classList.remove('vm-valve-turning')
          if (_vmMode !== 'active') return
          _vmInput.push(valveNum)
          _vmValveOpen[valveNum - 1] = true
          _vmRender()
          _vmRenderSeq()
          _vmLogChanges(prev, _vmValveOpen, 'Operator')
          if (_vmInput.length === 4) _vmSuccess()
        }, 300)
      } else {
        /* G.1 — wrong sequence input.
           Visual: valve red flash + screen-edge red pulse + brief shake.
           Audio:  pneumatic error hiss.
           Mechanical: -3s timer, but G.5 says DO NOT close opened valves.
           Player tries the next correct valve immediately. */
        el.classList.remove('vm-valve-wrong')
        void el.offsetWidth
        el.classList.add('vm-valve-wrong')
        setTimeout(function(){ el.classList.remove('vm-valve-wrong') }, 500)

        /* Screen-edge red pulse — temporary overlay element */
        try {
          var pulse = document.createElement('div')
          pulse.className = 'vm-screen-pulse'
          document.body.appendChild(pulse)
          setTimeout(function(){ if (pulse.parentNode) pulse.parentNode.removeChild(pulse) }, 420)
        } catch(e){}

        /* Brief shake on .terminal */
        try {
          var term = document.querySelector('.terminal')
          if (term) {
            term.classList.remove('vm-shake')
            void term.offsetWidth
            term.classList.add('vm-shake')
            setTimeout(function(){ term.classList.remove('vm-shake') }, 140)
          }
        } catch(e){}

        /* Error hiss */
        if (window.hoverSfx && typeof window.hoverSfx.valveError === 'function') {
          try { window.hoverSfx.valveError() } catch(e){}
        }

        /* Timer penalty — -3s, but never below 0 (timeout fires naturally) */
        if (typeof _vmTimeLeft === 'number') {
          _vmTimeLeft = Math.max(1, _vmTimeLeft - 3)
          if (_vmTimerEl) _vmTimerEl.textContent = _vmTimeLeft + 's'
        }

        /* G.5 — DO NOT reset _vmInput or close opened valves.
           Previously correct opens stay open. Logged so the
           shift log shows the attempt without the destructive
           "sequence abort" line. */
        _vmLogChanges(prev, _vmValveOpen, 'Sequence error — V' + valveNum + ' out of order')
      }
    })
  })

  /* ── Success ─────────────────────────────────────────────────────── */
  function _vmSuccess() {
    clearInterval(_vmTimerInt); _vmTimerInt = null
    _vmFlash('vm-flash-green')
    /* G.4 — sustained pneumatic release + pressure-needle drop
       animation on the PRES gauge. The release sound runs for
       ~700ms which roughly matches the visual settle on the gauge
       — so the player gets coherent audio + visual feedback for
       "pressure bleeding off". */
    if (window.hoverSfx && typeof window.hoverSfx.valveRelease === 'function') {
      try { window.hoverSfx.valveRelease() } catch(e){}
    }
    try {
      var pBlock = document.getElementById('block-basinc')
      if (pBlock) {
        pBlock.classList.remove('vm-pressure-drop')
        void pBlock.offsetWidth
        pBlock.classList.add('vm-pressure-drop')
        setTimeout(function(){ pBlock.classList.remove('vm-pressure-drop') }, 900)
      }
    } catch(e){}
    _lsAdd('Pressure relief sequence complete. Loop pressure normalized.', 'system')

    /* 45-second PRESSURE deterioration pause */
    gameState.valveBonus = true
    _vmBonusRemain = 45
    if (_vmBonusTimer) clearInterval(_vmBonusTimer)
    _vmBonusTimer = setInterval(function() {
      _vmBonusRemain--
      if (_vmBonusRemain <= 0) {
        gameState.valveBonus = false
        clearInterval(_vmBonusTimer); _vmBonusTimer = null
      }
    }, 1000)

    _vmReset()
    _scheduleNextValveSeq()
  }

  /* ── Failure ─────────────────────────────────────────────────────── */
  function _vmFail(reason) {
    clearInterval(_vmTimerInt); _vmTimerInt = null
    _vmFlash('vm-flash-red')
    _lsAdd('⚠ Sequence error. Pressure relief failed. Manual intervention required.', 'anomaly')

    /* 60-second PRESSURE deterioration +25% */
    gameState.valvePenalty = true
    _vmPenaltyRemain = 60
    if (_vmPenaltyTimer) clearInterval(_vmPenaltyTimer)
    _vmPenaltyTimer = setInterval(function() {
      _vmPenaltyRemain--
      if (_vmPenaltyRemain <= 0) {
        gameState.valvePenalty = false
        clearInterval(_vmPenaltyTimer); _vmPenaltyTimer = null
      }
    }, 1000)

    _vmReset()
    _scheduleNextValveSeq()
  }

  function _vmFlash(cls) {
    _vmPanel.classList.remove('vm-active', 'vm-flash-green', 'vm-flash-red')
    void _vmPanel.offsetWidth
    _vmPanel.classList.add(cls)
    setTimeout(function() { _vmPanel.classList.remove(cls) }, 750)
  }

  function _vmReset() {
    _vmMode = 'idle'
    _vmInput = []
    _vmCorrectSeq = []
    _vmDisplayedSeq = []
    _vmTimerEl.style.display = 'none'
    _vmTimerEl.classList.remove('vm-timer-crit')
    _vmTitleEl.textContent = '// PRESSURE VALVES'
    _vmTitleEl.style.color = ''
    _vmPanel.classList.remove('vm-active')
    /* Close all valves after the relief sequence */
    var prev = _vmValveOpen.slice()
    _vmValveOpen = [false, false, false, false]
    _vmRender()
    _vmRenderSeq()
    _vmLogChanges(prev, _vmValveOpen, 'Valve block reset to standby')
  }

  function _scheduleNextValveSeq() {
    if (gameState.systemFailure) return
    /* every 5–9 minutes (real time) — speed-scaled */
    setTimeout(triggerValveSequence, _spawnMs(_B.vmRespawnMs + Math.floor(Math.random() * _B.vmRespawnRnd)))
  }

  /* ── Boot ─────────────────────────────────────────────────────────── */
  _vmRender()
  _vmRenderSeq()
  /* Idle breathing kickoff */
  _vmIdleTimer = setTimeout(_vmIdleBreath, _B.vmIdleMs + Math.floor(Math.random() * _B.vmIdleRnd))
  /* First spawn 5–8 minutes in (real time) — speed-scaled */
  setTimeout(triggerValveSequence, _spawnMs(_B.vmFirstMs + Math.floor(Math.random() * _B.vmFirstRnd)))

  /* ═══════════════════════════════════════════════════════════════════
     DEBUG PANEL  (F1 to toggle)
     ═══════════════════════════════════════════════════════════════════ */

  var _dbgVisible = false
  var _dbgEl      = document.getElementById('dbg-entries')
  var _dbgPanel   = document.getElementById('debug-panel')

  function _dbgUpdate() {
    if (!_dbgVisible || !_dbgEl) return
    var lines = []
    var sign  = function(n) { return n >= 0 ? '+' : '' }

    Object.keys(SYSTEMS).forEach(function(sys) {
      var cfg  = SYSTEMS[sys]
      var res  = gameState.resources[sys]
      var mag
      if (res <= 3) {
        mag = cfg.deterRate - (cfg.deterRate - 0.05) * (res / 3)
      } else {
        mag = 0.05 - (res - 3) * 0.06
      }
      var rate = (mag > 0 ? mag * _diffScale : mag) * cfg.direction
      if (sys === 'sicaklik' && rate > 0) {
        if (gameState.freqBonus)  rate *= 0.90
        if (_fcPenaltyLevel >= 1) rate *= 1.20
        if (_fcPermDebuff)        rate *= 1.15
      }
      if (sys === 'basinc' && mag > 0) {
        if (gameState.valveBonus)   rate  = 0
        if (gameState.valvePenalty) rate *= 1.25
      }
      if (_demandShift.active && _demandShift.system === sys && mag > 0 && res < 5) {
        rate *= 2.0
      }
      lines.push(cfg.label + ': ' + gameState.systemValues[sys].toFixed(1) + cfg.unit +
                 '  [rate: ' + sign(rate) + rate.toFixed(3) + '/s]')
    })

    var penLabel = ['NONE', 'L1 +20%', 'L2 ANOM', 'L3 PERM'][_fcPenaltyLevel] || '?'

    /* Demand shift readout */
    var demandLine
    if (_demandShift.active) {
      var remMin = Math.max(0, _demandShift.endElapsed - _gcElapsed)
      var rh = Math.floor(remMin / 60), rm = remMin % 60
      var remStr = (rh > 0 ? rh + 'h ' : '') + String(rm).padStart(2, '0') + 'm'
      demandLine = 'DEMAND SHIFT: ' + _demandShift.type + ' (' + _demandShift.label + ') — ' +
                   _demandShift.sysLabel + ' [' + remStr + ' left]'
    } else if (_demandShift.ended) {
      demandLine = 'DEMAND SHIFT: ' + _demandShift.type + ' (' + _demandShift.label + ') — ENDED'
    } else {
      var sh = Math.floor(_demandShift.startElapsed / 60), sm = _demandShift.startElapsed % 60
      var startTime = String((22 + sh) % 24).padStart(2, '0') + ':' + String(sm).padStart(2, '0')
      demandLine = 'DEMAND SHIFT: ' + _demandShift.type + ' (' + _demandShift.label + ') — pending @ ' + startTime
    }

    _dbgEl.innerHTML = [
      'GAME TIME: '    + _gcTime(),
      lines[0],
      lines[1],
      lines[2],
      'RADIATION: '    + sensorState.B.values.radiation.v.toFixed(2) + ' mSv',
      'RESOURCES: T:[' + gameState.resources.sicaklik + '] P:[' + gameState.resources.basinc + '] W:[' + gameState.resources.guc + ']',
      'ANOMALY: '      + (_anom.active ? 'active' : 'none'),
      'CRM MODE: '     + _fcMode + '  CRM SYNC: ' + Math.round(_fcMatch()) + '%',
      'CRM BONUS: '    + gameState.freqBonus + '  LOW-SYNC: ' + _fcLowSyncSecs + 's',
      'PENALTY: '      + penLabel + '  PERM: ' + _fcPermDebuff,
      'DIFFICULTY: '   + _diffScale.toFixed(1) + 'x',
      'CRIT TIMER: T:' + gameState.critSeconds.sicaklik + 's  P:' + gameState.critSeconds.basinc + 's  W:' + gameState.critSeconds.guc + 's  [max 120s]',
      'CORRECT: '      + gameState.correctDecisions + '  WRONG: ' + gameState.wrongDecisions + '  MISSED: ' + gameState.missedAnomalies,
      'CRIT.TOT: '     + gameState.totalCritSeconds + 's  FC.OK: ' + gameState.freqCalSuccess + '  FC.FAIL: ' + gameState.freqCalFail,
      demandLine,
      'VALVE MODE: '   + _vmMode +
        '  BONUS: '   + (gameState.valveBonus   ? 'true [' + _vmBonusRemain   + 's]' : 'false') +
        '  PEN: '     + (gameState.valvePenalty ? 'true [' + _vmPenaltyRemain + 's]' : 'false'),
      'VALVE WRONG LOG: ' + _vmWasWrongLog +
        (_vmMode === 'active'
          ? '  CORRECT: [V' + _vmCorrectSeq.join(',V') + ']  SHOWN: [V' + _vmDisplayedSeq.join(',V') + ']'
          : ''),
      (function() {
        var s = (window.saveSystem && window.saveSystem.loadGame())
                ? window.saveSystem.loadGame() : _save
        return 'SAVE: Shift ' + s.shiftNumber +
               ' | Money ' + s.totalMoney + '/' + s.targetMoney +
               ' | Evicted ' + s.evicted +
               ' | Rent Skip ' + s.shiftsWithoutRent
      })(),
    ].map(function(l) { return '<div>' + l + '</div>' }).join('')
  }

  setInterval(_dbgUpdate, 1000)

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F1') {
      /* Gate behind dev flag — packaged release builds have
         window.__THERMAL_DEBUG__ === false. Players never see F1. */
      if (!window.__THERMAL_DEBUG__) return
      e.preventDefault()
      _dbgVisible = !_dbgVisible
      if (_dbgPanel) _dbgPanel.classList.toggle('dbg-visible', _dbgVisible)
      _dbgUpdate()
    }
  })

  /* ── Debug skip button ───────────────────────────────────────── */
  document.getElementById('dbg-skip').addEventListener('click', function() {
    _gcElapsed = 478
    _diffScale = _getDiffScale()
    _gcPaint()
    _lsAdd('[DEBUG] Shift time advanced to 05:58. Final 2 game-minutes active.', 'system')
  })

  /* ── Debug force-dispatch button ─────────────────────────────── */
  var _dbgDispatchBtn = document.getElementById('dbg-dispatch')
  if (_dbgDispatchBtn) {
    _dbgDispatchBtn.addEventListener('click', function() {
      if (window.__dispatchDebug && typeof window.__dispatchDebug.start === 'function') {
        window.__dispatchDebug.start()
        _lsAdd('[DEBUG] Dispatch call forced.', 'system')
      }
    })
  }

  /* ── Debug ER controls — populate dropdown + wire FIRE / CANCEL ──
     The dropdown is filled from window.errorSystem.getCodes() so any
     code added to error-codes.json appears here automatically. An
     empty selection means "fire a random code". */
  ;(function wireErDebug() {
    var sel    = document.getElementById('dbg-er-select')
    var fire   = document.getElementById('dbg-er-fire')
    var cancel = document.getElementById('dbg-er-cancel')
    if (!sel || !fire || !cancel || !window.errorSystem) return

    var codes = window.errorSystem.getCodes()
    codes.forEach(function(c) {
      var opt = document.createElement('option')
      opt.value = c.id
      opt.textContent = c.id + ' — ' + (c.systemTag || c.title || '')
      sel.appendChild(opt)
    })

    fire.addEventListener('click', function() {
      var id = sel.value || null
      var ok = window.errorSystem.fire(id)
      if (ok) _lsAdd('[DEBUG] ER fired: ' + (id || 'random'), 'system')
    })
    cancel.addEventListener('click', function() {
      window.errorSystem.cancel()
      _lsAdd('[DEBUG] ER cancelled.', 'system')
    })
  })()

  /* ── Kick off auto-spawn scheduler — first ER lands ~2-5min into
     the shift; subsequent ones every ~4-7min, tightening on later
     shifts via the shiftScale exponent in error-codes.json. */
  ;(function startErScheduler() {
    if (!window.errorSystem || !window.errorSystem.startScheduler) return
    var shiftNum = (_save && _save.shiftNumber) || 1
    window.errorSystem.startScheduler(shiftNum)
  })()


  /* ── Debug force-end buttons ─────────────────────────────────── */
  /* Each preset stamps gameState / _radMax to synthesize a specific
     shift outcome, then calls endShift() directly. Used to exercise
     the full save + shift-end flow without playing the shift.       */
  var _DBG_END_PRESETS = {
    exemplary: {
      correct: 10, wrong: 0, missed: 0, crit: 0,
      rad: 0.5, meltdown: false, street: false,
      fcOk: 3, fcFail: 0,
    },
    satisfactory: {
      correct: 7,  wrong: 2, missed: 1, crit: 12,
      rad: 1.0, meltdown: false, street: false,
      fcOk: 2, fcFail: 0,
    },
    marginal: {
      correct: 5,  wrong: 4, missed: 2, crit: 45,
      rad: 2.0, meltdown: false, street: false,
      fcOk: 1, fcFail: 1,
    },
    unsatisfactory: {
      correct: 2,  wrong: 6, missed: 3, crit: 95,
      rad: 3.0, meltdown: false, street: false,
      fcOk: 0, fcFail: 2,
    },
    meltdown: {
      correct: 3,  wrong: 4, missed: 2, crit: 130,
      rad: 5.2, meltdown: true,  street: false,
      fcOk: 1, fcFail: 2,
    },
    street: {
      correct: 4,  wrong: 2, missed: 1, crit: 20,
      rad: 1.2, meltdown: false, street: true,
      fcOk: 2, fcFail: 0,
    },
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('.dbg-force-btn'),
    function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.getAttribute('data-end')
        var p   = _DBG_END_PRESETS[key]
        if (!p) return
        gameState.correctDecisions = p.correct
        gameState.wrongDecisions   = p.wrong
        gameState.missedAnomalies  = p.missed
        gameState.totalCritSeconds = p.crit
        gameState.freqCalSuccess   = p.fcOk
        gameState.freqCalFail      = p.fcFail
        gameState.meltdownOccurred = p.meltdown
        gameState.streetDeath      = p.street
        _radMax = Math.max(_radMax, p.rad)
        sensorState.B.values.radiation.v = p.rad
        _lsAdd('[DEBUG] Forcing shift end: ' + key.toUpperCase(), 'system')
        endShift()
      })
    }
  )

  /* ═══════════════════════════════════════════════════════════════════
     SHIFT END
     ─────────────────────────────────────────────────────────────────
     endShift() — collects final state, writes thermalShiftReport to
     localStorage, then CRT-off → shift-end.html.
     Called from: _gcTick() at 06:00, or 4 s after fatal meltdown.
     ═══════════════════════════════════════════════════════════════════ */

  var _shiftEnded = false

  function endShift() {
    if (_shiftEnded) return
    _shiftEnded = true
    console.log('[endShift] entered')
    clearInterval(_gcInterval)

    var shiftNum, radiationReached, shiftPay
    try {
      shiftNum         = _save.shiftNumber || 1
      radiationReached = Math.max(_radMax, sensorState.B.values.radiation.v)
      shiftPay         = window.saveSystem.calcShiftPay(
                           radiationReached, gameState.meltdownOccurred)
    } catch (e) {
      console.error('[endShift] save calc failed:', e)
      shiftNum = 1; radiationReached = 0; shiftPay = 0
    }

    var report = {
      correctDecisions:    gameState.correctDecisions,
      wrongDecisions:      gameState.wrongDecisions,
      missedAnomalies:     gameState.missedAnomalies,
      totalCritSeconds:    gameState.totalCritSeconds,
      meltdownOccurred:    gameState.meltdownOccurred,
      streetDeath:         !!gameState.streetDeath,
      freqCalSuccess:      gameState.freqCalSuccess,
      freqCalFail:         gameState.freqCalFail,
      finalTemp:           gameState.systemValues.sicaklik,
      finalPressure:       gameState.systemValues.basinc,
      finalPower:          gameState.systemValues.guc,
      finalTempStatus:     gameState.systemStatus.sicaklik,
      finalPressureStatus: gameState.systemStatus.basinc,
      finalPowerStatus:    gameState.systemStatus.guc,
      finalRadiation:      sensorState.B.values.radiation.v,
      radiationReached:    radiationReached,
      radSnapshots:        _radSnap.concat([parseFloat(sensorState.B.values.radiation.v.toFixed(2))]),
      shiftNumber:         shiftNum,
      shiftPay:            shiftPay + (gameState.erBonusTotal || 0),
      basePay:             shiftPay,
      erBonusTotal:        gameState.erBonusTotal || 0,
      ersResolved:         gameState.ersResolved || 0,
      ventCount:           gameState.ventCount,
      ventRads:            parseFloat(gameState.ventRads.toFixed(2)),
      /* Sprint 1 (A) — Per-subsystem sensor reliability totals.
         _gcDuration is the total shift length in game-minutes
         (defaults to 480). Each tier-counter is in game-seconds, so
         convert to a "% of shift spent at this tier" for the
         shift-end RELIABILITY readout. Reliability % = 100 minus
         degraded weight: low counts half, crit counts full. */
      lowPrecisionSeconds:  Object.assign({}, gameState.lowPrecisionSeconds  || {}),
      critPrecisionSeconds: Object.assign({}, gameState.critPrecisionSeconds || {}),
      sensorReliability: (function () {
        var out  = {}
        var keys = ['sicaklik', 'basinc', 'guc']
        /* Each tick is "1 game-second equivalent" — total shift uses
           game-min × 60. Falls back to safe denominator if missing. */
        var totalSec = (typeof _gcDuration === 'number' ? _gcDuration : 480) * 60
        keys.forEach(function (k) {
          var low  = (gameState.lowPrecisionSeconds  || {})[k] || 0
          var crit = (gameState.critPrecisionSeconds || {})[k] || 0
          var penalty = (crit + low * 0.5) / Math.max(1, totalSec)
          var pct = Math.max(0, Math.min(100, Math.round((1 - penalty) * 100)))
          out[k] = { pct: pct, lowSec: low, critSec: crit }
        })
        return out
      })(),
      /* Sprint 2 (B) — full per-anomaly history with severity +
         reason chain + outcome. Shift-end UI renders this as a
         "what happened and why" table; player can trace each
         spike back to their own decisions. */
      anomalyEvents: (gameState.anomalyEvents || []).slice(),
      /* Sprint 3 (D) — "what really happened" reconstruction data.
         Used by the viral POST-SHIFT RECONSTRUCTION panel: lets
         the player compare their actions to the simulation truth.
         Tone is melancholic — no judgement, just the numbers. */
      realState: (function () {
        var events  = gameState.anomalyEvents || []
        var realCnt = events.filter(function (e) { return !e.isFake }).length
        var escCnt  = events.filter(function (e) { return e.outcome === 'escalated' }).length
        var DISTRICTS = [
          { name: 'SOMOVKA',       pop: 2340 },
          { name: 'KIRIYAT-VOSTOK',pop: 4180 },
          { name: 'NIZHNYI-RED',   pop: 1620 },
          { name: 'POLYANY',       pop: 5870 },
          { name: 'TEREKHOVO',     pop: 980  },
          { name: 'KOLOMENSK',     pop: 7240 }
        ]
        var pick = DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)]
        return {
          realAnomalyEvents:   realCnt,
          escalatedEvents:     escCnt,
          calledTotal:         (gameState.correctDecisions || 0) + (gameState.wrongDecisions || 0),
          correctCalls:        gameState.correctDecisions || 0,
          wrongCalls:          gameState.wrongDecisions   || 0,
          missedAnomalies:     gameState.missedAnomalies  || 0,
          peakActualRad:       _radMax,
          peakReportedRad:     sensorState.B.values.radiation.v,
          externalVentCount:   gameState.ventCount || 0,
          externalSv:          parseFloat((gameState.ventRads || 0).toFixed(2)),
          nearbyDistrict:      pick.name,
          nearbyPopulation:    pick.pop,
          facilityStatement:   'PENDING'
        }
      })()
      ,
      /* Faz 2/E — single-shift summary kept on save so the NEXT
         shift's home-terminal NEWS panel can inject deniable
         articles that mirror what the player did. Per-shift only
         (overwritten each end). Cumulative totals already live in
         save.totalExternalVents/Rads. */
      lastShiftDecisions: {
        missedAnomalies: gameState.missedAnomalies  || 0,
        falseAlarms:     gameState.wrongDecisions   || 0,
        ventCount:       gameState.ventCount        || 0,
        peakRad:         parseFloat((_radMax || 0).toFixed(2)),
        workerDeaths:    gameState.workerDeathsThisShift || 0
      }
    }
    localStorage.setItem('thermalShiftReport', JSON.stringify(report))

    /* Append this shift's anomaly log + summary stats to the
       persistent archive — shift logs in FILES surface this. */
    try {
      var _al = JSON.parse(localStorage.getItem('thermalAnomalyLog') || '[]')
      _al.push({
        shiftNumber: shiftNum,
        entries:     _shiftAnomalyLog,
        summary: {
          basePay:          shiftPay,
          erBonus:          gameState.erBonusTotal || 0,
          totalPay:         shiftPay + (gameState.erBonusTotal || 0),
          ersResolved:      gameState.ersResolved || 0,
          correctDecisions: gameState.correctDecisions,
          wrongDecisions:   gameState.wrongDecisions,
          missedAnomalies:  gameState.missedAnomalies,
          totalCritSeconds: gameState.totalCritSeconds,
          radiationReached: parseFloat(radiationReached.toFixed(2)),
          ventCount:        gameState.ventCount,
          meltdownOccurred: gameState.meltdownOccurred,
        }
      })
      localStorage.setItem('thermalAnomalyLog', JSON.stringify(_al))
    } catch(e) {}

    /* Persist the shift into the save object (pay, shift++, etc.) */
    window.saveSystem.updateShift(report)

    /* Achievement triggers — fire after the save has been updated so
       loadGame() reflects the new shiftNumber / win-state. */
    try {
      var post = window.saveSystem.loadGame()
      var ach  = window.achievements
      if (ach) {
        if (gameState.meltdownOccurred) ach.unlock('ACH_MELTDOWN')
        if (post.shiftNumber >= 2)      ach.unlock('ACH_FIRST_NIGHT')   // shift 1 just completed → bumped to 2
        if (post.shiftNumber >= 8)      ach.unlock('ACH_DONT_LOOK_UP')  // survived shift 7
        if (post.gameOver && post.gameOverReason === 'win') ach.unlock('ACH_SIGN_OFF')
        /* No casualties — only counts on a clean (won) run */
        if (post.gameOver && post.gameOverReason === 'win') {
          try {
            var roster = JSON.parse(localStorage.getItem('thermalWorkerRoster') || '{}')
            if (((roster.dead || []).length) === 0) ach.unlock('ACH_NO_CASUALTIES')
          } catch (e) {}
        }
      }
    } catch (e) { console.warn('[achievements] endShift trigger failed:', e) }

    /* Shift ended cleanly — drop any mid-shift autosave so the menu
       doesn't offer "RESUME" for a run that's already over. */
    if (window.saveSystem.clearAutosave) {
      try { window.saveSystem.clearAutosave() } catch (e) {}
    }

    /* If this run is OVER (meltdown ends it; win is the final shift),
       capture a "predecessor record" — survives resetGame() so the
       next operator (next run) can find this in their FILES list. */
    try {
      var saveAfter = window.saveSystem.loadGame()
      var runOver   = !!(saveAfter && saveAfter.gameOver)
      if (runOver) {
        var allDecrypted = false
        try {
          var dec = JSON.parse(localStorage.getItem('thermalDecryptedFiles') || '[]')
          allDecrypted = ['kowalski','reznov','deleted'].every(function (k) { return dec.indexOf(k) !== -1 })
        } catch (e) {}
        window.saveSystem.writePredecessorLog({
          shiftsCompleted: saveAfter.shiftNumber - 1,
          totalMoney:      saveAfter.totalMoney,
          targetMoney:     saveAfter.targetMoney,
          gameOverReason:  saveAfter.gameOverReason || (gameState.meltdownOccurred ? 'meltdown' : 'unknown'),
          discoveredAll:   allDecrypted,
          finalRadiation:  parseFloat(radiationReached.toFixed(2)),
          casualties:      (function(){
            try { var r = JSON.parse(localStorage.getItem('thermalWorkerRoster')||'{}'); return (r.dead||[]).length } catch(e){ return 0 }
          })(),
          totalCritSeconds: gameState.totalCritSeconds,
          timestamp: Date.now()
        })
      }
    } catch (e) { console.warn('[predecessor] write failed:', e) }

    var _nextScreen = (gameState && gameState.meltdownOccurred) ? 'death.html' : 'shift-end.html'
    if (_trainingMode) _nextScreen = 'menu.html'   // no consequences in training
    if (_demoMode)     _nextScreen = 'demo-end.html'   // shift 1 cliffhanger
    console.log('[endShift] navigating to', _nextScreen, 'in 620ms')
    var terminal = document.querySelector('.terminal')
    if (terminal) {
      try { terminal.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards' } catch(e){}
    }
    /* Native setTimeout (bypasses monkey-patched pause/freeze queue)
       so navigation can NEVER get stuck behind a paused timer. */
    _origST(function() {
      console.log('[endShift] firing window.location.href =', _nextScreen)
      window.location.href = _nextScreen
    }, 620)
    /* ABSOLUTE fallback — if for any reason the 620ms timer doesn't
       fire, force-navigate after 2 seconds via raw native call. */
    _origST(function() {
      if (window.location.href.indexOf(_nextScreen) === -1) {
        console.warn('[endShift] FALLBACK navigate (620ms timer apparently never fired)')
        window.location.href = _nextScreen
      }
    }, 2000)
  }

  /* ═══════════════════════════════════════════════════════════════════
     KNOB VISUALS — purely presentational, no game-logic changes.
     Updates SVG knob rotation + sync arc from existing _fcPlayerFreq,
     _fcPlayerAmp, and _fcMatch() values.
     ═══════════════════════════════════════════════════════════════════ */
  ;(function() {
    var _kvFreqG   = document.getElementById('fm-knob-freq-g')
    var _kvAmpG    = document.getElementById('fm-knob-amp-g')
    var _kvArc     = document.getElementById('fm-sync-arc')
    var _kvPct     = document.getElementById('fm-sync-pct')
    var _kvBarFill = document.getElementById('fm-sync-bar-fill')
    var _kvBarLbl  = document.getElementById('fc-match-label')

    var FC_CIRC   = 326.7   // 2π × 52  — matches SVG arc radius

    /* Map value in [min,max] to rotation in [−135°, +135°] */
    function _kvAngle(v, min, max) {
      return -135 + (v - min) / (max - min) * 270
    }

    /* Push knob + bar state to DOM */
    function _kvUpdate() {
      /* Knob indicators */
      var fa = _kvAngle(_fcPlayerFreq, 0.5, 5.0)
      var aa = _kvAngle(_fcPlayerAmp,  0.1, 2.0)
      if (_kvFreqG) _kvFreqG.setAttribute('transform', 'rotate(' + fa.toFixed(1) + ' 22 22)')
      if (_kvAmpG)  _kvAmpG.setAttribute('transform',  'rotate(' + aa.toFixed(1) + ' 22 22)')

      /* Sync arc (hidden but kept for JS compat) */
      var match  = _fcMatch()
      if (_kvArc) {
        var offset = FC_CIRC - (match / 100 * FC_CIRC)
        _kvArc.setAttribute('stroke-dashoffset', offset.toFixed(1))
        _kvArc.setAttribute('stroke',
          match >= 85 ? '#a8ff3e' : match >= 60 ? '#ffb830' : '#ff3a3a')
      }

      /* Horizontal sync bar */
      var barColor = match >= 85 ? '#a8ff3e' : match >= 60 ? '#ffb830' : '#ff3a3a'
      if (_kvBarFill) {
        _kvBarFill.style.width           = match.toFixed(0) + '%'
        _kvBarFill.style.backgroundColor = barColor
        _kvBarFill.style.boxShadow       = '0 0 6px ' + barColor
      }
      if (_kvBarLbl) {
        _kvBarLbl.textContent    = match.toFixed(0) + '%'
        _kvBarLbl.style.color    = barColor
      }

      /* Sync text colour */
      if (_kvPct) {
        _kvPct.style.color = match >= 85
          ? 'var(--phosphor)'
          : match >= 60 ? 'var(--amber)' : 'var(--red-alert)'
      }
    }

    /* Drag-to-turn knob interaction */
    function _kvSetupDrag(svgEl, getVal, setVal, min, max) {
      if (!svgEl) return
      var _drag = false, _startY = 0, _startV = 0

      svgEl.addEventListener('mousedown', function(e) {
        _drag = true; _startY = e.clientY; _startV = getVal()
        e.preventDefault()
      })

      document.addEventListener('mousemove', function(e) {
        if (!_drag) return
        var dy    = _startY - e.clientY                  // up → positive
        var delta = dy * (max - min) / 110               // 110 px = full sweep
        setVal(parseFloat(Math.max(min, Math.min(max, _startV + delta)).toFixed(1)))
        _fcRefresh()
        _kvUpdate()
      })

      document.addEventListener('mouseup', function() { _drag = false })

      /* Scroll-wheel fine control */
      svgEl.addEventListener('wheel', function(e) {
        e.preventDefault()
        setVal(parseFloat(
          Math.max(min, Math.min(max, getVal() - Math.sign(e.deltaY) * 0.1)).toFixed(1)
        ))
        _fcRefresh()
        _kvUpdate()
      }, { passive: false })
    }

    _kvSetupDrag(
      document.getElementById('fm-knob-freq'),
      function()  { return _fcPlayerFreq },
      function(v) { _fcPlayerFreq = v },
      0.5, 5.0
    )
    _kvSetupDrag(
      document.getElementById('fm-knob-amp'),
      function()  { return _fcPlayerAmp },
      function(v) { _fcPlayerAmp = v },
      0.1, 2.0
    )

    /* Keep visuals in sync with the RAF/penalty loop */
    setInterval(_kvUpdate, 80)
    _kvUpdate()
  })()

/* ═══════════════════════════════════════════════════════════════════
   DISPATCH — Maintenance Crawl mini-game
   ─────────────────────────────────────────────────────────────────
   Narrative dispatch system. Workers (loaded from /assets/portraits)
   are called into the plant for repairs. Player chooses commands;
   each decision accrues dose. Workers can die; deaths persist across
   shifts and surface in news feeds and Elena's tone.
   ═══════════════════════════════════════════════════════════════════ */
;(function() {
  if (typeof require === 'undefined') return   // guard if not Electron

  var fs   = require('fs')
  var path = require('path')

  /* ── Worker roster (name, age, role, gender → portrait file) ───── */
  var ROSTER = [
    { id: 'w01', name: 'SERGEI I.',   gender: 'm', portrait: 'male1.txt',   age: 34, role: 'LOOP-2 TECH' },
    { id: 'w02', name: 'VIKTOR M.',   gender: 'm', portrait: 'male2.txt',   age: 42, role: 'SR. MECHANIC' },
    { id: 'w03', name: 'DMITRY P.',   gender: 'm', portrait: 'male3.txt',   age: 29, role: 'DOSIMETRIST' },
    { id: 'w04', name: 'YURI K.',     gender: 'm', portrait: 'male4.txt',   age: 51, role: 'SHIFT FOREMAN' },
    { id: 'w05', name: 'ALEKSEI R.',  gender: 'm', portrait: 'male5.txt',   age: 26, role: 'TRAINEE' },
    { id: 'w06', name: 'TATIANA V.',  gender: 'f', portrait: 'female1.txt', age: 38, role: 'I&C ENGINEER' },
    { id: 'w07', name: 'NATALYA S.',  gender: 'f', portrait: 'female2.txt', age: 45, role: 'RAD-CONTROL' },
    { id: 'w08', name: 'IRINA B.',    gender: 'f', portrait: 'female3.txt', age: 31, role: 'VALVE TECH' },
    { id: 'w09', name: 'OLGA N.',     gender: 'f', portrait: 'female4.txt', age: 27, role: 'TRAINEE' },
    { id: 'w10', name: 'ELENA Z.',    gender: 'f', portrait: 'female5.txt', age: 49, role: 'HEALTH PHYS.' },
  ]

  /* ── Load portrait ASCII files once ────────────────────────────── */
  var _portraits = {}
  ;(function loadPortraits() {
    try {
      var base = path.join(__dirname, '..', 'assets', 'portraits')
      ROSTER.forEach(function(w) {
        try {
          _portraits[w.id] = fs.readFileSync(path.join(base, w.portrait), 'utf8').replace(/\r/g, '')
        } catch (e) {
          console.warn('[dispatch] portrait missing:', w.portrait)
          _portraits[w.id] = '  // PORTRAIT DATA CORRUPTED //'
        }
      })
    } catch (e) { console.warn('[dispatch] portrait load failed:', e) }
  })()

  /* ── Roster state persisted via localStorage ───────────────────── */
  var ROSTER_KEY = 'thermalWorkerRoster'
  var _roster = (function loadRoster() {
    try {
      var raw = localStorage.getItem(ROSTER_KEY)
      if (raw) return JSON.parse(raw)
    } catch(e){}
    /* Fresh roster: all idle, zero dose */
    var r = { doses: {}, dead: [], dispatches: 0, lastShift: 0 }
    ROSTER.forEach(function(w) { r.doses[w.id] = 0 })
    return r
  })()
  function _saveRoster() {
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(_roster)) } catch(e){}
  }

  /* Initialise missing dose entries for any newly-added workers */
  ROSTER.forEach(function(w) { if (typeof _roster.doses[w.id] !== 'number') _roster.doses[w.id] = 0 })

  /* ── DOM refs ──────────────────────────────────────────────────── */
  /* _dpPanel is the full-viewport overlay. DISPATCH no longer has a
     mini-game tab — the overlay is the only player-facing surface.
     Shown on _startDispatch, hidden on _endDispatch / ACKNOWLEDGE. */
  var _dpPanel    = document.getElementById('dispatch-overlay')
  var _dpTitle    = document.getElementById('dp-title')
  var _dpStatus   = document.getElementById('dp-status')
  var _dpPortrait = document.getElementById('dp-portrait')
  var _dpWId      = document.getElementById('dp-w-id')
  var _dpWName    = document.getElementById('dp-w-name')
  var _dpWAge     = document.getElementById('dp-w-age')
  var _dpWRole    = document.getElementById('dp-w-role')
  var _dpWDose    = document.getElementById('dp-w-dose')
  var _dpWDoseFill= document.getElementById('dp-w-dose-fill')
  var _dpTrans    = document.getElementById('dp-transcript')
  var _dpActions  = document.getElementById('dp-actions')

  /* ── Dispatch event scripts ────────────────────────────────────── */
  /* Each script: ordered list of steps. Each step: prompt + 2-3 choices.
     Choice: { label, risk ('safe'|'risk'|'crit'), dose, effect, next, response } */
  var SCRIPTS = {
    /* Senaryo — Shift 3 — "A MEMBER OF FAMILY". NATALYA (w07,
       rad-control) calls about a small leak she logged earlier;
       she wants the day-shift cousin warned. Choice is low-cost
       either way — the point is to give her a face. */
    familyNote: {
      title: 'CHANNEL 4 — NATALYA, RAD-CONTROL',
      system: 'radiation',
      intro: 'Open channel. NATALYA from rad-control.',
      steps: [
        {
          prompt: '"Control? Small leak in loop 2 service crawl, B-side. I tagged it but it\'s not in the maintenance queue yet. My cousin works day shift in that block. Can you flag it on the handover so he sees the warning before he goes near?"',
          choices: [
            { label: '[ FLAG IT. HANDOVER NOTE. ]',
              risk: 'safe', dose: 0.02, abort: true,
              response: '"Thank you. Really. Thank you."' },
            { label: '[ NOT MY JOB. FILE IT YOURSELF. ]',
              risk: 'safe', dose: 0.02, abort: true,
              response: '"…copy. I\'ll file it. Goodnight."' }
          ]
        }
      ]
    },

    /* Senaryo — Shift 4 — "THE COFFEE". Trivial-looking favour
       that COSTS the player on the very next dispatch — the
       worker is mid-coffee-run when the call comes, so the
       backup picked is slower / shakier. The cost lives in
       _coffeeRunner which the next _startDispatch checks. */
    coffeeRun: {
      title: 'CHANNEL 4 — VIKTOR, SR. MECHANIC',
      system: null,
      intro: 'Open channel. VIKTOR from the mechanic\'s bench.',
      steps: [
        {
          prompt: '"Control. Coffee\'s on. I\'m walking to the mess for a thermos refill — anyone in there want one? Twenty minutes round trip."',
          choices: [
            { label: '[ YES. BLACK. NO SUGAR. ]',
              risk: 'safe', dose: 0.01, fix: 'coffeeYes', abort: true,
              response: '"On it. Back in twenty."' },
            { label: '[ NO. STAY AT YOUR POST. ]',
              risk: 'safe', dose: 0.01, abort: true,
              response: '"…copy. Returning to bench."' }
          ]
        }
      ]
    },

    /* Senaryo — Shift 5 — "I DON'T WANT TO". Worker explicitly
       refuses. Three choices, real moral weight. ORDER ANYWAY
       proceeds with the actual fix at the regular dose. REASSIGN
       skips this call (the system fix doesn't happen — penalty).
       STAND DOWN is the cleanest but the original problem
       remains visible in logs as unresolved. */
    refusal: {
      title: 'CHANNEL 4 — IRINA, VALVE TECH',
      system: 'basinc',
      intro: 'Channel open. Worker breathing hard. IRINA.',
      steps: [
        {
          prompt: '"I\'m at the access. I — Control, I have a daughter. The numbers in there are bad. I don\'t want to go in. Please."',
          choices: [
            { label: '[ ORDER ANYWAY. ENTER. ]',
              risk: 'crit', dose: 0.50, fix: 'basinc', abort: true,
              response: '"…yes sir. Going in."' },
            { label: '[ REASSIGN. SOMEONE ELSE. ]',
              risk: 'safe', dose: 0.02, fix: 'radSpike', abort: true,
              response: '"Thank you. I\'m sorry."' },
            { label: '[ STAND DOWN. RETURN. ]',
              risk: 'safe', dose: 0.02, abort: true,
              response: '"Yes sir. Thank you."' }
          ]
        }
      ]
    },

    /* Sprint I.2 — TRAINEE'S FIRST CALL. Fires once at shift 2.
       The dispatched worker IS a trainee. "SEND ALONE" is the
       cheap-looking option but trainee has ×2 dose on the high-
       risk branch. The game never tells the player "trainees are
       riskier" — you learn from the casualty. */
    traineeFirstCall: {
      title: 'V-12 PRESSURE CHECK — FIRST RUN',
      system: 'basinc',
      intro: 'New voice on the channel. Trainee on his first solo dispatch. Pressure trim at V-12.',
      steps: [
        {
          prompt: '"Control? It\'s ALEKSEI. I\'m at V-12. Foreman said you\'d guide me through. Pressure reads 58. What do you want me to do?"',
          choices: [
            { label: '[ TRIM SOLO — IT\'S ROUTINE ]',
              risk: 'crit', dose: 0.55, fix: 'basinc',  next: 1 },
            { label: '[ HOLD — CALL FOREMAN TO VERIFY ]',
              risk: 'safe', dose: 0.05,                  next: 2 },
            { label: '[ SCRAP IT — RETURN TO CONTROL ]',
              risk: 'safe', dose: 0.01, abort: true,
              response: '"Copy. Heading back. Sorry I bothered you."' }
          ]
        },
        /* Step 1 — sent alone. Trainee struggles, takes the dose. */
        {
          prompt: '"It—it slipped. The valve. I tried to brace it. My—my arm. I\'m okay. I think I\'m okay."',
          choices: [
            { label: '[ ORDER HIM OUT — NOW ]',
              risk: 'safe', dose: 0.05, abort: true,
              response: '"Yes sir. Coming back."' },
            { label: '[ FINISH THE TRIM — YOU\'RE THERE ]',
              risk: 'crit', dose: 0.45, fix: 'basinc', abort: true,
              response: '"…okay. Okay. Doing it."' }
          ]
        },
        /* Step 2 — verify with foreman. Safe, but slower. */
        {
          prompt: '"Foreman here. Trim looks standard. I\'ll walk him through it. Stand by."',
          choices: [
            { label: '[ STAND BY. ]',
              risk: 'safe', dose: 0.05, fix: 'basinc', abort: true,
              response: '"Done. Trainee\'s logged the procedure. Returning."' }
          ]
        }
      ]
    },

    /* Sprint I.2 — WITNESS. Fires once at shift 6+. Worker reports
       seeing something irregular during a routine check. Three
       choices, immediate costs only (no hidden deferred state to
       keep the system simple). */
    witness: {
      title: 'CORRIDOR D — ROUTINE WALK',
      system: 'radiation',
      intro: 'Routine corridor walk. Operator radio open.',
      steps: [
        {
          prompt: '"Control, I\'m on corridor D. There\'s a— there\'s something here that shouldn\'t be. A body bag. Marked PROPERTY OF FACILITY 4. There\'s no manifest entry for it. What do I do?"',
          choices: [
            { label: '[ YOU SAW NOTHING. RETURN. ]',
              risk: 'risk', dose: 0.02, fix: 'radSpike', abort: true,
              response: '"…copy. I didn\'t see anything. Returning."' },
            { label: '[ INVESTIGATE — OPEN THE TAG ]',
              risk: 'risk', dose: 0.18, fix: 'radiation', abort: true,
              response: '"Tag\'s blank. There\'s a— there\'s a name on the inside. I\'ll come find you."' },
            { label: '[ IGNORE — CONTINUE ROUNDS ]',
              risk: 'safe', dose: 0.02, abort: true,
              response: '"…understood. Continuing."' }
          ]
        }
      ]
    },

    /* Sprint F — fires when a survey was left unresolved (timeout
       or wrong mark). Patrol worker is forced to choose between
       crossing the contaminated zone or rerouting. Both choices
       cost; the player can't escape clean. */
    hotspotCross: {
      title: 'CORRIDOR ROUTING — BLOCK C',
      system: 'radiation',
      intro: 'Patrol radio open. Unmarked hot zone reported in corridor C-7.',
      steps: [
        {
          prompt: '"Control, I need to cross C-7 to reach my checkpoint. The zone\'s not tagged. Geiger\'s reading 0.8 Sv/hr. Do I pass or reroute?"',
          choices: [
            { label: '[ ALLOW PASS — TAG ON THE WAY ]',
              risk: 'crit', dose: 0.40, fix: 'radiation', next: 1 },
            { label: '[ ORDER DETOUR — LEAVE IT ]',
              risk: 'safe', dose: 0.02, fix: 'radSpike',  next: 2 }
          ]
        },
        /* Step 1: allowed */
        {
          prompt: '"Through. Tagged the source on the way. Burning a little. Heading to medical after checkpoint."',
          choices: [
            { label: '[ ACKNOWLEDGE. ]', risk: 'safe', dose: 0.01, abort: true,
              response: '"Logged. Get checked. Cleared to return."' }
          ]
        },
        /* Step 2: detour ordered */
        {
          prompt: '"Copy. Rerouting through Block B. Checkpoint will be late. Zone stays open."',
          choices: [
            { label: '[ ACKNOWLEDGE. ]', risk: 'safe', dose: 0.01, abort: true,
              response: '"Understood. Continue."' }
          ]
        }
      ]
    },

    valveLeak: {
      title: 'VALVE BLOCK V-3 INSPECTION',
      system: 'basinc',
      intro: 'Spike in pressure line. Worker approaches Valve Block V-3.',
      steps: [
        {
          prompt: '"I\'m at the access door. Geiger reading 0.4 Sv/hr. Should I go in?"',
          choices: [
            { label: '[ ENTER — FIND THE LEAK ]',        risk: 'risk', dose: 0.25, next: 1 },
            { label: '[ STAY OUT — EXTERNAL CHECK ]',    risk: 'safe', dose: 0.05, next: 2 },
            { label: '[ RETURN TO CONTROL ]',            risk: 'safe', dose: 0.02, abort: true,
              response: '"Copy that. Heading back."' }
          ]
        },
        {
          prompt: '"Crack in the housing. Leak is active. I need to seal it."',
          choices: [
            { label: '[ SEAL NOW — STAY IN ROOM ]',      risk: 'crit', dose: 0.40, fix: 'basinc',  next: 3 },
            { label: '[ CALL ENGINEER — WAIT OUTSIDE ]', risk: 'safe', dose: 0.05, fix: 'basinc',  next: 3 },
            { label: '[ ABORT — TOO HOT ]',              risk: 'safe', dose: 0.03, abort: true,
              response: '"Understood. Pulling out."' }
          ]
        },
        /* Step 2: stayed out */
        {
          prompt: '"Can\'t see clearly from outside. Couldn\'t spot anything."',
          choices: [
            { label: '[ PUSH IN NOW ]',                  risk: 'risk', dose: 0.30, next: 1 },
            { label: '[ LEAVE IT. RETURN. ]',            risk: 'safe', dose: 0.02, abort: true,
              response: '"Understood."' }
          ]
        },
        /* Step 3: resolved */
        {
          prompt: '"Seal\'s holding. Job\'s done. Heading back."',
          choices: [
            { label: '[ ACKNOWLEDGE. RETURN. ]',         risk: 'safe', dose: 0.01, abort: true,
              response: '"Good work. Cleared to return."' }
          ]
        }
      ]
    },

    filterSwap: {
      title: 'VENTILATION FILTER SWAP — LVL 2',
      system: 'radiation',
      intro: 'Level-2 ventilation filter saturated. Rad bleed into corridor.',
      steps: [
        {
          prompt: '"I\'m outside the filter room. Air isn\'t being scrubbed. Swap now?"',
          choices: [
            { label: '[ SWAP NOW — RUSH IT ]',           risk: 'crit', dose: 0.45, fix: 'radiation', next: 2 },
            { label: '[ WAIT FOR LEVEL-B SUIT ]',        risk: 'risk', dose: 0.10, next: 1 },
            { label: '[ ABORT — ORDER FROM BLOCK A ]',   risk: 'safe', dose: 0.02, abort: true,
              response: '"Copy. Heading back."' }
          ]
        },
        {
          prompt: '"Level-B gear\'s here. Suited up. Proceed?"',
          choices: [
            { label: '[ PROCEED WITH SWAP ]',            risk: 'risk', dose: 0.20, fix: 'radiation', next: 2 },
            { label: '[ ABORT. NOT WORTH IT. ]',         risk: 'safe', dose: 0.03, abort: true,
              response: '"Understood. Pulling out."' }
          ]
        },
        {
          prompt: '"New filter installed. Air\'s clearing."',
          choices: [
            { label: '[ ACKNOWLEDGE. ]',                 risk: 'safe', dose: 0.01, abort: true,
              response: '"Good work. Come on back."' }
          ]
        }
      ]
    },

    thermalCheck: {
      title: 'COOLING LOOP 2 INSPECTION',
      system: 'sicaklik',
      intro: 'Temperature anomaly detected. Worker at loop-2 inspection hatch.',
      steps: [
        {
          prompt: '"Pipe\'s hot. Temp gauge is dead. Want a manual reading?"',
          choices: [
            { label: '[ MANUAL READ — HAND ON PIPE ]',   risk: 'risk', dose: 0.20, fix: 'sicaklik', next: 2 },
            { label: '[ USE INFRARED GUN — FROM 3M ]',   risk: 'safe', dose: 0.05, next: 1 },
            { label: '[ ABORT. ]',                       risk: 'safe', dose: 0.02, abort: true,
              response: '"Understood."' }
          ]
        },
        {
          prompt: '"IR gun ready. Reading 78°C. Want me to correct it?"',
          choices: [
            { label: '[ ADJUST MANUAL VALVE ]',          risk: 'risk', dose: 0.12, fix: 'sicaklik', next: 2 },
            { label: '[ REPORT AND RETURN ]',            risk: 'safe', dose: 0.02, abort: true,
              response: '"Reading logged. On my way back."' }
          ]
        },
        {
          prompt: '"Corrected. Values dropping back to nominal."',
          choices: [
            { label: '[ GOOD. RETURN. ]',                risk: 'safe', dose: 0.01, abort: true,
              response: '"Thanks. You\'re clear."' }
          ]
        }
      ]
    },

    routineRound: {
      title: 'ROUTINE CORRIDOR ROUND',
      system: null,
      intro: 'Regulation check. Worker performs standard walk-down.',
      steps: [
        {
          prompt: '"Routine round. Any specific points you want me to check?"',
          choices: [
            { label: '[ CHECK DOSIMETER BADGE POINTS ]', risk: 'safe', dose: 0.06, next: 1 },
            { label: '[ CHECK FIRE SUPPRESSION POINTS ]',risk: 'safe', dose: 0.05, next: 1 },
            { label: '[ ABORT. JUST REPORT. ]',          risk: 'safe', dose: 0.01, abort: true,
              response: '"Copy that."' }
          ]
        },
        {
          prompt: '"All points checked. Everything reads nominal."',
          choices: [
            { label: '[ LOG AND RETURN. ]',              risk: 'safe', dose: 0.01, abort: true,
              response: '"Good. Come on back."' }
          ]
        }
      ]
    }
  }

  /* ── Active dispatch state ─────────────────────────────────────── */
  var _active = null   // { worker, scriptId, script, stepIdx }
  var _logCooldown = 0
  /* Initial dispatch appears ~30-60 s into the shift so the player
     gets a real interaction quickly instead of a long quiet open;
     subsequent dispatches use _scheduleNext()'s slower cadence. */
  var _nextSpawnSec = (30 + Math.random() * 30) * _shiftDispMult

  /* ── Helpers ───────────────────────────────────────────────────── */
  function _fmtClock() {
    try {
      var el = document.getElementById('game-clock')
      return el ? el.textContent : '--:--'
    } catch(e) { return '--:--' }
  }
  function _doseColor(dose) {
    if (dose >= 1.5) return 'crit'
    if (dose >= 0.8) return 'warn'
    return 'ok'
  }
  function _idleWorkers() {
    return ROSTER.filter(function(w) { return _roster.dead.indexOf(w.id) === -1 })
  }
  function _pickWorker() {
    var pool = _idleWorkers()
    if (pool.length === 0) return null
    /* Bias toward lower-dose workers so the same one doesn't die immediately */
    pool.sort(function(a, b) { return _roster.doses[a.id] - _roster.doses[b.id] })
    var idx = Math.floor(Math.random() * Math.min(pool.length, 5))
    return pool[idx]
  }

  /* ── DOM renderers ─────────────────────────────────────────────── */
  var _typeTimer = null
  function _pushLine(text, cls, opts) {
    opts = opts || {}
    var d = document.createElement('div')
    d.className = 'dp-line ' + (cls || '')
    var ts = document.createElement('span')
    ts.className = 'dp-line-ts'
    ts.textContent = _fmtClock()
    d.appendChild(ts)
    var body = document.createTextNode('')
    d.appendChild(body)
    _dpTrans.appendChild(d)
    _dpTrans.scrollTop = _dpTrans.scrollHeight

    if (opts.typewriter) {
      _typewrite(body, text, function() {
        if (typeof opts.onDone === 'function') opts.onDone()
      })
    } else {
      body.nodeValue = text
      if (typeof opts.onDone === 'function') opts.onDone()
    }
    return d
  }
  function _typewrite(node, text, onDone) {
    if (_typeTimer) { clearTimeout(_typeTimer); _typeTimer = null }
    var i = 0
    function step() {
      if (i >= text.length) { _typeTimer = null; if (onDone) onDone(); return }
      var ch = text.charAt(i)
      node.nodeValue += ch
      _dpTrans.scrollTop = _dpTrans.scrollHeight
      /* Audible tick for non-whitespace glyphs — the type sfx throttles
         itself internally so very dense runs don't machine-gun. */
      if (ch !== ' ' && ch !== '\n' && ch !== '\t' &&
          window.hoverSfx && typeof window.hoverSfx.type === 'function') {
        try { window.hoverSfx.type() } catch(e){}
      }
      i++
      var delay = 28
      if (ch === '.' || ch === '?' || ch === '!') delay = 220
      else if (ch === ',' || ch === ';' || ch === ':') delay = 140
      else if (ch === ' ') delay = 34
      _typeTimer = setTimeout(step, delay)
    }
    step()
  }
  function _clearTranscript() {
    if (_typeTimer) { clearTimeout(_typeTimer); _typeTimer = null }
    _dpTrans.innerHTML = ''
  }

  function _renderWorker(w) {
    if (w) {
      _dpPortrait.textContent = _portraits[w.id] || ''
      _dpWId.textContent   = w.id.toUpperCase()
      _dpWName.textContent = w.name
      /* Faz 2 / C — uncovered demand-shift garbles HR data:
         age readout goes to ?? so the player can't easily judge
         mortality risk. Role is preserved (needed to pick the
         right specialist for the task). */
      _dpWAge.textContent  = _demandShiftUncovered() ? '??' : w.age
      _dpWRole.textContent = w.role
    } else {
      _dpPortrait.textContent = '          /////////////\n          ////// // // ///\n          //  no active  //\n          //   contact   //\n          /////////////////'
      _dpWId.textContent = '——'; _dpWName.textContent = '——'
      _dpWAge.textContent = '——'; _dpWRole.textContent = '——'
    }
    _renderDose(w)
  }
  function _renderDose(w) {
    if (!w) { _dpWDose.textContent = '0.00 Sv'; _dpWDoseFill.style.width = '0%'; return }
    var d = _roster.doses[w.id] || 0
    /* Faz 2 / C — uncovered demand-shift garbles dose readout.
       Roster's real dose still accrues; only the displayed value
       is hidden. Bar resets to neutral 50% to remove the visual
       hint about safety. */
    if (_demandShiftUncovered()) {
      _dpWDose.textContent = '??.?? Sv'
      _dpWDoseFill.style.width = '50%'
      _dpWDoseFill.classList.remove('dp-dose-warn', 'dp-dose-crit')
      return
    }
    _dpWDose.textContent = d.toFixed(2) + ' Sv'
    _dpWDoseFill.style.width = Math.min(100, d / 2.0 * 100).toFixed(0) + '%'
    _dpWDoseFill.classList.remove('dp-dose-warn', 'dp-dose-crit')
    var col = _doseColor(d)
    if (col === 'warn') _dpWDoseFill.classList.add('dp-dose-warn')
    if (col === 'crit') _dpWDoseFill.classList.add('dp-dose-crit')
  }

  function _renderChoices(step) {
    _dpActions.innerHTML = ''
    step.choices.forEach(function(c) {
      var b = document.createElement('button')
      b.className = 'dp-btn'
      if (c.risk === 'risk') b.classList.add('dp-btn-risk')
      if (c.risk === 'crit') b.classList.add('dp-btn-crit')
      b.textContent = c.label
      b.addEventListener('click', function() { _onChoice(c) })
      _dpActions.appendChild(b)
    })
  }
  function _clearActions() { _dpActions.innerHTML = '' }

  function _setStatus(label, state) {
    _dpStatus.textContent = label
    _dpPanel.classList.remove('dp-active', 'dp-dead', 'dpo-dead')
    if (state === 'active') _dpPanel.classList.add('dp-active')
    if (state === 'dead')   _dpPanel.classList.add('dp-dead', 'dpo-dead')
    _dpTitle.textContent = (state === 'dead') ? '// DISPATCH — CASUALTY' :
                           (state === 'active') ? '// DISPATCH — ACTIVE' :
                           '// DISPATCH — STANDBY'
  }

  /* ── Overlay show / hide ──────────────────────────────────────────
     Option-B design: active dispatch pops a full-column overlay so
     the conversation is actually readable. Sensors column remains
     visible because the overlay is absolutely positioned inside
     #mini-games (see CSS). */
  function _showOverlay() {
    if (!_dpPanel) return
    _dpPanel.classList.remove('dpo-closing')
    _dpPanel.style.display = 'flex'
  }
  function _hideOverlay() {
    if (!_dpPanel) return
    _dpPanel.classList.add('dpo-closing')
    setTimeout(function() {
      if (!_active) {                  // only hide if still idle
        _dpPanel.style.display = 'none'
        _dpPanel.classList.remove('dpo-closing')
        /* Defensive net: any code path that hides the dispatch
           overlay should also resume game time. Unfreeze is idempotent
           (no-op if already running) so this is safe even on the
           normal _endDispatch path. */
        if (window.__gameTime) window.__gameTime.unfreeze()
      }
    }, 280)
  }

  /* ── Choose an event script based on current plant state ───────── */
  function _pickScript() {
    if (!gameState) return 'routineRound'
    /* Sprint F — top-priority story hook: if the player let a survey
       lapse and the patrol is overdue (≥120 game-sec since fail),
       force the hotspot-cross dispatch. Marks fired+clears tracker so
       it only ever spawns once per unresolved hotspot. */
    if (gameState._unresolvedHotspot && !gameState._unresolvedHotspot.fired &&
        typeof _gcElapsed !== 'undefined' &&
        (_gcElapsed - gameState._unresolvedHotspot.ts) >= 120) {
      gameState._unresolvedHotspot.fired = true
      gameState._unresolvedHotspot = null
      return 'hotspotCross'
    }
    /* Sprint I.2 — Shift-pinned scripts. Each fires exactly once
       per save run on its target shift, on the first dispatch of
       that shift. Tracked in save._shiftScriptsFired so a player
       can't replay them by reloading. */
    try {
      if (window.saveSystem) {
        var _sv = saveSystem.loadGame()
        var _fired = _sv._shiftScriptsFired || {}
        if (_sv.shiftNumber === 2 && !_fired.trainee) {
          _fired.trainee = true
          _sv._shiftScriptsFired = _fired
          saveSystem.saveGame(_sv)
          return 'traineeFirstCall'
        }
        if (_sv.shiftNumber === 3 && !_fired.familyNote) {
          _fired.familyNote = true
          _sv._shiftScriptsFired = _fired
          saveSystem.saveGame(_sv)
          return 'familyNote'
        }
        if (_sv.shiftNumber === 4 && !_fired.coffeeRun) {
          _fired.coffeeRun = true
          _sv._shiftScriptsFired = _fired
          saveSystem.saveGame(_sv)
          return 'coffeeRun'
        }
        if (_sv.shiftNumber === 5 && !_fired.refusal) {
          _fired.refusal = true
          _sv._shiftScriptsFired = _fired
          saveSystem.saveGame(_sv)
          return 'refusal'
        }
        if (_sv.shiftNumber >= 6 && !_fired.witness) {
          _fired.witness = true
          _sv._shiftScriptsFired = _fired
          saveSystem.saveGame(_sv)
          return 'witness'
        }
      }
    } catch(e){}
    /* Stress-weighted: match most-stressed system */
    var s = gameState.systemStatus || {}
    var rad = (sensorState && sensorState.B && sensorState.B.values && sensorState.B.values.radiation)
              ? sensorState.B.values.radiation.v : 0
    if (rad > 1.8) return 'filterSwap'
    if (s.basinc === 'warn' || s.basinc === 'crit')     return 'valveLeak'
    if (s.sicaklik === 'warn' || s.sicaklik === 'crit') return 'thermalCheck'
    if (s.guc === 'warn' || s.guc === 'crit')           return 'thermalCheck'
    return 'routineRound'
  }

  /* ── Begin a new dispatch ──────────────────────────────────────── */
  function _startDispatch() {
    var scriptId = _pickScript()
    var script = SCRIPTS[scriptId]
    /* Sprint I.2 + Senaryo — named-worker pin for scripted dispatches.
       Falls back to normal _pickWorker() if the named worker is dead. */
    var _NAMED = {
      traineeFirstCall: ['w05', 'w09'],   // ALEKSEI / OLGA (trainees)
      familyNote:       ['w07'],          // NATALYA (rad-control)
      coffeeRun:        ['w02'],          // VIKTOR  (sr. mechanic)
      refusal:          ['w08']           // IRINA   (valve tech)
    }
    var w = null
    if (_NAMED[scriptId]) {
      var pool = _NAMED[scriptId]
      for (var _pi = 0; _pi < pool.length; _pi++) {
        var _cand = (typeof ROSTER !== 'undefined')
          ? ROSTER.find(function(r){ return r.id === pool[_pi] && (_roster.dead||[]).indexOf(r.id) === -1 })
          : null
        if (_cand) { w = _cand; break }
      }
    }
    /* Senaryo — Coffee run: VIKTOR is unavailable for ~20 game-min
       after the player accepted his coffee offer. Pick anyone else. */
    if (!w || (gameState._coffeeRunnerUntil && _gcElapsed < gameState._coffeeRunnerUntil &&
               w && w.id === 'w02')) {
      var _origPick = _pickWorker
      /* Temporarily skip VIKTOR during coffee window */
      if (gameState._coffeeRunnerUntil && _gcElapsed < gameState._coffeeRunnerUntil) {
        var _saved = (_roster.dead || []).slice()
        if (_saved.indexOf('w02') === -1) _roster.dead.push('w02')
        try { w = _origPick() } finally {
          _roster.dead = _saved
        }
      } else if (!w) {
        w = _origPick()
      }
    }
    if (!w) { _pushLine('// All workers unavailable.', 'dp-line-crit'); return }
    _active = { worker: w, scriptId: scriptId, script: script, stepIdx: 0 }
    _roster.dispatches++
    _saveRoster()

    /* Freeze the shift clock + deterioration ticks. Dispatch is a
       full-screen take-over and the operator is fully occupied —
       letting time march on (especially at 4×) creates the stuck-at-
       06:00 bug where shift-end can't fire after dispatch closes. */
    if (window.__gameTime) window.__gameTime.freeze()

    _clearTranscript()
    _renderWorker(w)
    _setStatus('LIVE', 'active')
    _clearActions()
    _showOverlay()
    _pushLine(script.intro, 'dp-line-sys')
    _pushLine('→ ' + script.title, 'dp-line-sys')
    setTimeout(function() {
      _pushLine('"' + w.name + ' on channel. Location secured. Awaiting orders."', 'dp-line-worker', {
        typewriter: true,
        onDone: function() { setTimeout(function() { _showStep(0) }, 450) }
      })
    }, 600)
    _mgFlagAlert('dispatch')

    if (typeof addLog === 'function')
      addLog('DISPATCH — ' + w.name + ' assigned to ' + script.title + '.', 'normal')
  }

  function _showStep(idx) {
    if (!_active) return
    var step = _active.script.steps[idx]
    if (!step) { _endDispatch(); return }
    _clearActions()
    _pushLine(step.prompt, 'dp-line-worker', {
      typewriter: true,
      onDone: function() {
        if (!_active || _active.script.steps[idx] !== step) return
        setTimeout(function() {
          if (_active && _active.script.steps[idx] === step) _renderChoices(step)
        }, 300)
      }
    })
  }

  /* ── Handle a choice ───────────────────────────────────────────── */
  function _onChoice(c) {
    if (!_active) return
    var w = _active.worker

    /* Prevent double-click / race: disable buttons immediately */
    _clearActions()

    /* Log player's pick instantly (no typewriter — it's your own voice) */
    _pushLine('YOU: ' + c.label, 'dp-line-you')

    /* Dose accrues */
    _roster.doses[w.id] = (_roster.doses[w.id] || 0) + (c.dose || 0)
    _saveRoster()
    _renderDose(w)

    /* Death check — worker collapses at >= 2.0 Sv */
    if (_roster.doses[w.id] >= 2.0) {
      setTimeout(function() { _killWorker(w, c) }, 700)
      return
    }

    /* Apply plant-side effect after a short beat */
    var doAdvance = function() {
      var nextIdx = (typeof c.next === 'number') ? c.next : (_active.stepIdx + 1)
      _active.stepIdx = nextIdx
      _showStep(nextIdx)
    }

    setTimeout(function() {
      if (!_active) return
      if (c.fix) _applyFix(c.fix)
      if (c.response) {
        _pushLine(c.response, 'dp-line-worker', {
          typewriter: true,
          onDone: function() {
            if (c.abort) {
              setTimeout(function() { _endDispatch() }, 600)
            } else {
              setTimeout(doAdvance, 500)
            }
          }
        })
      } else {
        if (c.abort) setTimeout(function() { _endDispatch() }, 500)
        else setTimeout(doAdvance, 700)
      }
    }, 550)
  }

  /* ── Plant-state effect of a fix ───────────────────────────────── */
  function _applyFix(kind) {
    try {
      if (kind === 'radiation' && sensorState && sensorState.B && sensorState.B.values.radiation) {
        sensorState.B.values.radiation.v = Math.max(0.3, sensorState.B.values.radiation.v - 0.6)
        _pushLine('// Radiation bleed sealed. Level dropping.', 'dp-line-sys')
      }
      else if (kind === 'radSpike' && sensorState && sensorState.B && sensorState.B.values.radiation) {
        /* Sprint F — detour penalty: nobody tagged the hot zone, rad
           keeps bleeding into corridor sensors. Player feels the cost
           of the "safe" choice. */
        sensorState.B.values.radiation.v = Math.min(9.9, sensorState.B.values.radiation.v + 0.50)
        _pushLine('// Zone untagged. Corridor sensors trending up.', 'dp-line-crit')
      }
      else if (kind === 'coffeeYes') {
        /* Senaryo Shift 4 — VIKTOR is on a 20 game-min coffee run.
           The next dispatch will pick a backup instead of him. */
        try {
          if (typeof _gcElapsed !== 'undefined') {
            gameState._coffeeRunnerUntil = _gcElapsed + 20
          }
        } catch(e){}
        _pushLine('// Mechanic walking to mess. Channel briefly thin.', 'dp-line-sys')
      }
      else if (kind === 'sicaklik' && SYSTEMS && SYSTEMS.sicaklik) {
        var mid = (SYSTEMS.sicaklik.safe[0] + SYSTEMS.sicaklik.safe[1]) / 2
        gameState.systemValues.sicaklik = mid
        gameState.critSeconds.sicaklik  = 0
        _pushLine('// Cooling loop re-aligned. Temperature stabilising.', 'dp-line-sys')
      }
      else if (kind === 'basinc' && SYSTEMS && SYSTEMS.basinc) {
        var midP = (SYSTEMS.basinc.safe[0] + SYSTEMS.basinc.safe[1]) / 2
        gameState.systemValues.basinc = midP
        gameState.critSeconds.basinc  = 0
        _pushLine('// Valve sealed. Pressure returning to nominal.', 'dp-line-sys')
      }
      else if (kind === 'guc') {
        var midG = (SYSTEMS.guc.safe[0] + SYSTEMS.guc.safe[1]) / 2
        gameState.systemValues.guc = midG
        gameState.critSeconds.guc  = 0
        _pushLine('// Power regulator cleared. Output stable.', 'dp-line-sys')
      }
    } catch(e) { console.warn('[dispatch] fix failed', e) }
  }

  /* Sprint I.1 — last-transmission pool. Picked at random when a
     worker dies. Mix of: half-finished pleas (player fills the gap),
     dissociated observations (radiation poisoning makes you weird),
     pure silence. The point is to deny the player a clean line they
     can dismiss — every option lingers. */
  var _LAST_WORDS = [
    '"Tell my mother I—"',
    '"I can see the wall. It\'s glowing."',
    '"It doesn\'t even hurt anymore."',
    '"Please don\'t list me first."',
    '"Cold. So cold."',
    '"I\'m sorry."',
    '"You said it was—"',
    '"My daughter\'s name is—"',
    '[ NO SIGNAL — STATIC ]',
    '[ CHANNEL OPEN — NO RESPONSE ]'
  ]

  /* ── Worker dies ───────────────────────────────────────────────── */
  function _killWorker(w, choice) {
    _roster.dead.push(w.id)
    _saveRoster()
    /* Faz 2/E — per-shift counter for news continuity inject */
    try { gameState.workerDeathsThisShift = (gameState.workerDeathsThisShift || 0) + 1 } catch(e){}
    /* Sync to main save — elevates Elena tone, surfaces in news */
    try {
      if (window.saveSystem) {
        var sv = saveSystem.loadGame()
        sv.workerDeaths  = (sv.workerDeaths || 0) + 1
        /* Every 2 deaths nudges Elena tone one step darker */
        if (sv.workerDeaths % 2 === 0) sv.elenaToneLevel = Math.min(3, (sv.elenaToneLevel || 0) + 1)
        saveSystem.saveGame(sv)
      }
    } catch(e){}

    /* Sprint I.1 — Memorial entry. Persistent across all shifts so
       the player can browse who they killed, with the exact choice
       label that put them there. */
    try {
      var sv2 = window.saveSystem ? saveSystem.loadGame() : null
      var mem = JSON.parse(localStorage.getItem('thermalMemorial') || '[]')
      mem.push({
        id:          w.id,
        name:        w.name,
        age:         w.age,
        role:        w.role,
        shiftDied:   (sv2 && sv2.shiftNumber) ? sv2.shiftNumber : 0,
        choiceLabel: (choice && choice.label) ? choice.label : '[ UNKNOWN ]',
        doseAtDeath: parseFloat((_roster.doses[w.id] || 0).toFixed(2)),
        ts:          Date.now()
      })
      localStorage.setItem('thermalMemorial', JSON.stringify(mem))
    } catch(e){}

    /* Sprint I.1 — Paced death reveal. Five beats so the player can't
       click past the moment:
         1) collapse announcement      (immediate)
         2) 1.5s silence
         3) dose readout               (cold number)
         4) 0.9s silence
         5) FINAL TRANSMISSION line    (typewritten — slow)
         6) 2.0s lockout while CASUALTY status flashes
         7) ACKNOWLEDGE enables
       Every step is intentionally slow. The player is supposed to
       sit with it. */
    _pushLine('⚠ ' + w.name + ' COLLAPSED. NO RESPONSE ON CHANNEL.', 'dp-line-crit')
    _setStatus('CASUALTY', 'dead')
    _clearActions()

    /* Use captured native setTimeout so pause/speed don't compress
       the moment. If the player hits P during a death, the silence
       should still feel like silence — not a 4× skip. */
    var _delay = (typeof _origST === 'function')
      ? function(fn, ms) { return _origST(fn, ms) }
      : function(fn, ms) { return setTimeout(fn, ms) }

    _delay(function() {
      if (!_active) return
      _pushLine('// Dose at time of incident: ' + _roster.doses[w.id].toFixed(2) + ' Sv', 'dp-line-crit')

      _delay(function() {
        if (!_active) return
        var lw = _LAST_WORDS[Math.floor(Math.random() * _LAST_WORDS.length)]
        _pushLine('// FINAL TRANSMISSION:', 'dp-line-crit')
        _pushLine(lw, 'dp-line-worker', { typewriter: true, onDone: function() {

          /* Buton hâlâ kilitli — 2 sn daha bekle */
          _delay(function() {
            if (!_active) return
            var ok = document.createElement('button')
            ok.className = 'dp-btn dp-btn-crit'
            ok.textContent = '[ ACKNOWLEDGE ]'
            ok.addEventListener('click', function() {
              _active = null
              _setStatus('IDLE')
              _renderWorker(null)
              _pushLine('// Channel closed.', 'dp-line-sys')
              _clearActions()
              _hideOverlay()
              _scheduleNext()
              /* CRITICAL: this ACKNOWLEDGE path bypasses _endDispatch() so we
                 must explicitly resume the game clock. Without this the
                 player's dispatch ends but time stays frozen forever — the
                 clock can never reach 06:00, endShift never fires, scene
                 can never change. */
              if (window.__gameTime) window.__gameTime.unfreeze()
            })
            _dpActions.appendChild(ok)
          }, 2000)

        }})
      }, 900)
    }, 1500)

    if (typeof addLog === 'function')
      addLog('⚠ OPERATOR LOSS — ' + w.name + ' collapsed during dispatch. Notify next-of-kin protocol initiated.', 'anomaly')
    if (typeof _logAnom === 'function')
      _logAnom('OPERATOR DEATH — ' + w.name + ' (' + w.age + ') ' + w.role + '.', 'lo')
    _mgFlagAlert('dispatch')
  }

  function _endDispatch() {
    if (!_active) return
    _pushLine('// Dispatch closed. Channel idle.', 'dp-line-sys')
    _setStatus('IDLE')
    _active = null
    _clearActions()
    _renderWorker(null)
    _hideOverlay()
    _scheduleNext()
    /* Resume the shift clock at the player's chosen speed. Includes
       the defensive endShift() trigger if 06:00 was reached during
       the freeze. */
    if (window.__gameTime) window.__gameTime.unfreeze()
  }

  function _scheduleNext() {
    /* Next dispatch 2.5-5.5 min away at baseline; tightened on later
       shifts so seasoned operators field more calls per night. */
    _nextSpawnSec = (150 + Math.random() * 180) * _shiftDispMult
  }

  /* ── Spawn ticker — counts down once per real second ───────────── */
  setInterval(function() {
    if (_active) return
    if (!gameState || gameState.systemFailure) return
    /* Block dispatch while a system error is active — the operator is
       already overwhelmed; piling a worker call on top would be unfair.
       The countdown also pauses so dispatch resumes shortly after the
       ER is cleared rather than firing immediately. */
    if (window.errorSystem && window.errorSystem.isActive()) return
    /* Decrement scaled by current game speed — at 4× this counts
       down 4× faster so dispatches arrive at proportional cadence. */
    var spd = (typeof _gcSpeed === 'number' && _gcSpeed > 0) ? _gcSpeed : 1
    _nextSpawnSec -= spd
    /* Sprint F — overdue hotspot force-triggers the next dispatch so
       the story event doesn't get delayed by a long natural cooldown.
       Cap the wait at ~150 game-sec since survey fail. */
    if (gameState && gameState._unresolvedHotspot && !gameState._unresolvedHotspot.fired &&
        typeof _gcElapsed !== 'undefined' &&
        (_gcElapsed - gameState._unresolvedHotspot.ts) >= 120 && _nextSpawnSec > 0) {
      _nextSpawnSec = 0
    }
    if (_nextSpawnSec <= 0) _startDispatch()
  }, 1000)

  /* ── Debug hook — force-trigger a dispatch from the F1 panel ──── */
  window.__dispatchDebug = {
    start: function() {
      if (_active) return                 // don't stomp an active call
      _nextSpawnSec = 0                   // reset timer for the next natural cycle
      _startDispatch()
    },
    end: _endDispatch
  }

  /* ── Init ──────────────────────────────────────────────────────── */
  _renderWorker(null)
  _setStatus('IDLE')
})()


/* ═══════════════════════════════════════════════════════════════════
   SURVEY — Geiger Probe mini-game
   ─────────────────────────────────────────────────────────────────
   An invisible hot spot spawns on an 8×5 reactor floorplan grid.
   Mouse proximity to the hot spot increases geiger click rate (audio).
   Player marks the cell they believe holds the spot. Searching costs
   cumulative player dose — high player dose carries across shifts.
   ═══════════════════════════════════════════════════════════════════ */
;(function() {
  var COLS = 8, ROWS = 5
  var _floor   = document.getElementById('sv-floorplan')
  var _svPanel = document.getElementById('survey-monitor')
  var _svStatus= document.getElementById('sv-status')
  var _svCps   = document.getElementById('sv-cps')
  var _svMeter = document.getElementById('sv-meter-fill')
  var _svDose  = document.getElementById('sv-dose')
  var _svTimer = document.getElementById('sv-timer')
  var _svMark  = document.getElementById('sv-mark')
  var _svHint  = document.getElementById('sv-hint')

  /* ── Build grid cells once ─────────────────────────────────────── */
  var _cells = []
  ;(function build() {
    var ROOM_NAMES = [
      ['A1','A2','A3','A4','A5','A6','A7','A8'],
      ['B1','B2','B3','B4','B5','B6','B7','B8'],
      ['C1','C2','C3','C4','C5','C6','C7','C8'],
      ['D1','D2','D3','D4','D5','D6','D7','D8'],
      ['E1','E2','E3','E4','E5','E6','E7','E8'],
    ]
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cell = document.createElement('div')
        cell.className = 'sv-cell'
        cell.dataset.x = c
        cell.dataset.y = r
        cell.textContent = ROOM_NAMES[r][c]
        ;(function(cc, rr, el) {
          el.addEventListener('mouseenter', function() { _onHover(cc, rr, el) })
          el.addEventListener('mouseleave', function() { el.classList.remove('sv-cell-hover') })
          el.addEventListener('click',      function() { _onCellClick(cc, rr, el) })
        })(c, r, cell)
        _floor.appendChild(cell)
        _cells.push(cell)
      }
    }
  })()

  /* ── Web Audio geiger clicker (autoplay-policy disabled in main.js) ─ */
  var _audio = null, _audioReady = false
  function _initAudio() {
    if (_audioReady) return
    try {
      _audio = new (window.AudioContext || window.webkitAudioContext)()
      _audioReady = true
      if (_audio.state === 'suspended') { try { _audio.resume() } catch(e){} }
    } catch(e) { _audioReady = false }
  }
  /* Eager init — Electron's autoplay-policy flag lets us start without gesture. */
  try { _initAudio() } catch(e) {}
  function _geigerClick() {
    if (!_audioReady) return
    try {
      var t = _audio.currentTime
      var osc = _audio.createOscillator()
      var g   = _audio.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(1800 + Math.random() * 600, t)
      g.gain.setValueAtTime(0.08, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
      osc.connect(g); g.connect(_audio.destination)
      osc.start(t); osc.stop(t + 0.04)
    } catch(e){}
  }

  /* ── Survey state ──────────────────────────────────────────────── */
  var _sv = {
    active:     false,
    hotX:       0,
    hotY:       0,
    curX:       -1,   // live cursor position (drives audio + meter)
    curY:       -1,
    selX:       -1,   // committed selection (what MARK SPOT acts on)
    selY:       -1,
    timeLeft:   60,
    nextSpawn:  90 + Math.random() * 40,
    lastClick:  0,
  }

  /* ── Distance helper (Chebyshev for grid feel) ─────────────────── */
  function _dist(x, y) {
    return Math.max(Math.abs(x - _sv.hotX), Math.abs(y - _sv.hotY))
  }
  /* Click rate ramps from 1 cps (far) to 25 cps (at hot spot) */
  function _cpsAt(x, y) {
    if (x < 0) return 1
    var d   = _dist(x, y)
    var max = Math.max(COLS, ROWS)
    var t   = 1 - Math.min(1, d / max)      // 0 → 1
    return 1 + Math.pow(t, 2.2) * 24
  }

  /* ── Hover handling (drives audio & meter only — not selection) ── */
  function _onHover(x, y, el) {
    if (!_sv.active) { el.classList.add('sv-cell-hover'); return }
    _sv.curX = x; _sv.curY = y
    el.classList.add('sv-cell-hover')
    /* Clear hover on others (keep selection glow intact) */
    _cells.forEach(function(c) { if (c !== el) c.classList.remove('sv-cell-hover') })
  }
  /* Click locks a selection. Hover can still roam for audio feedback. */
  function _onCellClick(x, y, el) {
    if (!_sv.active) return
    _initAudio()   // user gesture → unlock audio
    _sv.selX = x; _sv.selY = y
    _cells.forEach(function(c) { c.classList.remove('sv-cell-sel') })
    el.classList.add('sv-cell-sel')
    _svHint.textContent = '// Selected ' + el.textContent + '. Press MARK to confirm.'
    _svMark.textContent = '[ MARK ' + el.textContent + ' ]'
  }

  /* ── Mark handling ─────────────────────────────────────────────── */
  _svMark.addEventListener('click', function() {
    if (!_sv.active) return
    if (_sv.selX < 0) {
      _svHint.textContent = '// Click a corridor cell first, then MARK.'
      return
    }
    var correct = (_sv.selX === _sv.hotX && _sv.selY === _sv.hotY)
    _resolveSurvey(correct)
  })

  /* ── Start a new survey ────────────────────────────────────────── */
  function _startSurvey() {
    if (window.errorSystem && window.errorSystem.isActive()) {
      setTimeout(_startSurvey, 8000)
      return
    }
    _sv.active    = true
    _sv.hotX      = Math.floor(Math.random() * COLS)
    _sv.hotY      = Math.floor(Math.random() * ROWS)
    _sv.timeLeft  = 60
    _sv.curX      = -1
    _sv.selX      = -1
    _sv.selY      = -1
    _cells.forEach(function(c) { c.classList.remove('sv-cell-sel') })
    _svPanel.classList.add('sv-active')
    _svStatus.textContent = 'ACTIVE'
    _svHint.textContent   = '// Sweep the grid. Click a cell to select, then MARK.'
    _svMark.disabled = false
    _svMark.textContent = '[ MARK HOT SPOT ]'

    if (typeof addLog === 'function')
      addLog('RAD SURVEY — hot spot detected in unit 4 block. Locate and mark.', 'warning')
    _mgFlagAlert('survey')
  }

  /* ── Resolve a survey ──────────────────────────────────────────── */
  function _resolveSurvey(correct) {
    _sv.active = false
    _svPanel.classList.remove('sv-active')
    _svMark.disabled = true

    var cellIdx = _sv.hotY * COLS + _sv.hotX
    var markedIdx = (_sv.selY >= 0) ? (_sv.selY * COLS + _sv.selX) : cellIdx
    _cells.forEach(function(c) { c.classList.remove('sv-cell-sel') })
    _svMark.textContent = '[ MARK HOT SPOT ]'

    if (correct) {
      _cells[cellIdx].classList.add('sv-cell-marked-ok')
      _svStatus.textContent = 'LOCATED'
      _svHint.textContent   = '// Contamination source isolated.'
      if (typeof addLog === 'function')
        addLog('RAD SURVEY — hot spot marked and isolated. Cleanup crew dispatched.', 'normal')
    } else {
      _cells[markedIdx].classList.add('sv-cell-marked-bad')
      setTimeout(function() {
        _cells[cellIdx].classList.add('sv-cell-marked-ok')   // reveal correct one
      }, 400)
      _svStatus.textContent = 'MISSED'
      _svHint.textContent   = '// Marker misaligned. Contamination continues to spread.'
      /* Penalty: radiation bump */
      try {
        if (sensorState && sensorState.B && sensorState.B.values.radiation) {
          sensorState.B.values.radiation.v = Math.min(9.9, sensorState.B.values.radiation.v + 0.30)
        }
      } catch(e){}
      if (typeof addLog === 'function')
        addLog('⚠ RAD SURVEY FAILED — hot spot unmarked. Radiation +0.30 Sv. Patrol will request guidance.', 'anomaly')
      /* Sprint F — unresolved hotspot is now a story hook. A worker
         on patrol radios in 2-3 game-min asking to cross the zone.
         Picked up by _pickScript() + force-trigger in dispatch
         ticker. Cleared once the scripted dispatch fires. */
      try {
        if (gameState && typeof _gcElapsed !== 'undefined') {
          gameState._unresolvedHotspot = { ts: _gcElapsed, fired: false }
        }
      } catch(e){}
    }
    setTimeout(function() {
      _cells.forEach(function(c) { c.classList.remove('sv-cell-marked-ok', 'sv-cell-marked-bad') })
    }, 4000)

    _sv.nextSpawn = 120 + Math.random() * 120   // 2 – 4 min between surveys
  }

  /* ── Player dose (saved across shifts via save object) ─────────── */
  function _getPlayerDose() {
    try {
      var save = window.saveSystem && saveSystem.loadGame()
      return (save && typeof save.totalPlayerDose === 'number') ? save.totalPlayerDose : 0
    } catch(e) { return 0 }
  }
  function _addPlayerDose(amount) {
    try {
      var save = window.saveSystem && saveSystem.loadGame()
      if (!save) return
      save.totalPlayerDose = (save.totalPlayerDose || 0) + amount
      saveSystem.saveGame(save)
    } catch(e){}
  }
  var _doseCache = _getPlayerDose()

  /* ── Main RAF loop ─────────────────────────────────────────────── */
  var _svLastTs = null
  function _svFrame(ts) {
    var dt = (_svLastTs !== null) ? Math.min((ts - _svLastTs) / 1000, 0.5) : 0
    _svLastTs = ts

    var cps = _cpsAt(_sv.curX, _sv.curY)
    if (_svCps)   _svCps.textContent   = cps.toFixed(0)
    if (_svMeter) _svMeter.style.width = Math.min(100, cps / 25 * 100).toFixed(0) + '%'

    /* Meter color ramp */
    if (_svMeter) {
      if      (cps > 18) _svMeter.style.background = 'var(--red-alert)'
      else if (cps > 10) _svMeter.style.background = 'var(--amber)'
      else               _svMeter.style.background = 'var(--phosphor)'
    }

    /* Timer */
    if (_sv.active) {
      _sv.timeLeft -= dt
      if (_svTimer) _svTimer.textContent = Math.max(0, _sv.timeLeft).toFixed(0) + 's'
      if (_sv.timeLeft <= 0) _resolveSurvey(false)
    } else {
      if (_svTimer) _svTimer.textContent = '——'
    }

    /* Audio clicks — scheduled by rate */
    if (_sv.active && _audioReady) {
      var now = performance.now()
      var interval = 1000 / Math.max(1, cps)
      if (now - _sv.lastClick > interval) {
        _sv.lastClick = now
        _geigerClick()
      }
    }

    /* Player dose accrual while searching */
    if (_sv.active) {
      var add = dt * (cps / 25) * 0.003    // ~0.003 Sv/s at peak cps
      _doseCache += add
      if (Math.random() < 0.05) _addPlayerDose(add * 20)   // batched save
    }
    if (_svDose) _svDose.textContent = _doseCache.toFixed(2) + ' Sv'

    requestAnimationFrame(_svFrame)
  }

  /* ── Spawn scheduler ───────────────────────────────────────────── */
  setInterval(function() {
    if (_sv.active) return
    if (!gameState || gameState.systemFailure) return
    _sv.nextSpawn--
    if (_sv.nextSpawn <= 0) _startSurvey()
  }, 1000)

  /* ── Init ──────────────────────────────────────────────────────── */
  /* Unlock audio on first click anywhere */
  document.addEventListener('click', function once() {
    _initAudio()
    document.removeEventListener('click', once)
  }, { once: true })

  requestAnimationFrame(_svFrame)
})()

/* ═══════════════════════════════════════════════════════════════════
   EXTERNAL THERMAL RELIEF PROTOCOL — EV-7
   ─────────────────────────────────────────────────────────────────
   Moral dilemma mechanic: when radiation is high and at least one
   system is stressed, management's standing order authorises an
   external thermal discharge via stack vent SV-4.

   Authorize → radiation & stress drop, full pay maintained.
               Civilian contamination accumulates silently.
   Contain   → nothing changes, pay penalty applies, conscience clear.
   ═══════════════════════════════════════════════════════════════════ */
;(function() {

  /* ── Inject styles ──────────────────────────────────────────────── */
  var _vs = document.createElement('style')
  _vs.textContent = [
    '#vent-modal {',
    '  display:none; position:fixed; inset:0; z-index:7000;',
    '  align-items:center; justify-content:center;',
    '  background:rgba(0,0,0,0.72);',
    '}',
    '#vent-modal.active { display:flex; }',
    '#vent-box {',
    '  background:var(--panel-bg); border:1px solid #ff6600;',
    '  box-shadow:0 0 24px rgba(255,102,0,0.4); padding:28px 32px;',
    '  max-width:480px; width:90%; font-family:"Share Tech Mono",monospace;',
    '  color:var(--phosphor); font-size:12px; line-height:1.7;',
    '}',
    '#vent-title {',
    '  font-family:"VT323",monospace; font-size:22px; color:#ff6600;',
    '  letter-spacing:2px; margin-bottom:12px;',
    '  text-shadow:0 0 8px rgba(255,102,0,0.6);',
    '}',
    '#vent-body { color:var(--phosphor-dim); margin-bottom:16px; }',
    '#vent-body strong { color:var(--phosphor); }',
    '#vent-timer {',
    '  font-family:"VT323",monospace; font-size:16px;',
    '  color:#ff6600; margin-bottom:18px; letter-spacing:1px;',
    '}',
    '#vent-timer.urgent { color:var(--red-alert); }',
    '.vent-btn-row { display:flex; gap:12px; }',
    '#vent-authorize {',
    '  flex:1; padding:10px; border:1px solid #ff6600; background:transparent;',
    '  color:#ff6600; font-family:"VT323",monospace; font-size:18px;',
    '  letter-spacing:1px; cursor:pointer;',
    '  transition:background 0.15s,color 0.15s;',
    '}',
    '#vent-authorize:hover { background:#ff6600; color:#000; }',
    '#vent-contain {',
    '  flex:1; padding:10px; border:1px solid var(--border); background:transparent;',
    '  color:var(--phosphor-dim); font-family:"VT323",monospace; font-size:18px;',
    '  letter-spacing:1px; cursor:pointer;',
    '  transition:background 0.15s,color 0.15s;',
    '}',
    '#vent-contain:hover { background:var(--border); color:var(--phosphor); }',
  ].join('\n')
  document.head.appendChild(_vs)

  /* ── DOM ────────────────────────────────────────────────────────── */
  var _vm = document.createElement('div')
  _vm.id  = 'vent-modal'
  _vm.innerHTML = [
    '<div id="vent-box">',
    '  <div id="vent-title">// PROTOCOL EV-7 — EXTERNAL RELIEF</div>',
    '  <div id="vent-body"></div>',
    '  <div id="vent-timer"></div>',
    '  <div class="vent-btn-row">',
    '    <button id="vent-authorize">[ AUTHORIZE DISCHARGE ]</button>',
    '    <button id="vent-contain">[ INTERNAL CONTAINMENT ]</button>',
    '  </div>',
    '</div>',
  ].join('')
  document.body.appendChild(_vm)

  var _ventBodyEl    = document.getElementById('vent-body')
  var _ventTimerEl   = document.getElementById('vent-timer')
  var _ventActive    = false
  var _ventTimerInt  = null
  var _ventSecsLeft  = 0
  var _ventAmount    = 0   // Sv to discharge

  /* ── Trigger check — called every game tick from systemTick ─────── */
  /* ── SV-4 button element ────────────────────────────────────────── */
  var _sv4Btn = document.getElementById('sv4-btn')

  /* ── Update button state every tick — no auto-popup ────────────── */
  window._checkVentOpportunity = function() {
    if (!_sv4Btn) return

    /* Cooldown: show countdown */
    if (_ventCooldownSecs > 0) {
      _sv4Btn.disabled   = true
      _sv4Btn.className  = 'sv4-cooldown'
      _sv4Btn.textContent = '// SV-4 — STANDBY ' + _ventCooldownSecs + 's'
      return
    }

    /* Blocked states */
    if (_ventActive || gameState.systemFailure || _shiftEnded) {
      _sv4Btn.disabled    = true
      _sv4Btn.className   = ''
      _sv4Btn.textContent = '// SV-4 — LOCKED'
      return
    }

    var rad = sensorState.B.values.radiation.v
    var stressed = Object.keys(gameState.systemStatus).some(function(s) {
      return gameState.systemStatus[s] === 'warn' || gameState.systemStatus[s] === 'crit'
    })

    if (rad >= _B.radVentThresh && stressed) {
      /* Available — light up */
      _sv4Btn.disabled    = false
      _sv4Btn.className   = 'sv4-available'
      _sv4Btn.textContent = '[ STACK SV-4 — ' + rad.toFixed(2) + ' Sv — VENT ]'
    } else {
      /* Not yet available */
      _sv4Btn.disabled    = true
      _sv4Btn.className   = ''
      _sv4Btn.textContent = '// SV-4 — LOCKED'
    }
  }

  /* ── Button click → open modal ──────────────────────────────────── */
  if (_sv4Btn) {
    _sv4Btn.addEventListener('click', function() {
      if (_sv4Btn.disabled) return
      _showVentModal(sensorState.B.values.radiation.v)
    })
  }

  /* ── Show modal ─────────────────────────────────────────────────── */
  function _showVentModal(rad) {
    _ventActive  = true
    _ventAmount   = parseFloat((rad * _B.ventDischarge).toFixed(2))
    _ventSecsLeft = _B.ventDecision

    var stressedSys = Object.keys(gameState.systemStatus)
      .filter(function(s) { return gameState.systemStatus[s] !== 'ok' })
      .map(function(s) { return s === 'sicaklik' ? 'TEMPERATURE' : s === 'basinc' ? 'PRESSURE' : 'POWER' })
      .join(', ')

    _ventBodyEl.innerHTML = [
      'Primary circuit load exceeds authorised parameters.',
      'System: <strong>' + stressedSys + '</strong>',
      'Measured discharge: <strong>' + _ventAmount.toFixed(2) + ' Sv/hr via stack SV-4</strong>',
      'Auth: Standing Order 14-C — Management pre-approval on file.',
      '',
      'Discharge will relieve system load and normalise sensor readings.',
      'Civilian exposure estimate: <strong style="color:#ff6600">classified / redacted</strong>',
    ].join('<br>')

    _ventTimerEl.textContent = 'Decision required in: ' + _ventSecsLeft + 's'
    _ventTimerEl.className   = ''
    _vm.classList.add('active')

    _ventTimerInt = setInterval(function() {
      _ventSecsLeft--
      _ventTimerEl.textContent = 'Decision required in: ' + _ventSecsLeft + 's'
      if (_ventSecsLeft <= 8) _ventTimerEl.className = 'urgent'
      if (_ventSecsLeft <= 0) _onVentContain()   /* timeout → auto-contain */
    }, 1000)
  }

  /* ── Authorize: discharge externally ───────────────────────────── */
  function _onVentAuthorize() {
    _closeVentModal()

    var rad = sensorState.B.values.radiation.v
    var drop = Math.min(rad - 0.3, _ventAmount)   /* always leave trace reading */

    /* Drop radiation sensor */
    sensorState.B.values.radiation.v = Math.max(0.3, rad - drop)
    if (sensorState.B.values.radiation.v < _radMax * 0.5) {
      /* Partially relieve the most stressed system value */
      var worstSys = Object.keys(gameState.critSeconds).reduce(function(a, b) {
        return (gameState.critSeconds[a] || 0) >= (gameState.critSeconds[b] || 0) ? a : b
      })
      var cfg = SYSTEMS[worstSys]
      if (cfg) {
        /* Push value toward safe midpoint */
        var safeMid = (cfg.safe[0] + cfg.safe[1]) / 2
        var cur     = gameState.systemValues[worstSys]
        gameState.systemValues[worstSys] = cur + (safeMid - cur) * _B.ventRelief
      }
    }

    gameState.ventCount++
    gameState.ventRads = parseFloat((gameState.ventRads + drop).toFixed(2))
    _ventCooldownSecs  = _B.ventAuthCD

    addLog('PROTOCOL EV-7 AUTHORISED — External discharge via SV-4. ' + drop.toFixed(2) + ' Sv/hr released. Sensors normalising.', 'normal')
    _logAnom('EV-7 AUTHORISED — ' + drop.toFixed(2) + ' Sv discharged externally.', '')
  }

  /* ── Contain: keep it internal ──────────────────────────────────── */
  function _onVentContain() {
    _closeVentModal()
    _ventCooldownSecs = _B.ventContainCD
    addLog('PROTOCOL EV-7 DECLINED — Internal containment selected. Thermal load maintained.', 'warning')
    _logAnom('EV-7 DECLINED — internal containment.', 'lo')
  }

  function _closeVentModal() {
    clearInterval(_ventTimerInt)
    _ventTimerInt = null
    _ventActive   = false
    _vm.classList.remove('active')
  }

  document.getElementById('vent-authorize').addEventListener('click', _onVentAuthorize)
  document.getElementById('vent-contain').addEventListener('click', _onVentContain)

})()

/* ═══════════════════════════════════════════════════════════════════
   MELTDOWN ESCALATION EFFECTS  (progressive / continuous)
   ─────────────────────────────────────────────────────────────────
   All effects scale continuously with maxCritSeconds (0–120):
     0–40 s  : progress bar + panel glow
    40–65 s  : sparse sparks start
    65–85 s  : static noise on critical panels
    85–120 s : panels go SIGNAL LOST one by one (85 / 100 / 112 s)
    80–120 s : screen glitch — gets faster & longer every 10 s
   Recovery removes effects in reverse as maxCritSeconds falls.
   ═══════════════════════════════════════════════════════════════════ */
;(function() {

  /* ── Inject styles once ─────────────────────────────────────────── */
  var _mdStyle = document.createElement('style')
  _mdStyle.textContent = [
    '#meltdown-bar-wrap {',
    '  position:fixed; top:0; left:0; right:0; z-index:9999;',
    '  height:6px; background:#1a0a0a; display:none; overflow:hidden;',
    '}',
    '#meltdown-bar {',
    '  height:100%; width:0%; background:#ffb830;',
    '  box-shadow:0 0 8px #ffb830,0 0 20px #ff9900;',
    '  transition:width 0.9s linear;',
    '}',
    '#meltdown-countdown {',
    '  position:fixed; top:10px; right:16px; z-index:9999;',
    '  font-family:"VT323",monospace; font-size:22px; color:#ff3a3a;',
    '  text-shadow:0 0 8px #ff3a3a; display:none; letter-spacing:2px;',
    '}',
    '.panel-melt-glow {',
    '  box-shadow:0 0 14px rgba(255,58,58,0.4),inset 0 0 10px rgba(255,58,58,0.12) !important;',
    '  border-color:rgba(255,58,58,0.55) !important;',
    '}',
    '.panel-degrading { position:relative; overflow:hidden; }',
    '.panel-degrading::after {',
    '  content:""; position:absolute; inset:0; pointer-events:none; z-index:10;',
    '  background:repeating-linear-gradient(',
    '    0deg,transparent,transparent 2px,',
    '    rgba(255,58,58,0.05) 2px,rgba(255,58,58,0.05) 4px);',
    '  animation:mdStaticNoise 0.12s steps(1) infinite;',
    '}',
    '@keyframes mdStaticNoise {',
    '  0%   {opacity:1;transform:translateY(0);}',
    '  25%  {opacity:0.6;transform:translateY(-2px);}',
    '  50%  {opacity:0.9;transform:translateY(1px);}',
    '  75%  {opacity:0.5;transform:translateY(-1px);}',
    '  100% {opacity:1;transform:translateY(0);}',
    '}',
    '.panel-offline { position:relative; overflow:hidden; }',
    '.panel-offline-overlay {',
    '  position:absolute; inset:0; z-index:20;',
    '  background:rgba(8,10,4,0.85);',
    '  display:flex; align-items:center; justify-content:center;',
    '  font-family:"VT323",monospace; font-size:28px; color:#ff3a3a;',
    '  text-shadow:0 0 10px #ff3a3a; letter-spacing:3px;',
    '  animation:mdFlickerText 0.3s steps(1) infinite;',
    '}',
    '@keyframes mdFlickerText {',
    '  0%,100%{opacity:1;} 45%{opacity:0.35;} 55%{opacity:0.8;}',
    '}',
    '.meltdown-spark {',
    '  position:fixed; pointer-events:none; z-index:8888;',
    '  width:3px; height:3px; border-radius:50%;',
    '  animation:mdSparkFall linear forwards;',
    '}',
    '@keyframes mdSparkFall {',
    '  0%   {opacity:1;transform:translate(0,0) scale(1);}',
    '  100% {opacity:0;transform:translate(var(--sx),var(--sy)) scale(0.2);}',
    '}',
    '.screen-flicker-hard {',
    '  --flicker-dur: 0.38s;',
    '  animation:mdFlickerHard var(--flicker-dur) steps(1) infinite !important;',
    '}',
    '@keyframes mdFlickerHard {',
    '  0%,100%{opacity:1;} 15%{opacity:0.50;} 35%{opacity:0.88;} 55%{opacity:0.40;} 75%{opacity:0.92;} 90%{opacity:0.60;}',
    '}',
  ].join('\n')
  document.head.appendChild(_mdStyle)

  /* ── Create bar + countdown DOM ─────────────────────────────────── */
  var _mdWrap    = document.createElement('div')
  _mdWrap.id     = 'meltdown-bar-wrap'
  _mdWrap.innerHTML = '<div id="meltdown-bar"></div>'
  document.body.appendChild(_mdWrap)

  var _mdCdEl    = document.createElement('div')
  _mdCdEl.id     = 'meltdown-countdown'
  document.body.appendChild(_mdCdEl)

  var _mdBar     = document.getElementById('meltdown-bar')

  /* ── State ──────────────────────────────────────────────────────── */
  var _mdOfflineList  = []    // sys names, in the order they went offline
  var _mdSparkHandle  = null  // recursive setTimeout handle
  var _mdSparkRunning = false
  var _mdLog40Done    = false
  var _mdLog80Done    = false
  var _mdLog100Done   = false

  /* Panel element lookup */
  function _sysPanel(s) {
    return document.getElementById('gauge-block-' + s)
  }

  /* Max critSeconds across all systems */
  function _getMaxSecs() {
    return Math.max.apply(null,
      Object.keys(gameState.critSeconds).map(function(s) {
        return gameState.critSeconds[s]
      })
    )
  }

  /* ── Declarative state: sets ALL effects to match current maxSecs ── */
  function _applyState(maxSecs) {
    var terminal = document.querySelector('.terminal')

    /* ── Progress bar ─────────────────────────────────────────────── */
    if (maxSecs > 0) {
      var pct = Math.min(100, Math.round(maxSecs / 120 * 100))
      _mdWrap.style.display = ''
      _mdCdEl.style.display = ''
      _mdBar.style.width    = pct + '%'
      _mdCdEl.textContent   = '⚠ CRITICAL — ' + Math.max(0, 120 - maxSecs) + 's'
      if (pct >= 66) {
        _mdBar.style.background = '#ff3a3a'
        _mdBar.style.boxShadow  = '0 0 12px #ff3a3a,0 0 30px #ff0000'
      } else if (pct >= 33) {
        _mdBar.style.background = '#ff6600'
        _mdBar.style.boxShadow  = '0 0 8px #ff6600,0 0 20px #ff4400'
      } else {
        _mdBar.style.background = '#ffb830'
        _mdBar.style.boxShadow  = '0 0 8px #ffb830,0 0 16px #ff9900'
      }
    } else {
      _mdWrap.style.display = 'none'
      _mdCdEl.style.display = 'none'
      _mdBar.style.width    = '0%'
    }

    /* ── Per-panel effects (glow / noise) ─────────────────────────── */
    Object.keys(SYSTEMS).forEach(function(s) {
      var el = _sysPanel(s)
      if (!el) return
      var isCrit = gameState.systemStatus[s] === 'crit'

      /* Glow: >= 40s AND system is crit */
      if (maxSecs >= 40 && isCrit) el.classList.add('panel-melt-glow')
      else                          el.classList.remove('panel-melt-glow')

      /* Noise: >= 65s AND system is crit AND not already offline */
      var isOffline = _mdOfflineList.indexOf(s) !== -1
      if (maxSecs >= 65 && isCrit && !isOffline) el.classList.add('panel-degrading')
      else if (!isOffline)                        el.classList.remove('panel-degrading')
    })

    /* ── Offline panels (SIGNAL LOST) ─────────────────────────────── */
    var desiredOffline = maxSecs >= 112 ? 3 : maxSecs >= 100 ? 2 : maxSecs >= 85 ? 1 : 0

    /* Sort all systems by critSeconds descending to pick which go offline first */
    var sortedSys = Object.keys(SYSTEMS).slice().sort(function(a, b) {
      return (gameState.critSeconds[b] || 0) - (gameState.critSeconds[a] || 0)
    })
    var targetOffline = sortedSys.slice(0, desiredOffline)

    /* Restore panels that are offline but shouldn't be */
    _mdOfflineList = _mdOfflineList.filter(function(s) {
      if (targetOffline.indexOf(s) === -1) {
        _restorePanel(s)
        return false
      }
      return true
    })

    /* Put offline panels that aren't yet */
    targetOffline.forEach(function(s) {
      if (_mdOfflineList.indexOf(s) === -1) {
        _goOffline(s)
        _mdOfflineList.push(s)
      }
    })

    /* ── Screen flicker — speed scales with maxSecs ───────────────── */
    if (maxSecs >= 80 && terminal) {
      var dur = maxSecs >= 110 ? '0.06s'
              : maxSecs >= 100 ? '0.11s'
              : maxSecs >= 90  ? '0.20s'
              :                  '0.38s'
      terminal.classList.add('screen-flicker-hard')
      terminal.style.setProperty('--flicker-dur', dur)
    } else if (terminal) {
      terminal.classList.remove('screen-flicker-hard')
    }

    /* ── Spark loop: kick off if not running and maxSecs >= 40 ────── */
    if (maxSecs >= 40 && !_mdSparkRunning) _sparkLoop()

    /* ── One-time log messages at escalation thresholds ──────────── */
    if (maxSecs >= 40 && !_mdLog40Done) {
      _mdLog40Done = true
      addLog('⚠ THERMAL RUNAWAY — containment systems strained. Structural integrity at risk.', 'anomaly')
      _logAnom('⚠ THERMAL RUNAWAY — containment systems strained.', 'lo')
    }
    if (maxSecs >= 80 && !_mdLog80Done) {
      _mdLog80Done = true
      addLog('⚠ CRITICAL THRESHOLD REACHED — automated suppression systems activated.', 'anomaly')
      _logAnom('⚠ CRITICAL THRESHOLD REACHED — automated suppression engaged.', 'lo')
    }
    if (maxSecs >= 100 && !_mdLog100Done) {
      _mdLog100Done = true
      addLog('⚠ MELTDOWN IMMINENT — facility breach sequence initiated. All personnel evacuate.', 'anomaly')
      _logAnom('⚠ MELTDOWN IMMINENT — facility breach sequence initiated.', 'lo')
    }
  }

  /* ── Put a panel into SIGNAL LOST state ─────────────────────────── */
  function _goOffline(sys) {
    var el = _sysPanel(sys)
    if (!el || el.querySelector('.panel-offline-overlay')) return
    el.classList.add('panel-offline')
    el.classList.remove('panel-degrading', 'panel-melt-glow')
    var ov = document.createElement('div')
    ov.className   = 'panel-offline-overlay'
    ov.textContent = '// SIGNAL LOST'
    el.appendChild(ov)
    addLog('⚠ ' + SYSTEMS[sys].label + ' panel offline — sensor feed interrupted.', 'anomaly')
    _logAnom('⚠ ' + SYSTEMS[sys].label + ' sensor offline.', 'lo')
  }

  /* ── Restore a panel from SIGNAL LOST ───────────────────────────── */
  function _restorePanel(sys) {
    var el = _sysPanel(sys)
    if (!el) return
    el.classList.remove('panel-offline', 'panel-degrading', 'panel-melt-glow')
    var ov = el.querySelector('.panel-offline-overlay')
    if (ov) ov.remove()
    addLog('✓ ' + SYSTEMS[sys].label + ' panel restored — sensor feed nominal.', 'normal')
    _logAnom('✓ ' + SYSTEMS[sys].label + ' sensor restored.', 'hi')
  }

  /* ── Recursive spark loop — rate scales with current maxSecs ─────── */
  function _sparkLoop() {
    _mdSparkRunning = true
    var maxSecs = _getMaxSecs()

    if (maxSecs < 40 || gameState.systemFailure) {
      _mdSparkRunning = false
      _mdSparkHandle  = null
      return
    }

    /* Count: 1 spark at 40s, up to 8 at 118s */
    var count = Math.max(1, Math.round(1 + (maxSecs - 40) / 10))

    /* Delay: 1800ms at 40s → 100ms at 120s */
    var delay = Math.max(100, Math.round(1800 - maxSecs * 14))

    _spawnSparks(count)
    _mdSparkHandle = setTimeout(_sparkLoop, delay)
  }

  /* ── Spark particle emitter ─────────────────────────────────────── */
  function _spawnSparks(count) {
    for (var i = 0; i < count; i++) {
      (function() {
        var sp  = document.createElement('div')
        sp.className = 'meltdown-spark'
        var x   = Math.random() * window.innerWidth
        var y   = Math.random() * window.innerHeight * 0.65 + 40
        var dx  = (Math.random() - 0.5) * 100
        var dy  = 30 + Math.random() * 140
        var dur = 0.3 + Math.random() * 0.6
        sp.style.left = x + 'px'
        sp.style.top  = y + 'px'
        sp.style.setProperty('--sx', dx + 'px')
        sp.style.setProperty('--sy', dy + 'px')
        sp.style.animationDuration = dur + 's'
        var r = Math.random()
        if (r < 0.18) {
          sp.style.background = '#ff3a3a'
          sp.style.boxShadow  = '0 0 4px #ff3a3a,0 0 8px #ff0000'
        } else if (r < 0.36) {
          sp.style.background = '#ffffff'
          sp.style.boxShadow  = '0 0 4px #ffffff,0 0 8px #aaaaaa'
        } else {
          sp.style.background = '#ffb830'
          sp.style.boxShadow  = '0 0 4px #ffb830,0 0 8px #ff6600'
        }
        document.body.appendChild(sp)
        setTimeout(function() { if (sp.parentNode) sp.remove() }, dur * 1000 + 150)
      })()
    }
  }

  /* ── Public: called every systemTick crit second ───────────────── */
  window._meltdownUpdate = function(sys, secs) {
    if (gameState.systemFailure) return
    _applyState(_getMaxSecs())
  }

  /* ── Public: called when a system recovers (sys) or all clear (null) */
  window._meltdownReset = function(sys) {
    var maxSecs = _getMaxSecs()
    if (maxSecs > 0) {
      /* Still critical on another system — re-evaluate state */
      _applyState(maxSecs)
      return
    }

    /* All systems clear — full teardown */
    _applyState(0)   // clears bar, flicker, glow, noise, restores all panels

    /* Reset log flags for next critical episode */
    _mdLog40Done  = false
    _mdLog80Done  = false
    _mdLog100Done = false

    /* Spark loop stops itself when maxSecs < 40 */
    if (_mdSparkHandle) { clearTimeout(_mdSparkHandle); _mdSparkHandle = null }
    _mdSparkRunning = false
  }

})()
