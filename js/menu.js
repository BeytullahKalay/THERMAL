/* ═══════════════════════════════════════════════════════════════════
   THERMAL — menu.js
   Main menu logic: save-state detection, menu painting, new-game
   confirmation dialog, and settings overlay.
   Depends on: saveSystem.js (loaded before this file)
   ═══════════════════════════════════════════════════════════════════ */

const { ipcRenderer } = require('electron')

/* ─── CRT transition ──────────────────────────────────────────────── */
function navigateTo(url) {
  const screen = document.querySelector('.screen');
  screen.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards';
  setTimeout(() => { window.location.href = url; }, 620);
}

/* ═══════════════════════════════════════════════════════════════════
   MENU STATE
   ─────────────────────────────────────────────────────────────────
   Three cases:
     'fresh'    — no save file:       01 NEW GAME only
     'continue' — save, not game-over: 01 CONTINUE + 02 NEW GAME
     'ended'    — save, game-over:    01 NEW GAME only
   ═══════════════════════════════════════════════════════════════════ */

var _save    = window.saveSystem.loadGame()
var _hasSave = !!localStorage.getItem(window.saveSystem.SAVE_KEY)

function menuCase() {
  if (!_hasSave)      return 'fresh'
  if (_save.gameOver) return 'ended'
  return 'continue'
}

/* ── Numeric prefixes shift when item 02 is hidden ──────────────── */
function updatePrefixes(hasContinue) {
  var offset = hasContinue ? 0 : -1   // 02 hidden → shift everything down 1
  document.getElementById('prefix-manual')       .textContent = pad(3 + offset)
  document.getElementById('prefix-operatorfile') .textContent = pad(4 + offset)
  document.getElementById('prefix-settings')     .textContent = pad(5 + offset)
  document.getElementById('prefix-exit')         .textContent = pad(6 + offset)
}
function pad(n) { return n < 10 ? '0' + n : '' + n }

/* ── Paint items + money progress ───────────────────────────────── */
function paintMenu() {
  var s         = _save
  var c         = menuCase()
  var primary   = document.getElementById('menu-item-primary')
  var newgame   = document.getElementById('menu-item-newgame')
  var primLabel = document.getElementById('menu-primary-label')
  var primMeta  = document.getElementById('menu-primary-meta')
  var progEl    = document.getElementById('menu-money-progress')

  var t = (window.i18n && window.i18n.t) ? window.i18n.t : function (k, v) { return k }
  if (c === 'continue') {
    /* CASE 2 — save exists, not game-over */
    primary.style.display = ''
    newgame.style.display = ''
    primLabel.textContent = t('menu.primary.continueShift', { n: s.shiftNumber })
    primMeta.textContent  = ''
    updatePrefixes(true)
  } else {
    /* CASE 1 / CASE 3 — only [01 NEW GAME] */
    primary.style.display = ''
    newgame.style.display = 'none'
    primLabel.textContent = t('menu.primary.newGame')
    if (c === 'ended') {
      primMeta.textContent = s.gameOverReason === 'win'
        ? t('menu.status.runComplete')
        : t('menu.status.runEnded')
    } else {
      primMeta.textContent = ''
    }
    updatePrefixes(false)
  }

  if (progEl) progEl.textContent = t('menu.money.progress', { money: s.totalMoney, target: s.targetMoney })

  /* Operator File: unlocked only when a live run exists */
  var opfileItem  = document.getElementById('menu-item-operatorfile')
  var opfileLabel = opfileItem ? opfileItem.querySelector('.menu-label') : null
  var opfileLock  = opfileItem ? opfileItem.querySelector('.menu-lock')  : null
  if (c === 'continue') {
    if (opfileLabel) opfileLabel.classList.remove('locked')
    if (opfileLock)  { opfileLock.textContent = '▶'; opfileLock.className = 'menu-arrow' }
    if (opfileItem)  opfileItem.classList.add('opfile-unlocked')
  } else {
    if (opfileLabel) opfileLabel.classList.add('locked')
    if (opfileLock)  { opfileLock.textContent = t('menu.locked'); opfileLock.className = 'menu-lock' }
    if (opfileItem)  opfileItem.classList.remove('opfile-unlocked')
  }
}

/* ── Primary click ──────────────────────────────────────────────── */
function onPrimary() {
  var c = menuCase()
  if (c === 'continue') {
    navigateTo('game.html')
  } else {
    /* fresh or ended — always write a clean save before starting */
    window.saveSystem.resetGame()
    navigateTo('game.html')
  }
}

/* ── New Game (secondary) — confirm dialog ──────────────────────── */
function onNewGameRequest() {
  document.getElementById('reset-confirm').classList.add('active')
}
function onNewGameConfirm() {
  window.saveSystem.resetGame()
  document.getElementById('reset-confirm').classList.remove('active')
  navigateTo('game.html')
}
function onNewGameCancel() {
  document.getElementById('reset-confirm').classList.remove('active')
}

/* ── Wire menu item clicks — stable IDs, not fragile indices ────── */
document.getElementById('menu-item-primary')      .addEventListener('click', onPrimary)
document.getElementById('menu-item-newgame')      .addEventListener('click', onNewGameRequest)
document.getElementById('menu-item-manual')       .addEventListener('click', () => navigateTo('manual.html'))
document.getElementById('menu-item-settings')     .addEventListener('click', openSettings)
document.getElementById('menu-item-credits')      .addEventListener('click', () => navigateTo('credits.html'))
document.getElementById('menu-item-exit')         .addEventListener('click', () => window.close())
document.getElementById('menu-item-operatorfile') .addEventListener('click', function() {
  if (menuCase() === 'continue') openOpFile()
})

/* ── Confirm dialog buttons ─────────────────────────────────────── */
document.getElementById('reset-confirm-yes').addEventListener('click', onNewGameConfirm)
document.getElementById('reset-confirm-no') .addEventListener('click', onNewGameCancel)

paintMenu()
paintSnapshot()

/* Refresh JS-rendered dynamic strings whenever the language changes.
   data-i18n elements are auto-updated by window.i18n.setLang(), but
   anything we write via textContent in JS (primary label, controls
   list, language list selection state, snapshot strings) needs an
   explicit re-render. */
window.addEventListener('thermal-lang-changed', function () {
  try { paintMenu() } catch (e) {}
  try { paintSnapshot() } catch (e) {}
  /* Only rebuild settings sub-lists if the overlay is open */
  var settingsOpen = document.getElementById('settings-overlay')
  if (settingsOpen && settingsOpen.classList.contains('active')) {
    try { buildControlsList() } catch (e) {}
    try { buildLanguageList() } catch (e) {}
  }
})

/* ── Populate status snapshot from last shift report ────────────── */
function paintSnapshot() {
  var snap = document.getElementById('status-snapshot')
  if (!snap) return

  /* No save → keep hidden */
  if (!_hasSave) return

  snap.style.display = ''

  /* Try to read the last shift report */
  var report = null
  try { report = JSON.parse(localStorage.getItem('thermalShiftReport')) } catch(e) {}

  /* Money bar — always available from save */
  var totalMoney  = _save.totalMoney  || 0
  var targetMoney = _save.targetMoney || 2400
  var fundPct     = Math.min(100, Math.round(totalMoney / targetMoney * 100))
  var fundBar     = document.getElementById('snap-bar-fund')
  if (fundBar) {
    fundBar.style.width = fundPct + '%'
    fundBar.className   = 'snap-fill' + (fundPct < 30 ? ' warn' : '')
  }

  if (!report) return   /* Save exists but no shift played yet — dashes stay */

  /* Status → CSS class helpers */
  function cls(st) {
    return st !== 'ok' ? 'snap-val snap-warn' : 'snap-val snap-ok'
  }
  function barCls(st) {
    return 'snap-fill' + (st !== 'ok' ? ' warn' : '')
  }

  /* TEMPERATURE  — gaugeMax 120°C */
  var tempVal = report.finalTemp           || 0
  var tempSt  = report.finalTempStatus     || 'ok'
  var tempBar = document.getElementById('snap-bar-temp')
  var tempEl  = document.getElementById('snap-val-temp')
  if (tempBar) { tempBar.style.width = Math.min(100, Math.round(tempVal / 120 * 100)) + '%'; tempBar.className = barCls(tempSt) }
  if (tempEl)  { tempEl.textContent = tempVal.toFixed(1) + '°C'; tempEl.className = cls(tempSt) }

  /* PRESSURE  — gaugeMax 100% */
  var presVal = report.finalPressure       || 0
  var presSt  = report.finalPressureStatus || 'ok'
  var presBar = document.getElementById('snap-bar-pressure')
  var presEl  = document.getElementById('snap-val-pressure')
  if (presBar) { presBar.style.width = Math.min(100, Math.round(presVal)) + '%'; presBar.className = barCls(presSt) }
  if (presEl)  { presEl.textContent = presVal.toFixed(1) + '%'; presEl.className = cls(presSt) }

  /* POWER  — gaugeMax 100% */
  var powVal  = report.finalPower          || 0
  var powSt   = report.finalPowerStatus    || 'ok'
  var powBar  = document.getElementById('snap-bar-power')
  var powEl   = document.getElementById('snap-val-power')
  if (powBar) { powBar.style.width = Math.min(100, Math.round(powVal)) + '%'; powBar.className = barCls(powSt) }
  if (powEl)  { powEl.textContent = powVal.toFixed(1) + '%'; powEl.className = cls(powSt) }

  /* LAST ENTRY — final 3 lines from the most recent shift's anomaly log */
  var entryEl = document.getElementById('last-shift-entry')
  if (entryEl) {
    var anomLog = null
    try { anomLog = JSON.parse(localStorage.getItem('thermalAnomalyLog')) } catch(e) {}

    if (anomLog && anomLog.length > 0) {
      var lastShift   = anomLog[anomLog.length - 1]
      var entries     = lastShift.entries || []
      var tail        = entries.slice(-3)   /* last 3 entries */

      if (tail.length > 0) {
        entryEl.innerHTML = tail.map(function(e, i) {
          var tsSpan   = '<span class="ts">' + (e.ts || '——') + '</span>'
          var textNode = e.cls === 'lo'
            ? '<span class="conflict">' + e.text + '</span>'
            : e.text
          var cursor   = (i === tail.length - 1) ? '<span class="cursor"></span>' : ''
          return tsSpan + textNode + cursor
        }).join('<br>')
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SETTINGS OVERLAY
   ═══════════════════════════════════════════════════════════════════ */

// Curated resolution pool — filtered against native display size
const RES_POOL = [
  { w: 1280, h: 720  },
  { w: 1366, h: 768  },
  { w: 1600, h: 900  },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
  { w: 3840, h: 2160 },
]

let selectedMode = 'windowed'  // 'windowed' | 'fullscreen'
let selectedRes  = null        // { w, h }
let nativeRes    = null        // { width, height }

/* Open the settings overlay, query Electron for display info */
async function openSettings() {
  const info = await ipcRenderer.invoke('get-display-info')
  nativeRes = info.native

  selectedMode = info.isFullscreen ? 'fullscreen' : 'windowed'
  selectedRes  = { w: info.current.width, h: info.current.height }

  buildModeList()
  buildResList()
  updateResSection()
  buildControlsList()
  buildLanguageList()

  document.getElementById('settings-overlay').classList.add('active')
}

/* ═══════════════════════════════════════════════════════════════════
   LANGUAGE — locale picker
   Lists window.i18n.LANGS, marks the active code, switches on click.
   ═══════════════════════════════════════════════════════════════════ */
function buildLanguageList() {
  if (!window.i18n) return
  var listEl = document.getElementById('language-list')
  if (!listEl) return
  var current = window.i18n.getLang()
  listEl.innerHTML = ''
  window.i18n.LANGS.forEach(function (l) {
    var el = document.createElement('div')
    var isSel = (l.code === current)
    el.className = 'settings-option' + (isSel ? ' selected' : '')
    el.setAttribute('data-lang', l.code)
    el.innerHTML =
      '<span class="opt-selector">' + (isSel ? '▶' : ' ') + '</span>' +
      '<span class="opt-label">' + l.native + '</span>' +
      '<span class="opt-tag">' + l.name + '</span>'
    el.addEventListener('click', function () {
      window.i18n.setLang(l.code)
      buildLanguageList()  // re-render with new selection
    })
    listEl.appendChild(el)
  })
}

/* ═══════════════════════════════════════════════════════════════════
   CONTROLS — keybind rebinding UI
   Reads window.keybinds.META for action ids + labels, renders rows,
   wires capture-modal flow for each unprotected action.
   ═══════════════════════════════════════════════════════════════════ */
function buildControlsList() {
  if (!window.keybinds) return
  var listEl = document.getElementById('controls-list')
  if (!listEl) return

  listEl.innerHTML = ''
  var meta = window.keybinds.META
  /* Pull localised action labels from i18n if available. */
  var t = (window.i18n && window.i18n.t) ? window.i18n.t : function (k, f) { return f }
  Object.keys(meta).forEach(function (action) {
    var info  = meta[action]
    var label = t('controls.' + action, info.label) || info.label
    var row   = document.createElement('div')
    row.className = 'control-row' + (info.protected ? ' protected' : '')
    row.setAttribute('data-action', action)
    row.innerHTML =
      '<span class="control-label">' + label +
        (info.protected ? ' <span class="control-locked">' + t('controls.locked', '(locked)') + '</span>' : '') +
      '</span>' +
      '<button type="button" class="control-key-btn" data-action="' + action + '">' +
        window.keybinds.label(action) +
      '</button>'
    listEl.appendChild(row)
  })
}

/* Capture-modal state */
var _rebindAction = null
function _openRebind(action) {
  if (!window.keybinds || !window.keybinds.META[action]) return
  if (window.keybinds.META[action].protected) return
  _rebindAction = action
  var actEl = document.getElementById('rebind-action')
  if (actEl) actEl.textContent = window.keybinds.META[action].label
  var ov = document.getElementById('rebind-overlay')
  if (ov) ov.classList.add('active')
  /* Visual flag on the originating button */
  var btn = document.querySelector('.control-key-btn[data-action="' + action + '"]')
  if (btn) btn.classList.add('capturing')
}
function _closeRebind() {
  _rebindAction = null
  var ov = document.getElementById('rebind-overlay')
  if (ov) ov.classList.remove('active')
  document.querySelectorAll('.control-key-btn.capturing').forEach(function (b) {
    b.classList.remove('capturing')
  })
}

/* Capture phase listener so we beat any other keydown handler. */
document.addEventListener('keydown', function (ev) {
  if (!_rebindAction) return
  ev.preventDefault()
  ev.stopPropagation()
  if (ev.key === 'Escape') { _closeRebind(); return }
  /* Reject pure modifier keys */
  if (ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Alt' || ev.key === 'Meta') return
  window.keybinds.set(_rebindAction, ev.key)
  _closeRebind()
  buildControlsList()
}, true)

/* Click handler — open capture modal on key-button click */
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest && ev.target.closest('.control-key-btn[data-action]')
  if (!btn) return
  var action = btn.getAttribute('data-action')
  _openRebind(action)
})

/* Reset button */
;(function wireResetBtn() {
  var btn = document.getElementById('controls-reset')
  if (!btn) return
  btn.addEventListener('click', function () {
    if (!window.keybinds) return
    window.keybinds.reset()
    buildControlsList()
  })
})()

/* Close without applying */
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('active')
}

/* Build the window-mode selector */
function buildModeList() {
  document.querySelectorAll('#mode-list .settings-option').forEach(el => {
    const isSelected = el.dataset.mode === selectedMode
    el.classList.toggle('selected', isSelected)
    el.querySelector('.opt-selector').textContent = isSelected ? '▶' : ' '
  })
}

/* Build the resolution list from pool + native */
function buildResList() {
  const { width: nW, height: nH } = nativeRes

  // Filter pool to resolutions ≤ native, then add native if not already there
  let list = RES_POOL.filter(r => r.w <= nW && r.h <= nH)
  if (!list.some(r => r.w === nW && r.h === nH)) {
    list.push({ w: nW, h: nH })
    list.sort((a, b) => a.w - b.w)
  }

  const container = document.getElementById('res-list')
  container.innerHTML = ''

  list.forEach(res => {
    const isNative   = res.w === nW && res.h === nH
    const isSelected = res.w === selectedRes.w && res.h === selectedRes.h

    const el = document.createElement('div')
    el.className = 'settings-option' + (isSelected ? ' selected' : '')
    el.innerHTML =
      `<span class="opt-selector">${isSelected ? '▶' : ' '}</span>` +
      `<span class="opt-label">${res.w} × ${res.h}</span>` +
      (isNative ? `<span class="opt-tag">// NATIVE</span>` : '')

    el.addEventListener('click', () => {
      selectedRes = { w: res.w, h: res.h }
      buildResList() // re-render with new selection
    })

    container.appendChild(el)
  })
}

/* Grey out resolution section when fullscreen is selected */
function updateResSection() {
  document.getElementById('res-section')
    .classList.toggle('disabled', selectedMode === 'fullscreen')
}

/* Mode option clicks */
document.getElementById('mode-list').addEventListener('click', e => {
  const option = e.target.closest('.settings-option')
  if (!option) return
  selectedMode = option.dataset.mode
  buildModeList()
  updateResSection()
})

/* Apply button */
document.getElementById('settings-apply').addEventListener('click', async () => {
  await ipcRenderer.invoke('apply-settings', {
    mode:   selectedMode,
    width:  selectedRes.w,
    height: selectedRes.h,
  })
  closeSettings()
})

/* Close button + ESC */
document.getElementById('settings-close').addEventListener('click', closeSettings)

/* ═══════════════════════════════════════════════════════════════════
   OPERATOR FILE OVERLAY
   ═══════════════════════════════════════════════════════════════════ */
function openOpFile() {
  document.getElementById('opfile-overlay').classList.add('active')
}
function closeOpFile() {
  document.getElementById('opfile-overlay').classList.remove('active')
}
document.getElementById('opfile-close').addEventListener('click', closeOpFile)

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSettings()
    closeOpFile()
  }
})
