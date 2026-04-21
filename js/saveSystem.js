/* ═══════════════════════════════════════════════════════════════════════
   THERMAL — Save System
   Central persistence module. Writes and reads all long-term player
   state through a single localStorage key: 'thermalSave'.

   Exposed as window.saveSystem for access from menu/game/shift-end
   scripts (the project runs with nodeIntegration=true in Electron,
   but a plain global keeps the HTML script tags simple).
   ═══════════════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict'

  var SAVE_KEY = 'thermalSave'

  /* ── Defaults ─────────────────────────────────────────────────────── */
  function getDefault() {
    return {
      shiftNumber:          1,
      totalMoney:           0,
      targetMoney:          2400,
      shiftsWithoutRent:    0,
      evicted:              false,
      gracePeriod:          false,
      lastShiftRadiation:   0,
      lastShiftMoneySent:   0,
      elenaToneLevel:       0,
      gameOver:             false,
      gameOverReason:       null,
    }
  }

  /* ── Load ─────────────────────────────────────────────────────────── */
  function loadGame() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY)
      if (!raw) return getDefault()
      var parsed = JSON.parse(raw)
      /* Merge with defaults so old saves stay compatible when we add fields. */
      var def = getDefault()
      for (var k in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, k)) def[k] = parsed[k]
      }
      return def
    } catch (e) {
      console.warn('[saveSystem] load failed, returning defaults:', e)
      return getDefault()
    }
  }

  /* ── Save ─────────────────────────────────────────────────────────── */
  function saveGame(data) {
    try {
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(data))
      return true
    } catch (e) {
      console.warn('[saveSystem] save failed:', e)
      return false
    }
  }

  /* ── Reset ────────────────────────────────────────────────────────── */
  function resetGame() {
    try { global.localStorage.removeItem(SAVE_KEY) } catch (e) {}
    /* Also clear transient per-shift artefacts so a fresh run is truly clean. */
    try { global.localStorage.removeItem('thermalShiftReport') } catch (e) {}
    try { global.localStorage.removeItem('thermalShiftNumber') } catch (e) {}
    try { global.localStorage.removeItem('thermalDecryptedFiles') } catch (e) {}
    try { global.localStorage.removeItem('thermalAnomalyLog') } catch (e) {}
    var fresh = getDefault()
    saveGame(fresh)
    return fresh
  }

  /* ── Money calculation from a shift report ────────────────────────── */
  /* 0-1.5 mSv  → 400 (100 %)
     1.5-2.5    → 300 (75 %)
     2.5-3.5    → 200 (50 %)
     3.5+       → 100 (25 %)
     Meltdown   → 0                                                     */
  function calcShiftPay(radiationReached, meltdownOccurred) {
    if (meltdownOccurred) return 0
    var r = radiationReached || 0
    if (r < 1.5) return 400
    if (r < 2.5) return 300
    if (r < 3.5) return 200
    return 100
  }

  /* ── Apply a completed shift to the save ──────────────────────────── */
  /* Returns the updated save object (and writes it to localStorage).   */
  function updateShift(shiftReport) {
    var save = loadGame()
    shiftReport = shiftReport || {}

    var radReached = (typeof shiftReport.radiationReached === 'number')
      ? shiftReport.radiationReached
      : (shiftReport.finalRadiation || 0)

    var pay = calcShiftPay(radReached, !!shiftReport.meltdownOccurred)

    save.lastShiftRadiation = radReached
    save.totalMoney         = (save.totalMoney || 0) + pay

    if (shiftReport.meltdownOccurred) {
      /* Meltdown → run ends. Player must start a new game. */
      save.gameOver       = true
      save.gameOverReason = 'meltdown'
    } else if (shiftReport.streetDeath) {
      /* Homelessness death → run ends. */
      save.gameOver       = true
      save.gameOverReason = 'street'
    } else {
      save.shiftNumber = (save.shiftNumber || 1) + 1
    }

    /* Win check — player has earned enough for Mira's treatment. */
    if (!save.gameOver && save.totalMoney >= save.targetMoney) {
      save.gameOver       = true
      save.gameOverReason = 'win'
    }

    saveGame(save)
    return save
  }

  /* ── Export ───────────────────────────────────────────────────────── */
  global.saveSystem = {
    SAVE_KEY:    SAVE_KEY,
    getDefault:  getDefault,
    loadGame:    loadGame,
    saveGame:    saveGame,
    resetGame:   resetGame,
    updateShift: updateShift,
    calcShiftPay: calcShiftPay,
  }
})(typeof window !== 'undefined' ? window : this)
