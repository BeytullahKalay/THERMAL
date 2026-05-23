/* ═══════════════════════════════════════════════════════════════════
   THERMAL — shift-end.js
   Reads the shift report from localStorage, calculates ratings,
   populates all panels, and wires the navigation buttons.
   Depends on: saveSystem.js (loaded before this file)
   ═══════════════════════════════════════════════════════════════════ */

/* ── Read report from localStorage ───────────────────────────────── */
var reportRaw = localStorage.getItem('thermalShiftReport')
var r = reportRaw ? JSON.parse(reportRaw) : {
  /* Fallback defaults — shown when opening the page directly for testing */
  correctDecisions: 3, wrongDecisions: 1, missedAnomalies: 0,
  totalCritSeconds: 18, meltdownOccurred: false,
  freqCalSuccess: 2,   freqCalFail: 0,
  finalTemp: 68.4,     finalPressure: 55.1,  finalPower: 70.8,
  finalTempStatus: 'ok', finalPressureStatus: 'ok', finalPowerStatus: 'ok',
  finalRadiation: 0.94, radiationReached: 0.94, shiftNumber: 1, shiftPay: 400,
}

/* ── Save state (already updated by game.html's endShift) ──────── */
var _save = (window.saveSystem ? window.saveSystem.loadGame() : null)

/* ═══════════════════════════════════════════════════════════════════
   RATING CALCULATION
   ═══════════════════════════════════════════════════════════════════ */
function calcRating(d) {
  if (d.meltdownOccurred) return {
    grade: 'CRITICAL\nFAILURE',
    color: 'var(--red-alert)',
    desc:  'REACTOR INCIDENT RECORDED.\nSHIFT TERMINATED EARLY.\nFULL INVESTIGATION ORDERED.',
  }
  if (d.streetDeath) return {
    grade: 'OPERATOR\nDECEASED',
    color: 'var(--red-alert)',
    desc:  d.streetDeathDesc || 'NO FIXED ADDRESS ON FILE.\nBODY RECOVERED FROM STREET.\nEMPLOYMENT RECORD CLOSED.',
  }
  var total    = d.correctDecisions + d.wrongDecisions
  var accuracy = total > 0 ? d.correctDecisions / total : 1.0
  if (accuracy >= 0.90 && d.missedAnomalies === 0 && d.totalCritSeconds < 30) return {
    grade: 'EXEMPLARY',
    color: 'var(--phosphor)',
    desc:  'OUTSTANDING PERFORMANCE.\nNO INCIDENTS RECORDED.\nCOMMENDATION ISSUED.',
  }
  if (accuracy >= 0.70 && d.missedAnomalies < 3) return {
    grade: 'SATISFACTORY',
    color: 'var(--phosphor)',
    desc:  'SHIFT COMPLETED WITHOUT\nMAJOR INCIDENT.\nPERFORMANCE WITHIN STANDARD.',
  }
  if (accuracy >= 0.50) return {
    grade: 'MARGINAL',
    color: 'var(--amber)',
    desc:  'MULTIPLE PROTOCOL DEVIATIONS\nNOTED.\nRETRAINING RECOMMENDED.',
  }
  return {
    grade: 'UNSATISFACTORY',
    color: 'var(--red-alert)',
    desc:  'SIGNIFICANT FAILURES RECORDED.\nSUPERVISOR REVIEW REQUIRED.\nPENALTY LOG FILED.',
  }
}

/* ── Radiation status ─────────────────────────────────────────────── */
function radStatus(v) {
  var pct = Math.min(100, v / 10 * 100)
  if (v < 1.0) return { level: 'NOMINAL',   color: 'var(--phosphor)', pct: pct,
    barGrad: 'linear-gradient(90deg, #2a5a08, var(--phosphor))',
    text: 'Background levels. No environmental impact recorded.' }
  if (v < 2.0) return { level: 'ELEVATED',  color: 'var(--phosphor)', pct: pct,
    barGrad: 'linear-gradient(90deg, #2a5a08, var(--phosphor))',
    text: 'Above background. Within occupational limit. Logged.' }
  if (v < 3.0) return { level: 'WARNING',   color: 'var(--amber)',    pct: pct,
    barGrad: 'linear-gradient(90deg, #7a4a00, var(--amber))',
    text: 'Above normal. Monitoring review initiated. Log filed.' }
  if (v < 4.0) return { level: 'HIGH',      color: 'var(--amber)',    pct: pct,
    barGrad: 'linear-gradient(90deg, #7a4a00, var(--amber))',
    text: 'High exposure detected. Medical evaluation required.' }
  return        { level: 'DANGEROUS', color: 'var(--red-alert)', pct: pct,
    barGrad: 'linear-gradient(90deg, #7a0000, var(--red-alert))',
    text: 'Dangerous levels. Facility lockdown protocol engaged.' }
}

/* ═══════════════════════════════════════════════════════════════════
   POPULATE PANELS
   ═══════════════════════════════════════════════════════════════════ */

var rating = calcRating(r)
var rad    = radStatus(r.finalRadiation || 0)
var total  = r.correctDecisions + r.wrongDecisions
var acc    = total > 0 ? Math.round(r.correctDecisions / total * 100) : 100

/* ── Header ─────────────────────────────────────────────────────── */
document.getElementById('shift-num').textContent = r.shiftNumber || 1

/* ── Performance log ─────────────────────────────────────────────── */
document.getElementById('stat-total').textContent = total + r.missedAnomalies

var correctEl = document.getElementById('stat-correct')
correctEl.textContent = r.correctDecisions
correctEl.className   = 'stat-val ok'

var wrongEl = document.getElementById('stat-wrong')
wrongEl.textContent = r.wrongDecisions
wrongEl.className   = 'stat-val ' + (r.wrongDecisions === 0 ? 'ok' : 'warn')

var missedEl = document.getElementById('stat-missed')
missedEl.textContent = r.missedAnomalies
missedEl.className   = 'stat-val ' + (r.missedAnomalies === 0 ? 'ok' : r.missedAnomalies < 3 ? 'warn' : 'crit')

var accEl = document.getElementById('stat-accuracy')
accEl.textContent = acc + '%'
accEl.className   = 'stat-val ' + (acc >= 70 ? 'ok' : acc >= 50 ? 'warn' : 'crit')

var critEl = document.getElementById('stat-crit')
critEl.textContent = r.totalCritSeconds + 's'
critEl.className   = 'stat-val ' + (r.totalCritSeconds < 30 ? 'ok' : r.totalCritSeconds < 120 ? 'warn' : 'crit')

var fcOkEl = document.getElementById('stat-fc-ok')
fcOkEl.textContent = r.freqCalSuccess
fcOkEl.className   = 'stat-val ok'

var fcFailEl = document.getElementById('stat-fc-fail')
fcFailEl.textContent = r.freqCalFail
fcFailEl.className   = 'stat-val ' + (r.freqCalFail === 0 ? 'ok' : 'warn')

/* ── Rating panel ───────────────────────────────────────────────── */
var gradeEl = document.getElementById('rating-grade')
gradeEl.textContent = rating.grade
gradeEl.style.color = rating.color

var descEl = document.getElementById('rating-desc')
descEl.textContent = rating.desc
descEl.style.color = (rating.color === 'var(--phosphor)')
  ? 'var(--phosphor-dim)'
  : rating.color

document.getElementById('rs-accuracy').textContent = acc + '%'
document.getElementById('rs-crit').textContent     = r.totalCritSeconds + 's'
document.getElementById('rs-freq').textContent     =
  r.freqCalSuccess + ' / ' + (r.freqCalSuccess + r.freqCalFail)

/* ── Telemetry panel ─────────────────────────────────────────────── */
var fRad  = r.finalRadiation || 1.0
var snaps = r.radSnapshots || (function() {
  /* Fallback: linear interpolation from 0.80 to final */
  return [
    0.80,
    parseFloat((0.80 + (fRad - 0.80) * 0.25).toFixed(2)),
    parseFloat((0.80 + (fRad - 0.80) * 0.50).toFixed(2)),
    parseFloat((0.80 + (fRad - 0.80) * 0.75).toFixed(2)),
    fRad
  ]
})()
var SNAP_TIMES = ['22:00', '00:00', '02:00', '04:00', '06:00']
var MAX_BAR    = 18
var maxVal     = Math.max.apply(null, snaps)

var chartEl = document.getElementById('telem-chart')
if (chartEl) {
  chartEl.innerHTML = snaps.map(function(v, i) {
    var barLen = Math.max(1, Math.round(v / maxVal * MAX_BAR))
    var barStr = '░'.repeat(barLen)
    var isLast = (i === snaps.length - 1)
    var barCls = 'telem-bar-txt'
    var valCls = 'telem-val'
    if (isLast) {
      if      (fRad >= 3.5) { barCls += ' last-crit'; valCls += ' final-crit' }
      else if (fRad >= 2.5) { barCls += ' last-warn'; valCls += ' final-warn' }
      else if (fRad >= 1.5) { barCls += ' last-warn'; valCls += ' final-warn' }
      else                  { valCls += ' final-ok' }
    }
    return '<div class="telem-row">' +
      '<span class="telem-time">'   + SNAP_TIMES[i] + '</span>' +
      '<span class="' + barCls + '">' + barStr       + '</span>' +
      '<span class="' + valCls + '">' + v.toFixed(2) + ' mSv</span>' +
      '</div>'
  }).join('')
}

/* Exposure radius */
var radiusEl = document.getElementById('telem-radius')
radiusEl.textContent = (fRad * 12).toFixed(1) + ' km'
radiusEl.className   = 'telem-stat-val' + (fRad >= 2.5 ? ' warn' : '')

/* Population density — deterministic rotation per shift for variety */
var popDens = ['LOW', 'MEDIUM', 'HIGH'][((r.shiftNumber || 1) * 7 + 1) % 3]
var popEl   = document.getElementById('telem-pop')
popEl.textContent = popDens
popEl.className   = 'telem-stat-val' + (popDens === 'HIGH' ? ' warn' : '')

/* Incident classification */
var incEl = document.getElementById('telem-class')
if (fRad < 1.5) {
  incEl.textContent = 'NONE'
  incEl.className   = 'telem-stat-val'
} else if (fRad < 2.5) {
  incEl.textContent = 'MINOR'
  incEl.className   = 'telem-stat-val warn'
} else if (fRad < 3.5) {
  incEl.textContent = 'MODERATE'
  incEl.className   = 'telem-stat-val warn'
  incEl.style.animation = 'blink 0.9s step-end infinite'
} else {
  incEl.textContent = 'SEVERE'
  incEl.className   = 'telem-stat-val crit'
}

/* External discharge row — only shown if player vented this shift */
var ventRow = document.getElementById('telem-vent-row')
var ventEl  = document.getElementById('telem-vent')
if (ventRow && ventEl && r.ventCount > 0) {
  ventRow.style.display = ''
  ventEl.textContent    = r.ventCount + 'x — ' + (r.ventRads || 0).toFixed(2) + ' Sv RELEASED'
  ventEl.className      = 'telem-stat-val warn'
  ventEl.style.animation = 'blink 1.2s step-end infinite'
}

/* Final system state */
function setSysState(id, val, unit, status) {
  var el = document.getElementById(id)
  el.textContent = val.toFixed(1) + unit
  el.className   = 'sys-state-val ' + (status || 'ok')
}
setSysState('env-temp',     r.finalTemp     || 65.0, '°C', r.finalTempStatus     || 'ok')
setSysState('env-pressure', r.finalPressure || 52.0, '%',  r.finalPressureStatus || 'ok')
setSysState('env-power',    r.finalPower    || 72.0, '%',  r.finalPowerStatus    || 'ok')

/* ── Sprint 3 (D) — POST-SHIFT RECONSTRUCTION (viral).
   Two-column reconstruction: what the operator reported versus
   what the simulation thinks happened. Plus a "nearby district"
   stat that gives the numbers human weight without explicitly
   judging. Screenshot-friendly. */
;(function paintReconstruction() {
  var rs = r.realState
  if (!rs) return
  function setText(id, val) { var e = document.getElementById(id); if (e) e.textContent = val }

  setText('recon-called',     rs.calledTotal)
  setText('recon-real',       rs.realAnomalyEvents)
  setText('recon-correct',    rs.correctCalls)
  setText('recon-escalated',  rs.escalatedEvents)
  setText('recon-rad-rep',    (rs.peakReportedRad || 0).toFixed(2) + ' mSv')
  setText('recon-rad-real',   (rs.peakActualRad   || 0).toFixed(2) + ' mSv')
  setText('recon-vent-n',     rs.externalVentCount)
  setText('recon-vent-sv',    (rs.externalSv || 0).toFixed(2) + ' Sv')
  setText('recon-district',   rs.nearbyDistrict)
  setText('recon-population', (rs.nearbyPopulation || 0).toLocaleString())
  setText('recon-statement',  rs.facilityStatement || 'PENDING')
  setText('recon-shift-n',    r.shiftNumber || 1)
})()

/* ── Sprint 2 (B) — Anomaly events table. Surfaces every real
   anomaly the player faced this shift, with severity factor +
   reason chain + their decision. Lets the player retroactively
   audit why a spike was hard ("I left the valve subsystem
   penalty active and that pushed severity ×1.5"). */
;(function paintAnomalyHistory() {
  var events = r.anomalyEvents || []
  var list   = document.getElementById('anom-history-list')
  var empty  = document.getElementById('anom-history-empty')
  if (!list || !empty) return
  if (events.length === 0) {
    empty.style.display = ''
    return
  }
  empty.style.display = 'none'
  var T = (window.i18n && window.i18n.t) ? window.i18n.t : function (k, f) { return f }

  /* Column header row */
  var html = '<div class="anom-row anom-head">' +
               '<span>' + T('anomalyHistory.colTime')     + '</span>' +
               '<span>' + T('anomalyHistory.colSensor')   + '</span>' +
               '<span>' + T('anomalyHistory.colSeverity') + '</span>' +
               '<span>' + T('anomalyHistory.colOutcome')  + '</span>' +
             '</div>'
  events.forEach(function (e) {
    var sevCls = e.severity >= 2.0 ? 'crit' : (e.severity >= 1.4 ? 'high' : '')
    var outKey = 'anomalyHistory.outcome.' + (e.outcome || 'pending')
    var outLbl = T(outKey, (e.outcome || 'pending').toUpperCase())
    var outCls = e.outcome || 'pending'
    html += '<div class="anom-row">' +
              '<span class="anom-cell-ts">'     + (e.ts || '——') + '</span>' +
              '<span class="anom-cell-sensor">' + (e.sensor || '?') + '</span>' +
              '<span class="anom-cell-sev ' + sevCls + '">×' + (e.severity || 1).toFixed(2) + '</span>' +
              '<span class="anom-cell-out ' + outCls + '">' + outLbl + '</span>' +
            '</div>'
    if (e.reasons && e.reasons.length > 0) {
      html += '<div class="anom-reasons">↳ ' + e.reasons.join('; ') + '</div>'
    }
  })
  list.innerHTML = html
})()

/* ── Sprint 1 (A) — Sensor reliability readout. Pull the per-system
   reliability % from the report (game.js endShift writes it). Only
   show rows where the operator actually starved the subsystem at
   some point — keeps the panel uncluttered on clean shifts. */
;(function paintReliability() {
  var rel = r.sensorReliability
  if (!rel) return
  var T = (window.i18n && window.i18n.t) ? window.i18n.t : function (k) { return k }
  var SYS_LABEL = {
    sicaklik: T('ui.gauge.temp'),
    basinc:   T('ui.gauge.pressure'),
    guc:      T('ui.gauge.power')
  }
  var anyDegraded = false
  ;['sicaklik','basinc','guc'].forEach(function (k) {
    var entry  = rel[k] || { pct: 100, lowSec: 0, critSec: 0 }
    var totalLow = (entry.lowSec || 0) + (entry.critSec || 0)
    if (totalLow === 0) return   // perfect — skip row
    anyDegraded = true
    var row = document.getElementById('rel-row-' + k)
    var val = document.getElementById('rel-val-' + k)
    if (row) row.style.display = ''
    if (val) {
      var cls = entry.pct >= 90 ? 'ok' : entry.pct >= 70 ? 'warn' : 'crit'
      val.className   = 'sys-state-val ' + cls
      val.textContent = entry.pct + '%  (' + totalLow + 's low-power)'
    }
  })
  var noneRow = document.getElementById('rel-row-none')
  if (noneRow) noneRow.style.display = anyDegraded ? 'none' : ''
})()

/* ── Action bar center text ──────────────────────────────────────── */
var centerEl = document.getElementById('action-center')
var pay      = (typeof r.shiftPay === 'number') ? r.shiftPay
             : (window.saveSystem ? window.saveSystem.calcShiftPay(r.radiationReached || r.finalRadiation || 0, !!r.meltdownOccurred) : 0)

if (r.meltdownOccurred) {
  centerEl.textContent = 'INCIDENT REPORT FILED — UNIT 4 / SHIFT ' + (r.shiftNumber || 1) + ' — PAYMENT WITHHELD'
  centerEl.style.color = 'var(--red-alert)'
} else if (r.streetDeath) {
  centerEl.textContent = 'OPERATOR DECEASED — STATUS: UNHOUSED / SHIFT ' + (r.shiftNumber || 1) + ' — RUN TERMINATED'
  centerEl.style.color = 'var(--red-alert)'
} else {
  centerEl.textContent = 'SHIFT ' + (r.shiftNumber || 1) + ' COMPLETE — UNIT 4 STABLE  //  PAYMENT: ' + pay + ' UNITS'
}

/* ── Run-ending outcomes → hide NEXT SHIFT entirely ────────────── */
var btnNext = document.getElementById('btn-next')
var _runEnded = !!(r.meltdownOccurred || r.streetDeath)
if (_runEnded && btnNext) {
  btnNext.style.display = 'none'
}

/* Senaryo — WIN epilogue routing. Detect from save (the WIN flag
   is set in updateShift after the report is written). When won,
   repurpose the NEXT button to send the player to the epilogue
   instead of the home terminal. NEXT label is retained as-is via
   data-i18n so locale switches still work; only the click target
   changes. */
var _isWin = false
try {
  var _sv = (window.saveSystem ? window.saveSystem.loadGame() : null)
  _isWin = !!(_sv && _sv.gameOver && _sv.gameOverReason === 'win')
} catch(e){}

/* ═══════════════════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════════════════ */
function crtNavigate(url) {
  var t = document.querySelector('.terminal')
  t.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards'
  setTimeout(function() { window.location.href = url }, 620)
}

document.getElementById('btn-menu').addEventListener('click', function() {
  crtNavigate('menu.html')
})

if (!_runEnded) document.getElementById('btn-next').addEventListener('click', function() {
  if (window.saveSystem) {
    var s = window.saveSystem.loadGame()
    try { localStorage.setItem('thermalShiftNumber', String(s.shiftNumber)) } catch (e) {}
  }
  /* Senaryo — WIN diverts to the epilogue instead of home. */
  if (_isWin) { crtNavigate('death.html'); return }
  /* Atmospheric transition home — CRT off, then a black-screen
     interstitial held long enough to register before the home
     terminal loads. Total ~3.4s. */
  goingHomeTransition()
})

function goingHomeTransition() {
  var t = document.querySelector('.terminal')
  if (t) t.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards'
  setTimeout(function () {
    var ov = document.createElement('div')
    ov.id = 'going-home-transition'
    var T = (window.i18n && window.i18n.t) ? window.i18n.t : function (k) { return k }
    ov.innerHTML =
      '<div class="gh-line gh-line-a">' + T('goingHome.time') + '</div>' +
      '<div class="gh-line gh-line-b">' + T('goingHome.arriving') + '</div>' +
      '<div class="gh-line gh-line-c">' + T('goingHome.checkMail') + '</div>'
    document.body.appendChild(ov)
    /* Hold the interstitial for 2.7s (perceptually ~3s including
       the fade-in) before navigating. */
    setTimeout(function () { window.location.href = 'home-terminal.html' }, 2700)
  }, 620)
}
