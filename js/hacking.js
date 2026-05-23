/* ═══════════════════════════════════════════════════════════════════
   THERMAL — hacking.js
   Decryption mini-game for the FILES tab in home-terminal.
   5 rows × 3 tokens per row. Player selects the correct token in
   each row top-to-bottom. One wrong answer resets all rows.
   Fixed password per file; decoy tokens randomise every attempt.
   Depends on: saveSystem.js
   ═══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  var overlayEl  = document.getElementById('hack-overlay')
  if (!overlayEl) return   // not on home-terminal

  var gridEl     = document.getElementById('hack-grid')
  var statusEl   = document.getElementById('hack-status')
  var filenameEl = document.getElementById('hack-filename')
  var rowNumEl   = document.getElementById('hack-row-num')
  var abortEl    = document.getElementById('hack-abort')

  /* ── Persistence ─────────────────────────────────────────────── */
  var DECRYPT_KEY = 'thermalDecryptedFiles'

  function loadDecrypted() {
    try { return JSON.parse(localStorage.getItem(DECRYPT_KEY)) || [] } catch (e) { return [] }
  }

  function saveDecrypted(arr) {
    try { localStorage.setItem(DECRYPT_KEY, JSON.stringify(arr)) } catch (e) {}
  }

  /* ── File definitions — fixed passwords ─────────────────────── */
  /* Each password entry is the correct token for that row.        */
  var FILE_DEFS = {
    kowalski: {
      filename: 'KOWALSKI_OP14.LOG',
      password: ['[4-KwRx]', '[mZ-91a]', '[7bN-qp]', '[Lx-304]', '[9vR-mw]']
    },
    reznov: {
      filename: 'REZNOV_OP15.LOG',
      password: ['[Bz-3qq]', '[x7-KNm]', '[pR-94v]', '[2wL-xk]', '[Nq-7Bz]']
    },
    deleted: {
      filename: 'OP16_[DELETED].LOG',
      password: ['[0x-RRm]', '[Kq-71b]', '[wN-x33]', '[4p-ZZr]', '[mB-09k]']
    }
  }

  /* ── State ───────────────────────────────────────────────────── */
  var _state = { fileKey: null, currentRow: 0, locked: false }

  /* ── Token generator — random-looking strings ────────────────── */
  var _CH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  function _rc() { return _CH[Math.floor(Math.random() * _CH.length)] }

  function randToken() {
    var p1 = _rc() + (Math.random() > 0.45 ? _rc() : '')
    var p2 = _rc() + _rc() + (Math.random() > 0.40 ? _rc() : '')
    return '[' + p1 + '-' + p2 + ']'
  }

  /* ── Build / rebuild the grid ───────────────────────────────── */
  function buildGrid(fileKey) {
    var def = FILE_DEFS[fileKey]
    gridEl.innerHTML = ''

    def.password.forEach(function (correct, rowIdx) {
      var rowEl = document.createElement('div')
      rowEl.className = 'hack-row'
      rowEl.setAttribute('data-row', rowIdx)

      /* Two unique decoys that don't collide with the correct token */
      var decoys = []
      while (decoys.length < 2) {
        var t = randToken()
        if (t !== correct && decoys.indexOf(t) === -1) decoys.push(t)
      }

      /* Place correct token at a random position among the three */
      var pos    = Math.floor(Math.random() * 3)
      var di     = 0
      var tokens = []
      for (var i = 0; i < 3; i++) {
        tokens.push(i === pos
          ? { text: correct,     correct: true  }
          : { text: decoys[di++], correct: false })
      }

      tokens.forEach(function (tok) {
        var btn = document.createElement('button')
        btn.className   = 'hack-token'
        btn.textContent = tok.text
        ;(function (ri, isCorrect) {
          btn.addEventListener('click', function () {
            onTokenClick(ri, isCorrect, btn)
          })
        })(rowIdx, tok.correct)
        rowEl.appendChild(btn)
      })

      gridEl.appendChild(rowEl)
    })

    _refreshRowStates()
  }

  /* ── Row visual states ──────────────────────────────────────── */
  function _refreshRowStates() {
    var rows = gridEl.querySelectorAll('.hack-row')
    rows.forEach(function (row) {
      var idx = parseInt(row.getAttribute('data-row'), 10)
      row.classList.remove('row-active', 'row-inactive', 'row-done')
      if      (idx < _state.currentRow) row.classList.add('row-done')
      else if (idx === _state.currentRow) row.classList.add('row-active')
      else                               row.classList.add('row-inactive')
    })
    if (rowNumEl) rowNumEl.textContent = Math.min(_state.currentRow + 1, 5)
  }

  /* ── Token click handler ─────────────────────────────────────── */
  function onTokenClick(rowIdx, correct, btn) {
    if (_state.locked)                    return
    if (rowIdx !== _state.currentRow)     return

    if (correct) {
      /* Lock in this row visually */
      var row = gridEl.querySelector('.hack-row[data-row="' + rowIdx + '"]')
      if (row) {
        row.classList.remove('row-active')
        row.classList.add('row-done')
        row.querySelectorAll('.hack-token').forEach(function (b) { b.disabled = true })
        btn.classList.add('token-correct')
        btn.disabled = false   /* keep correct token visible and styled */
      }

      _state.currentRow++

      if (_state.currentRow >= 5) {
        onSuccess()
      } else {
        _refreshRowStates()
        setStatus('// ROW ' + _state.currentRow + ' UNLOCKED — CONTINUE', '')
      }

    } else {
      onWrong()
    }
  }

  /* ── Wrong answer ────────────────────────────────────────────── */
  function onWrong() {
    _state.locked = true
    setStatus('// INCORRECT SEQUENCE — RESETTING', 'var(--amber)')

    var rows = gridEl.querySelectorAll('.hack-row')
    rows.forEach(function (row) { row.classList.add('row-flash') })

    setTimeout(function () {
      _state.currentRow = 0
      _state.locked     = false
      setStatus('// SELECT CORRECT TOKEN — TOP TO BOTTOM', '')
      buildGrid(_state.fileKey)
    }, 1000)
  }

  /* ── All rows correct ────────────────────────────────────────── */
  function onSuccess() {
    _state.locked = true
    setStatus('// ACCESS GRANTED — DECRYPTION COMPLETE', 'var(--phosphor)')

    var rows = gridEl.querySelectorAll('.hack-row')
    rows.forEach(function (row) { row.classList.add('row-success') })

    /* Persist */
    var dec = loadDecrypted()
    if (dec.indexOf(_state.fileKey) === -1) dec.push(_state.fileKey)
    saveDecrypted(dec)

    /* Achievement triggers — first KOWALSKI hack + all-three combo */
    if (window.achievements) {
      try {
        if (_state.fileKey === 'kowalski') window.achievements.unlock('ACH_CAUGHT_THE_LIE')
        var allThree = ['kowalski','reznov','deleted'].every(function (k) { return dec.indexOf(k) !== -1 })
        if (allThree) window.achievements.unlock('ACH_THREE_OPS')
      } catch (e) {}
    }

    setTimeout(function () {
      var key = _state.fileKey
      closeHack()
      _onDecrypted(key)
    }, 1400)
  }

  /* ── Post-decrypt DOM update ─────────────────────────────────── */
  function _onDecrypted(key) {
    /* Update file entry card */
    var entryEl = document.getElementById('file-' + key)
    if (entryEl) {
      entryEl.className = 'file-entry unlocked'
      var badge = entryEl.querySelector('.file-badge')
      if (badge) { badge.className = 'file-badge decrypted'; badge.textContent = '[DECRYPTED]' }
      var nameEl = entryEl.querySelector('.file-name')
      if (nameEl) { nameEl.style.color = ''; nameEl.style.textShadow = '' }
    }

    /* Update footer count */
    var dec      = loadDecrypted()
    var footerEl = document.getElementById('files-footer')
    if (footerEl) {
      footerEl.textContent = '// 18 FILES — ' + (18 - dec.length) +
                             ' ENCRYPTED — ' + dec.length + ' ACCESSIBLE'
    }

    /* Hide tab badge if no more available-but-undecrypted files remain */
    var badgeEl = document.getElementById('tab-files-badge')
    if (badgeEl) {
      var save      = window.saveSystem ? window.saveSystem.loadGame() : null
      var shiftNum  = save ? (save.shiftNumber || 1) : 1
      var thresholds = { kowalski: 2, reznov: 4, deleted: 6 }
      var anyPending = Object.keys(thresholds).some(function (k) {
        return shiftNum >= thresholds[k] && dec.indexOf(k) === -1
      })
      if (!anyPending) badgeEl.classList.remove('visible')
    }
  }

  /* ── Open / close ────────────────────────────────────────────── */
  function openHack(fileKey) {
    if (!FILE_DEFS[fileKey]) return

    /* Already decrypted — hand off to log reader (built in step 4) */
    var dec = loadDecrypted()
    if (dec.indexOf(fileKey) !== -1) {
      if (window.openLogReader) window.openLogReader(fileKey)
      return
    }

    _state.fileKey    = fileKey
    _state.currentRow = 0
    _state.locked     = false

    if (filenameEl) filenameEl.textContent = FILE_DEFS[fileKey].filename
    setStatus('// SELECT CORRECT TOKEN — TOP TO BOTTOM', '')
    buildGrid(fileKey)

    overlayEl.style.display = 'flex'
  }

  function closeHack() {
    overlayEl.style.display = 'none'
    _state.locked = false
  }

  /* ── Status helper ───────────────────────────────────────────── */
  function setStatus(txt, color) {
    if (!statusEl) return
    statusEl.textContent  = txt
    statusEl.style.color  = color || ''
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.openHack = openHack

  /* ── Delegated click on file entries ────────────────────────── */
  var listEl = document.getElementById('files-list')
  if (listEl) {
    listEl.addEventListener('click', function (e) {
      var entry = e.target.closest('.file-entry[data-file]')
      if (!entry) return
      if (entry.classList.contains('available') || entry.classList.contains('unlocked')) {
        openHack(entry.getAttribute('data-file'))
      }
    })
  }

  /* ── Abort + ESC ─────────────────────────────────────────────── */
  if (abortEl) abortEl.addEventListener('click', closeHack)

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') closeHack()
  })

})()
