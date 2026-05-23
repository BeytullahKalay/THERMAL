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
  /* Schema version. Bump this whenever you change the save shape in
     a way that needs migration. Add a case in `_migrate` for the old
     version → new version transformation. Saves with no version are
     treated as v1 (the launch shape). */
  var SAVE_VERSION = 1

  /* ── Defaults ─────────────────────────────────────────────────────── */
  function getDefault() {
    return {
      version:              SAVE_VERSION,
      shiftNumber:          1,
      totalMoney:           0,
      targetMoney:          2400,
      shiftsWithoutRent:    0,
      consecSendHome:       0,    // consecutive shifts the player sent money home (for SOUP achievement)
      evicted:              false,
      gracePeriod:          false,
      lastShiftRadiation:   0,
      lastShiftMoneySent:   0,
      elenaToneLevel:       0,
      gameOver:             false,
      gameOverReason:       null,
      totalExternalVents:   0,    // cumulative vent authorisations across all shifts
      totalExternalRads:    0,    // cumulative Sv discharged externally
      totalPlayerDose:      0,    // operator's cumulative radiation exposure (Sv)
      workerDeaths:         0,    // dispatch casualties across career
    }
  }

  /* ── Migrations ───────────────────────────────────────────────────────
     Each migration takes a v(N) save and returns a v(N+1) save. Add new
     ones as the schema evolves. Pre-versioned saves (no `version` field)
     are treated as v1.

     Example future migration:
       function _v1_to_v2(s) {
         s.someNewField = 0
         s.version = 2
         return s
       }
       _MIGRATIONS[1] = _v1_to_v2
  ─────────────────────────────────────────────────────────────────────── */
  var _MIGRATIONS = {
    /* No active migrations yet — populated as schema bumps land. */
  }

  function _migrate(save) {
    var v = (typeof save.version === 'number') ? save.version : 1
    while (v < SAVE_VERSION) {
      var fn = _MIGRATIONS[v]
      if (typeof fn !== 'function') {
        console.warn('[saveSystem] no migration from v' + v + ' to v' + SAVE_VERSION + ' — keeping fields, bumping version.')
        save.version = SAVE_VERSION
        break
      }
      try {
        save = fn(save) || save
      } catch (e) {
        console.warn('[saveSystem] migration v' + v + ' failed:', e)
        save.version = SAVE_VERSION
        break
      }
      v = (typeof save.version === 'number') ? save.version : (v + 1)
    }
    return save
  }

  /* ── Load ─────────────────────────────────────────────────────────── */
  function loadGame() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY)
      if (!raw) return getDefault()
      var parsed = JSON.parse(raw)
      /* Run migrations before merging with defaults — old saves that
         lack new fields get them filled in here. */
      parsed = _migrate(parsed)
      var def = getDefault()
      for (var k in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, k)) def[k] = parsed[k]
      }
      def.version = SAVE_VERSION   // ensure the merged save carries current version
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
    try { global.localStorage.removeItem('thermalAnnotationsSeen') } catch (e) {}
    try { global.localStorage.removeItem('thermalAnomalyLog') } catch (e) {}
    try { global.localStorage.removeItem('thermalWorkerRoster') } catch (e) {}
    /* Elena decision is keyed by shiftNumber; without this wipe a leftover
       decision from a dead run can accidentally match the first
       home-terminal visit of the new run and render the chat as already-
       decided. */
    try { global.localStorage.removeItem('thermalMsgDecision') } catch (e) {}
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
    /* Read brackets from balance.json if available */
    try {
      var bal = (typeof window !== 'undefined' && window.BALANCE) ? window.BALANCE : null
      if (bal && Array.isArray(bal.pay && bal.pay.brackets)) {
        var brackets = bal.pay.brackets
        for (var i = 0; i < brackets.length; i++) {
          if (r < brackets[i].maxRad) return brackets[i].amount
        }
        return brackets[brackets.length - 1].amount
      }
    } catch(e) {}
    /* Hardcoded fallback */
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

    save.lastShiftRadiation   = radReached
    save.totalMoney           = (save.totalMoney || 0) + pay
    save.totalExternalVents   = (save.totalExternalVents || 0) + (shiftReport.ventCount || 0)
    save.totalExternalRads    = parseFloat(((save.totalExternalRads || 0) + (shiftReport.ventRads || 0)).toFixed(2))

    /* Faz 2/E — carry the previous shift's decision summary forward
       so home-terminal NEWS can inject continuity articles next run.
       Overwritten each shift; only the latest matters. */
    if (shiftReport.lastShiftDecisions) {
      save.lastShiftDecisions = shiftReport.lastShiftDecisions
    }

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

  /* ── Mid-shift autosave — periodic snapshot so a crash mid-shift
        doesn't lose the run. Distinct from the canonical thermalSave
        (which only updates on shift-end). On boot, if an autosave
        exists newer than the canonical save, the menu can offer
        "RESUME". The autosave is cleared whenever a shift ends
        cleanly. */
  var AUTOSAVE_KEY = 'thermalAutosave'

  function writeAutosave(snapshot) {
    /* snapshot expected shape:
       { saveSnapshot: <thermalSave shape>,
         shiftSnapshot: { gcElapsed, gameState fields the player would
                          want to keep through a crash },
         timestamp: Date.now() }                                    */
    try { global.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot)) } catch (e) {}
  }
  function loadAutosave() {
    try {
      var raw = global.localStorage.getItem(AUTOSAVE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (e) { return null }
  }
  function clearAutosave() {
    try { global.localStorage.removeItem(AUTOSAVE_KEY) } catch (e) {}
  }
  function hasFreshAutosave(maxAgeMs) {
    var a = loadAutosave()
    if (!a || !a.timestamp) return false
    var age = Date.now() - a.timestamp
    return age <= (maxAgeMs || 24 * 60 * 60 * 1000)   // 24h default
  }

  /* ── Predecessor record — survives resetGame() so the next run's
        operator can read what happened to the previous one. Stored
        under a separate key intentionally not cleared by reset. */
  var PREDECESSOR_KEY = 'thermalPredecessorLog'

  function writePredecessorLog(rec) {
    try { global.localStorage.setItem(PREDECESSOR_KEY, JSON.stringify(rec)) } catch (e) {}
  }
  function loadPredecessorLog() {
    try {
      var raw = global.localStorage.getItem(PREDECESSOR_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (e) { return null }
  }
  function clearPredecessorLog() {
    try { global.localStorage.removeItem(PREDECESSOR_KEY) } catch (e) {}
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
    writePredecessorLog: writePredecessorLog,
    loadPredecessorLog:  loadPredecessorLog,
    clearPredecessorLog: clearPredecessorLog,
    writeAutosave:       writeAutosave,
    loadAutosave:        loadAutosave,
    clearAutosave:       clearAutosave,
    hasFreshAutosave:    hasFreshAutosave,
    SAVE_VERSION:        SAVE_VERSION,
  }
})(typeof window !== 'undefined' ? window : this)
