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
  document.getElementById('prefix-records')      .textContent = pad(4 + offset)
  document.getElementById('prefix-operatorfile') .textContent = pad(5 + offset)
  document.getElementById('prefix-settings')     .textContent = pad(6 + offset)
  document.getElementById('prefix-exit')         .textContent = pad(7 + offset)
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

  if (c === 'continue') {
    /* CASE 2 — save exists, not game-over */
    primary.style.display = ''
    newgame.style.display = ''
    primLabel.textContent = 'CONTINUE — SHIFT ' + s.shiftNumber
    primMeta.textContent  = ''
    updatePrefixes(true)
  } else {
    /* CASE 1 / CASE 3 — only [01 NEW GAME] */
    primary.style.display = ''
    newgame.style.display = 'none'
    primLabel.textContent = 'NEW GAME'
    if (c === 'ended') {
      primMeta.textContent = s.gameOverReason === 'win' ? '// RUN COMPLETE' : '// RUN ENDED'
    } else {
      primMeta.textContent = ''
    }
    updatePrefixes(false)
  }

  if (progEl) progEl.textContent = s.totalMoney + ' / ' + s.targetMoney

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
    if (opfileLock)  { opfileLock.textContent = '// LOCKED'; opfileLock.className = 'menu-lock' }
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
document.getElementById('menu-item-exit')         .addEventListener('click', () => window.close())
document.getElementById('menu-item-operatorfile') .addEventListener('click', function() {
  if (menuCase() === 'continue') openOpFile()
})

/* ── Confirm dialog buttons ─────────────────────────────────────── */
document.getElementById('reset-confirm-yes').addEventListener('click', onNewGameConfirm)
document.getElementById('reset-confirm-no') .addEventListener('click', onNewGameCancel)

paintMenu()

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

  document.getElementById('settings-overlay').classList.add('active')
}

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
