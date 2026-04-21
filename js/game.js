/* ═══════════════════════════════════════════════════════════════════
   THERMAL — game.js
   Full game loop: sensors, resource system, game clock, log system,
   anomaly system, CRM frequency monitor, valve mini-game, debug
   panel, and shift-end handler.
   Depends on: saveSystem.js (loaded before this file)
   ═══════════════════════════════════════════════════════════════════ */
  /* ─── Save system — load current run state once at boot ──────── */
  var _save = window.saveSystem.loadGame()

  /* Sync legacy shift-number key so existing endShift() path keeps
     behaving identically while we migrate to the new save. */
  try { localStorage.setItem('thermalShiftNumber', String(_save.shiftNumber)) } catch (e) {}

  /* ─── Pause Menu ─────────────────────────────────────────────── */
  let isPaused = false;
  const overlay = document.getElementById('pause-overlay');

  function openPause() {
    isPaused = true;
    overlay.classList.add('active');
  }

  function closePause() {
    isPaused = false;
    overlay.classList.remove('active');
  }

  /* ESC key toggles pause */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      isPaused ? closePause() : openPause();
    }
  });

  /* DEVAM ET — resume */
  document.getElementById('btn-resume').addEventListener('click', closePause);

  /* ANA MENÜYE DÖN — CRT off → navigate to menu */
  document.getElementById('btn-menu').addEventListener('click', () => {
    overlay.classList.remove('active');
    const terminal = document.querySelector('.terminal');
    terminal.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards';
    setTimeout(() => { window.location.href = 'menu.html'; }, 620);
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

  /* ── Normal drift: ±1-5% every 3–5 seconds ──────────────────────── */
  function _drift() {
    Object.values(sensorState).forEach(sensor => {
      Object.entries(sensor.values).forEach(([key, vd]) => {
        if (vd.type === 'state') return
        if (vd.noDrift) return
        /* Don't drift the value that an anomaly is currently glitching. */
        if (sensor.anomaly && sensor.anomaly.valueKey === key) return

        const sign  = Math.random() < 0.5 ? 1 : -1
        const pct   = (0.01 + Math.random() * 0.04) * sign  // ±1–5 %
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
  }

  /* Per-shift anomaly event log — written to localStorage at endShift() */
  var _shiftAnomalyLog = []
  function _logAnom(text, cls) {
    _shiftAnomalyLog.push({ ts: _gcTime(), text: text, cls: cls || '' })
  }

  /* ── System physics config ─────────────────────────────────────────── */
  /*  Physics formula (per second):
      res ≤ 3 : mag = lerp(deterRate, 0.05, res/3)   [deterRate at res=0, 0.05 at res=3]
      res > 3 : mag = 0.05 − (res−3) × 0.06          [negative = improvement]
      rate    = (mag > 0 ? mag × diffScale : mag) × direction
      direction: +1 = value rises when deteriorating (TEMP, PRESSURE)
                 −1 = value falls when deteriorating (POWER)            */
  const SYSTEMS = {
    sicaklik: {
      label: 'TEMPERATURE', unit: '°C', dec: 1,
      //  res=0 → +0.20/s   res=3 → +0.05/s   res=4 → −0.01/s   res=10 → −0.37/s
      safe: [40, 85], warn: [37, 88], crit: [34, 92],
      deterRate: 0.20, direction: +1,
      gaugeMin: 0, gaugeMax: 120,
      hintSafe: 'SAFE: 40–85°C',
    },
    basinc: {
      label: 'PRESSURE', unit: '%', dec: 1,
      //  res=0 → +0.15/s   res=3 → +0.05/s   res=4 → −0.01/s   res=10 → −0.37/s
      safe: [40, 80], warn: [36, 84], crit: [32, 88],
      deterRate: 0.15, direction: +1,
      gaugeMin: 0, gaugeMax: 100,
      hintSafe: 'SAFE: 40–80%',
    },
    guc: {
      label: 'POWER', unit: '%', dec: 1,
      //  res=0 → −0.10/s   res=3 → −0.05/s   res=4 → +0.01/s   res=10 → +0.37/s
      safe: [50, 90], warn: [42, 93], crit: [35, 95],
      deterRate: 0.10, direction: -1,
      gaugeMin: 0, gaugeMax: 100,
      hintSafe: 'SAFE: 50–90%',
    }
  }

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
    })
  }

  /* ── systemTick — called every second ───────────────────────────── */
  function systemTick() {
    if (gameState.systemFailure) return

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
      }

      if (next === 'crit') {
        gameState.critSeconds[sys]++
        gameState.totalCritSeconds++
        _meltdownUpdate(sys, gameState.critSeconds[sys])
        if (gameState.critSeconds[sys] >= 120) {
          gameState.systemFailure = true
          gameState.meltdownOccurred = true
          var _fMsg
          if      (sys === 'sicaklik') _fMsg = '⚠ FATAL: Thermal ceiling exceeded — fuel assembly damage probable. Shift terminated.'
          else if (sys === 'basinc')   _fMsg = '⚠ FATAL: Primary circuit failure — containment boundary compromised. Shift terminated.'
          else                         _fMsg = '⚠ FATAL: Uncontrolled power excursion — SCRAM engaged. Shift terminated.'
          addLog(_fMsg, 'anomaly')
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
  setInterval(systemTick, 1000)

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
  var _diffScale = 0.4

  function _getDiffScale() {
    if      (_gcElapsed < 60)  return 0.4
    else if (_gcElapsed < 180) return 0.7
    else if (_gcElapsed < 300) return 1.0
    else if (_gcElapsed < 420) return 1.4
    else                       return 1.8
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
      clearInterval(_gcInterval)
      endShift()
    }
  }

  /* Public API — getCurrentTime() used by _lsAdd and external callers. */
  var gameClock = { getCurrentTime: _gcTime }

  _gcPaint()                                          // set display to 22:00 immediately
  _gcInterval = setInterval(_gcTick, 1000)            // advance one game-minute per second

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

  /* ── Real-anomaly templates ──────────────────────────────────────── */
  var ANOM_TYPES = [
    {
      sensorId: 'A', valueKey: 'flow', type: 1,
      logMsg: '⚠ CONFLICT: Line 2 flow log: 4.2 m/s — SEN.A reads 0.0 m/s. Total discrepancy.',
    },
    {
      sensorId: 'A', valueKey: 'valve', type: 2,
      logMsg: '⚠ CONFLICT: Valve V-114 log: CLOSED — SEN.A contact reads: OPEN.',
    },
    {
      sensorId: 'B', valueKey: 'coreTemp', type: 3,
      logMsg: '⚠ CONFLICT: Core temperature declining — no coolant activation registered. SEN.B unresponsive.',
    },
    {
      sensorId: 'A', valueKey: 'temp', type: 4,
      logMsg: '⚠ CONFLICT: SEN.A reads nominal — operator log parameters inconsistent. Source unknown.',
    },
  ]

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
      var clueDelay = 60000 + Math.floor(Math.random() * 30000)
      _lsAdd(tpl.clueMsg, 'system')

      /* Sensor fires after the clue delay */
      setTimeout(function() {
        if (!_anom.active || !_anom.isLogClue) return   // cleared early
        triggerAnomaly(tpl.sensorId, tpl.valueKey, tpl.type)
        _lsAdd(tpl.conflictMsg, 'conflict')
        /* Decision window starts NOW (when sensor fires) */
        _anom.decideTimer = setTimeout(function() { _anomEscalate(1) }, 90000)
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
      /* ── Real anomaly (60%) ──────────────────────────────────────── */
      var tpl = ANOM_TYPES[Math.floor(Math.random() * ANOM_TYPES.length)]
      _anom.sensorId = tpl.sensorId
      _anom.valueKey = tpl.valueKey
      triggerAnomaly(tpl.sensorId, tpl.valueKey, tpl.type)
      _lsAdd(tpl.logMsg, 'conflict')
      _logAnom(tpl.logMsg, 'lo')
      _anomSetButtons(true)
      _anom.decideTimer = setTimeout(function() { _anomEscalate(1) }, 90000)
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
      _anom.escTimer = setTimeout(function() { _anomEscalate(2) }, 60000)

    } else if (stage === 2) {
      _lsAdd('⚠ FATAL: Anomaly unresolved. Automatic protocol initiated. Operator incident filed.', 'anomaly')
      _logAnom('⚠ FATAL: Anomaly unresolved. Automatic protocol initiated.', 'lo')
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
    if      (_gcElapsed >= 240) delay = 60000  + Math.floor(Math.random() * 120000)  // 04:00+ → 1–3 min
    else if (_gcElapsed >= 120) delay = 120000 + Math.floor(Math.random() * 120000)  // 02:00+ → 2–4 min
    else                        delay = 240000 + Math.floor(Math.random() * 180000)  // early  → 4–7 min
    setTimeout(_anomSpawn, delay)
  }

  /* ── Button listeners ────────────────────────────────────────────── */
  _btnReport.addEventListener('click', function() { if (_anom.active) _anomDecide(true)  })
  _btnNormal.addEventListener('click', function() { if (_anom.active) _anomDecide(false) })

  /* ── First anomaly: 180–300 s after shift start ──────────────────── */
  setTimeout(_anomSpawn, 180000 + Math.floor(Math.random() * 120000))

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

  /* ── Refresh freq-monitor UI (called on button press + 1 s tick) ── */
  function _fcRefresh() {
    var match = _fcMatch()
    _fcFreqVal.textContent  = _fcPlayerFreq.toFixed(1) + ' Hz'
    _fcAmpVal.textContent   = _fcPlayerAmp.toFixed(1)  + ' V'
    _fcMatchLbl.textContent = 'SYNC: ' + Math.round(match) + '%'

    _fcMatchBar.className = 'fc-match-bar'
    if      (match >= 95) _fcMatchBar.classList.add('fc-match-good')
    else if (match >= 50) _fcMatchBar.classList.add('fc-match-warn')
    else                  _fcMatchBar.classList.add('fc-match-bad')

    gameState.freqBonus = (match >= 95)

    if (_fcMode === 'active') {
      var ready = match >= 95
      _fcConfirm.disabled = !ready
      _fcConfirm.classList.toggle('fc-confirm-ready', ready)
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
    gameState.freqBonus = (_fcMatch() >= 95)

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

    if (match < 95) {
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
        _lsAdd('⚠ CRM hold below 95 % sustained 15 s. Coolant flow rate fluctuating.', 'warning')
      }

    } else {
      /* Sync recovered above 95 % — reset transient level.
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
    setTimeout(triggerFreqCalibration, 240000 + Math.floor(Math.random() * 240000))
  }

  /* ── Boot ────────────────────────────────────────────────────────── */
  _fcRefresh()
  _fcRafId = requestAnimationFrame(_fcDraw)
  _fcScheduleDrift()
  setInterval(_fcPenaltyTick, 1000)
  setTimeout(triggerFreqCalibration, 240000 + Math.floor(Math.random() * 120000))

  /* ═══════════════════════════════════════════════════════════════════
     MINI-GAME TABS  (CRM / VALVES)
     ═══════════════════════════════════════════════════════════════════ */
  var _mgTabCrm    = document.getElementById('mg-tab-crm')
  var _mgTabValve  = document.getElementById('mg-tab-valve')
  var _crmPanel    = document.getElementById('freq-monitor')
  var _valvePanel  = document.getElementById('valve-monitor')

  function _mgShow(which) {
    if (which === 'crm') {
      _crmPanel.style.display   = ''
      _valvePanel.style.display = 'none'
      _mgTabCrm.classList.add('mg-tab-active')
      _mgTabValve.classList.remove('mg-tab-active', 'mg-tab-alert')
    } else {
      _crmPanel.style.display   = 'none'
      _valvePanel.style.display = ''
      _mgTabValve.classList.add('mg-tab-active')
      _mgTabValve.classList.remove('mg-tab-alert')
      _mgTabCrm.classList.remove('mg-tab-active', 'mg-tab-alert')
    }
  }
  function _mgFlagAlert(which) {
    if (which === 'crm'   && !_mgTabCrm.classList.contains('mg-tab-active'))   _mgTabCrm.classList.add('mg-tab-alert')
    if (which === 'valve' && !_mgTabValve.classList.contains('mg-tab-active')) _mgTabValve.classList.add('mg-tab-alert')
  }
  _mgTabCrm.addEventListener('click',   function() { _mgShow('crm') })
  _mgTabValve.addEventListener('click', function() { _mgShow('valve') })

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

  /* ── IDLE breathing — toggle 1-2 random valves every 40-60s ─────── */
  function _vmIdleBreath() {
    if (_vmMode !== 'idle' || gameState.systemFailure) {
      _vmIdleTimer = setTimeout(_vmIdleBreath, 30000)
      return
    }
    var n = 1 + Math.floor(Math.random() * 2)
    var picks = [0,1,2,3].sort(function(){ return Math.random() - 0.5 }).slice(0, n)
    picks.forEach(function(i) { _vmValveOpen[i] = !_vmValveOpen[i] })
    _vmRender()
    _vmIdleTimer = setTimeout(_vmIdleBreath, 40000 + Math.floor(Math.random() * 20000))
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
    _vmValveOpen = [false, false, false, false]
    _vmRender()

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

  /* ── Valve click handler ─────────────────────────────────────────── */
  _vmValveEls.forEach(function(el, idx) {
    el.addEventListener('click', function() {
      if (_vmMode !== 'active') return
      var valveNum = idx + 1
      var pos      = _vmInput.length
      if (_vmCorrectSeq[pos] === valveNum) {
        /* Correct so far */
        _vmInput.push(valveNum)
        _vmValveOpen[valveNum - 1] = true
        _vmRender()
        _vmRenderSeq()
        if (_vmInput.length === 4) _vmSuccess()
      } else {
        /* Wrong — flash valve red, reset input but keep valve states */
        el.classList.remove('vm-valve-wrong')
        void el.offsetWidth
        el.classList.add('vm-valve-wrong')
        setTimeout(function(){ el.classList.remove('vm-valve-wrong') }, 500)
        /* Reset sequence input + close any opened valves from this attempt */
        _vmInput.forEach(function(vn) { _vmValveOpen[vn - 1] = false })
        _vmInput = []
        _vmRender()
        _vmRenderSeq()
      }
    })
  })

  /* ── Success ─────────────────────────────────────────────────────── */
  function _vmSuccess() {
    clearInterval(_vmTimerInt); _vmTimerInt = null
    _vmFlash('vm-flash-green')
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
    _vmValveOpen = [false, false, false, false]
    _vmRender()
    _vmRenderSeq()
  }

  function _scheduleNextValveSeq() {
    if (gameState.systemFailure) return
    /* every 5–9 minutes (real time) */
    setTimeout(triggerValveSequence, 300000 + Math.floor(Math.random() * 240000))
  }

  /* ── Boot ─────────────────────────────────────────────────────────── */
  _vmRender()
  _vmRenderSeq()
  /* Idle breathing kickoff */
  _vmIdleTimer = setTimeout(_vmIdleBreath, 40000 + Math.floor(Math.random() * 20000))
  /* First spawn 5–8 minutes in (real time) */
  setTimeout(triggerValveSequence, 300000 + Math.floor(Math.random() * 180000))

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
    clearInterval(_gcInterval)

    var shiftNum         = _save.shiftNumber || 1
    var radiationReached = Math.max(_radMax, sensorState.B.values.radiation.v)
    var shiftPay         = window.saveSystem.calcShiftPay(
                             radiationReached, gameState.meltdownOccurred)

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
      shiftPay:            shiftPay,
    }
    localStorage.setItem('thermalShiftReport', JSON.stringify(report))

    /* Append this shift's anomaly log to the persistent archive */
    try {
      var _al = JSON.parse(localStorage.getItem('thermalAnomalyLog') || '[]')
      _al.push({ shiftNumber: shiftNum, entries: _shiftAnomalyLog })
      localStorage.setItem('thermalAnomalyLog', JSON.stringify(_al))
    } catch(e) {}

    /* Persist the shift into the save object (pay, shift++, etc.) */
    window.saveSystem.updateShift(report)

    var terminal = document.querySelector('.terminal')
    terminal.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards'
    var _nextScreen = gameState.meltdownOccurred ? 'death.html' : 'shift-end.html'
    setTimeout(function() { window.location.href = _nextScreen }, 620)
  }

  /* ═══════════════════════════════════════════════════════════════════
     KNOB VISUALS — purely presentational, no game-logic changes.
     Updates SVG knob rotation + sync arc from existing _fcPlayerFreq,
     _fcPlayerAmp, and _fcMatch() values.
     ═══════════════════════════════════════════════════════════════════ */
  ;(function() {
    var _kvFreqG  = document.getElementById('fm-knob-freq-g')
    var _kvAmpG   = document.getElementById('fm-knob-amp-g')
    var _kvArc    = document.getElementById('fm-sync-arc')
    var _kvPct    = document.getElementById('fm-sync-pct')

    var FC_CIRC   = 326.7   // 2π × 52  — matches SVG arc radius

    /* Map value in [min,max] to rotation in [−135°, +135°] */
    function _kvAngle(v, min, max) {
      return -135 + (v - min) / (max - min) * 270
    }

    /* Push knob + arc state to DOM */
    function _kvUpdate() {
      /* Knob indicators */
      var fa = _kvAngle(_fcPlayerFreq, 0.5, 5.0)
      var aa = _kvAngle(_fcPlayerAmp,  0.1, 2.0)
      if (_kvFreqG) _kvFreqG.setAttribute('transform', 'rotate(' + fa.toFixed(1) + ' 22 22)')
      if (_kvAmpG)  _kvAmpG.setAttribute('transform',  'rotate(' + aa.toFixed(1) + ' 22 22)')

      /* Sync arc */
      var match  = _fcMatch()
      if (_kvArc) {
        var offset = FC_CIRC - (match / 100 * FC_CIRC)
        _kvArc.setAttribute('stroke-dashoffset', offset.toFixed(1))
        _kvArc.setAttribute('stroke',
          match >= 95 ? '#a8ff3e' : match >= 50 ? '#ffb830' : '#ff3a3a')
      }

      /* Sync text colour */
      if (_kvPct) {
        _kvPct.style.color = match >= 95
          ? 'var(--phosphor)'
          : match >= 50 ? 'var(--amber)' : 'var(--red-alert)'
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
    '  KEEP',
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
    '  animation:mdFlickerHard 0.15s steps(1) infinite !important;',
    '}',
    '@keyframes mdFlickerHard {',
    '  0%,100%{opacity:1;} 20%{opacity:0.55;} 40%{opacity:0.85;} 60%{opacity:0.45;} 80%{opacity:0.9;}',
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
  var _mdPhase        = 0
  var _mdOffline      = {}
  var _mdFlickering   = false
  var _mdSparkTimer   = null
  var _mdPhase2Logged = false
  var _mdPhase3Logged = false

  /* Panel element lookup — gauge-block-* IDs from game.html */
  function _sysPanel(s) {
    return document.getElementById('gauge-block-' + s)
  }

  /* ── Public: called every systemTick crit second ───────────────── */
  window._meltdownUpdate = function(sys, secs) {
    if (gameState.systemFailure) return

    var maxSecs = Math.max.apply(null,
      Object.keys(gameState.critSeconds).map(function(s) {
        return gameState.critSeconds[s]
      })
    )

    var pct       = Math.min(100, Math.round(maxSecs / 120 * 100))
    var remaining = Math.max(0, 120 - maxSecs)

    _mdWrap.style.display = ''
    _mdCdEl.style.display = ''
    _mdBar.style.width    = pct + '%'
    _mdCdEl.textContent   = '⚠ CRITICAL — ' + remaining + 's'

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

    var newPhase = maxSecs >= 80 ? 3 : maxSecs >= 40 ? 2 : 1
    if (newPhase !== _mdPhase) {
      _mdPhase = newPhase
      _applyPhase(sys)
    }
  }

  /* ── Public: called when a system recovers (or null = all-clear) ── */
  window._meltdownReset = function(sys) {
    var maxSecs = Math.max.apply(null,
      Object.keys(gameState.critSeconds).map(function(s) {
        return gameState.critSeconds[s]
      })
    )

    if (maxSecs > 0) {
      /* Another system still critical — just update bar */
      var pct = Math.min(100, Math.round(maxSecs / 120 * 100))
      _mdBar.style.width  = pct + '%'
      _mdCdEl.textContent = '⚠ CRITICAL — ' + Math.max(0, 120 - maxSecs) + 's'
      return
    }

    /* All clear */
    _mdWrap.style.display = 'none'
    _mdCdEl.style.display = 'none'
    _mdBar.style.width    = '0%'
    _mdPhase        = 0
    _mdPhase2Logged = false
    _mdPhase3Logged = false

    if (_mdSparkTimer) { clearInterval(_mdSparkTimer); _mdSparkTimer = null }

    Object.keys(SYSTEMS).forEach(function(s) {
      var el = _sysPanel(s)
      if (!el) return
      el.classList.remove('panel-melt-glow', 'panel-degrading', 'panel-offline')
      var ov = el.querySelector('.panel-offline-overlay')
      if (ov) ov.remove()
    })

    var terminal = document.querySelector('.terminal')
    if (terminal) terminal.classList.remove('screen-flicker-hard')
    _mdFlickering = false
    _mdOffline    = {}
  }

  /* ── Apply phase effects ─────────────────────────────────────────── */
  function _applyPhase(triggeredSys) {
    var terminal = document.querySelector('.terminal')

    /* Phase 1+ — glow on all critical panels */
    Object.keys(SYSTEMS).forEach(function(s) {
      var el = _sysPanel(s)
      if (!el) return
      if (gameState.systemStatus[s] === 'crit') el.classList.add('panel-melt-glow')
    })

    /* Phase 2 — static noise + sparse sparks + log */
    if (_mdPhase >= 2 && !_mdPhase2Logged) {
      _mdPhase2Logged = true
      addLog('⚠ THERMAL RUNAWAY — containment systems strained. Structural integrity at risk.', 'anomaly')
      _logAnom('⚠ THERMAL RUNAWAY — containment systems strained.', 'lo')
      Object.keys(SYSTEMS).forEach(function(s) {
        var el = _sysPanel(s)
        if (!el) return
        if (gameState.systemStatus[s] === 'crit') el.classList.add('panel-degrading')
      })
      if (_mdSparkTimer) clearInterval(_mdSparkTimer)
      _mdSparkTimer = setInterval(function() { _spawnSparks(2) }, 900)
    }

    /* Phase 3 — heavy sparks + screen flicker + SIGNAL LOST panel + log */
    if (_mdPhase >= 3 && !_mdPhase3Logged) {
      _mdPhase3Logged = true
      addLog('⚠ MELTDOWN IMMINENT — facility breach sequence initiated. All personnel evacuate.', 'anomaly')
      _logAnom('⚠ MELTDOWN IMMINENT — facility breach sequence initiated.', 'lo')
      if (_mdSparkTimer) clearInterval(_mdSparkTimer)
      _mdSparkTimer = setInterval(function() { _spawnSparks(3) }, 280)
      if (terminal && !_mdFlickering) {
        _mdFlickering = true
        terminal.classList.add('screen-flicker-hard')
      }
      _offlinePanel(triggeredSys)
    }
  }

  /* ── Take a panel offline (SIGNAL LOST overlay) ─────────────────── */
  function _offlinePanel(sys) {
    if (!sys || _mdOffline[sys]) return
    var el = _sysPanel(sys)
    if (!el) return
    _mdOffline[sys] = true
    el.classList.add('panel-offline')
    el.classList.remove('panel-degrading', 'panel-melt-glow')
    var ov = document.createElement('div')
    ov.className   = 'panel-offline-overlay'
    ov.textContent = '// SIGNAL LOST'
    el.appendChild(ov)
    addLog('⚠ ' + SYSTEMS[sys].label + ' panel offline — sensor feed interrupted.', 'anomaly')
    _logAnom('⚠ ' + SYSTEMS[sys].label + ' panel offline — sensor feed interrupted.', 'lo')
  }

  /* ── Spark particle emitter ─────────────────────────────────────── */
  function _spawnSparks(phase) {
    var count = phase === 3
      ? 3 + Math.floor(Math.random() * 5)
      : 1 + Math.floor(Math.random() * 2)
    for (var i = 0; i < count; i++) {
      (function() {
        var sp  = document.createElement('div')
        sp.className = 'meltdown-spark'
        var x   = Math.random() * window.innerWidth
        var y   = Math.random() * window.innerHeight * 0.65 + 40
        var dx  = (Math.random() - 0.5) * 90
        var dy  = 30 + Math.random() * 130
        var dur = 0.35 + Math.random() * 0.55
        sp.style.left = x + 'px'
        sp.style.top  = y + 'px'
        sp.style.setProperty('--sx', dx + 'px')
        sp.style.setProperty('--sy', dy + 'px')
        sp.style.animationDuration = dur + 's'
        var r = Math.random()
        if (r < 0.18) {
          sp.style.background  = '#ff3a3a'
          sp.style.boxShadow   = '0 0 4px #ff3a3a,0 0 8px #ff0000'
        } else if (r < 0.36) {
          sp.style.background  = '#ffffff'
          sp.style.boxShadow   = '0 0 4px #ffffff,0 0 8px #aaaaaa'
        } else {
          sp.style.background  = '#ffb830'
          sp.style.boxShadow   = '0 0 4px #ffb830,0 0 8px #ff6600'
        }
        document.body.appendChild(sp)
        setTimeout(function() { if (sp.parentNode) sp.remove() }, dur * 1000 + 120)
      })()
    }
  }

})()
