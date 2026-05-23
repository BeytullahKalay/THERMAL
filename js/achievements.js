/* ═══════════════════════════════════════════════════════════════════
   THERMAL — achievements.js
   Steamworks achievements via Greenworks (Electron-Steam bridge),
   with a graceful fallback that tracks unlocks in localStorage so
   the system works in dev (no Steam running) and survives builds
   shipped before Greenworks is installed.

   Setup (when ready to ship):
     npm install greenworks       (or compile from greenworks-electron)
     Drop steam_appid.txt with your Steam app ID at project root
     Place sdk/* files from Steamworks SDK in node_modules/greenworks/

   Achievement IDs MUST match what you register in Steamworks portal:
     ACH_FIRST_NIGHT, ACH_SIGN_OFF, ACH_CAUGHT_THE_LIE, ACH_THREE_OPS,
     ACH_MARGIN_NOTES, ACH_ELEVEN_SECONDS, ACH_CHAIR_EMPTY,
     ACH_DONT_LOOK_UP, ACH_FILTER_REFUSED, ACH_NO_CASUALTIES,
     ACH_SOUP_IN_FRIDGE, ACH_OP18, ACH_VOLUNTARY, ACH_MELTDOWN

   Public API:
     window.achievements.unlock(id)        — fire one achievement
     window.achievements.isUnlocked(id)    — bool (local cache)
     window.achievements.list()            — all defined IDs
     window.achievements.greenworksReady() — bool
   ═══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  /* ─── Greenworks bootstrap (graceful if missing) ─────────────── */
  var greenworks = null
  var _gwReady = false
  try {
    /* nodeIntegration is on, so require() works from renderer. */
    greenworks = require('greenworks')
    if (greenworks && typeof greenworks.initAPI === 'function') {
      _gwReady = !!greenworks.initAPI()
      if (_gwReady) console.log('[achievements] Greenworks initialised. Steam user:', greenworks.getSteamId().getPersonaName())
      else          console.warn('[achievements] Greenworks present but initAPI() returned false — Steam not running?')
    }
  } catch (e) {
    /* Module not installed (dev mode, or pre-Steam-build). Use local fallback only. */
    console.log('[achievements] Greenworks not available — using localStorage fallback.')
  }

  /* ─── Achievement registry (matches MARKETING_PLAN.md table) ─── */
  var DEFS = {
    ACH_FIRST_NIGHT:     { title: 'First Night',          desc: 'Survive shift 1.' },
    ACH_SIGN_OFF:        { title: 'Sign-Off',             desc: 'Reach the target money. Win the run.' },
    ACH_CAUGHT_THE_LIE:  { title: 'Caught the Lie',       desc: 'Decrypt the KOWALSKI operator log.' },
    ACH_THREE_OPS:       { title: 'Three Operators Deep', desc: 'Decrypt all three operator logs.' },
    ACH_MARGIN_NOTES:    { title: 'Margin Notes',         desc: 'View an annotated procedure page after a hack.' },
    ACH_ELEVEN_SECONDS:  { title: 'Eleven Seconds',       desc: 'Resolve a SYSTEM ERROR in under 11 seconds.', hidden: true },
    ACH_CHAIR_EMPTY:     { title: 'The Chair Was Empty',  desc: 'Read the predecessor file in your next run.', hidden: true },
    ACH_DONT_LOOK_UP:    { title: 'Don\'t Look Up',       desc: 'Survive shift 7. Cascade unlocked.' },
    ACH_FILTER_REFUSED:  { title: 'Filter Refused',       desc: 'Reject an out-of-spec material requisition.', hidden: true },
    ACH_NO_CASUALTIES:   { title: 'No Casualties',        desc: 'Complete a run with zero dispatch deaths.' },
    ACH_SOUP_IN_FRIDGE:  { title: 'Soup in the Fridge',   desc: 'Send rent home for 5 consecutive shifts.' },
    ACH_OP18:            { title: 'OP.18',                desc: 'Read OP18_NOTE.LOG.', hidden: true },
    ACH_VOLUNTARY:       { title: 'Voluntary',            desc: 'Encounter the OP.17 fate news article.', hidden: true },
    ACH_MELTDOWN:        { title: 'Meltdown',             desc: 'Trigger a meltdown.' }
  }

  /* ─── Local-cache layer (always written, even with Greenworks) ── */
  var LOCAL_KEY = 'thermalAchievements'
  function _localGet() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') }
    catch (e) { return {} }
  }
  function _localSet(map) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(map)) } catch (e) {}
  }

  /* ─── Public: unlock an achievement (idempotent) ─────────────── */
  function unlock(id) {
    if (!DEFS[id]) {
      console.warn('[achievements] unknown id:', id)
      return false
    }
    var local = _localGet()
    if (local[id]) return true   // already unlocked locally
    local[id] = Date.now()
    _localSet(local)

    /* Fire to Steam if available */
    if (_gwReady && greenworks && typeof greenworks.activateAchievement === 'function') {
      try {
        greenworks.activateAchievement(id,
          function ()    { /* success — Steam shows toast */ },
          function (err) { console.warn('[achievements] Steam unlock failed for ' + id + ':', err) }
        )
      } catch (e) {
        console.warn('[achievements] activateAchievement threw:', e)
      }
    }

    /* Fire an in-game toast even without Steam, so the dev player
       (and any future non-Steam builds) sees feedback. */
    _toast(id)
    return true
  }

  function isUnlocked(id) { return !!_localGet()[id] }
  function list()         { return Object.keys(DEFS) }

  /* ─── Optional in-game toast (subtle, top-right) ─────────────── */
  function _toast(id) {
    var def = DEFS[id]
    if (!def || typeof document === 'undefined' || !document.body) return
    var t = document.createElement('div')
    t.className = 'ach-toast'
    t.innerHTML =
      '<div class="ach-toast-tag">// ACHIEVEMENT UNLOCKED</div>' +
      '<div class="ach-toast-title">' + def.title + '</div>' +
      '<div class="ach-toast-desc">' + def.desc + '</div>'
    /* inline styling so the toast works even on screens that haven't
       imported the CRT theme */
    t.style.cssText = [
      'position:fixed', 'top:60px', 'right:18px', 'z-index:9500',
      'background:#0b0f05',
      'border:1px solid #a8ff3e',
      'box-shadow:0 0 18px rgba(168,255,62,0.35)',
      'padding:10px 16px',
      'font-family:"Share Tech Mono",monospace',
      'color:#a8ff3e',
      'min-width:220px', 'max-width:300px',
      'animation:achToastIn 0.35s ease-out',
      'opacity:0.98'
    ].join(';')
    document.body.appendChild(t)
    if (window.hoverSfx && window.hoverSfx.click) window.hoverSfx.click()
    /* slide-out + remove after 5s */
    setTimeout(function () {
      t.style.transition = 'opacity 0.4s ease, transform 0.4s ease'
      t.style.opacity = '0'
      t.style.transform = 'translateX(20px)'
      setTimeout(function () { try { document.body.removeChild(t) } catch (e) {} }, 500)
    }, 4500)
  }

  /* Inject toast keyframes + child style once per page */
  ;(function injectStyle() {
    if (typeof document === 'undefined' || !document.head) return
    if (document.getElementById('ach-style')) return
    var s = document.createElement('style')
    s.id = 'ach-style'
    s.textContent =
      '@keyframes achToastIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }' +
      '.ach-toast-tag { font-size:9px; letter-spacing:3px; color:#6a9a2a; margin-bottom:4px; }' +
      '.ach-toast-title { font-family:"VT323",monospace; font-size:18px; letter-spacing:2px; color:#a8ff3e; text-shadow:0 0 6px rgba(168,255,62,0.45); margin-bottom:2px; }' +
      '.ach-toast-desc { font-size:10px; letter-spacing:1px; color:#bbe06a; line-height:1.4; }'
    document.head.appendChild(s)
  })()

  /* ─── Public API ─────────────────────────────────────────────── */
  window.achievements = {
    unlock:           unlock,
    isUnlocked:       isUnlocked,
    list:             list,
    DEFS:             DEFS,
    greenworksReady:  function () { return _gwReady }
  }

  console.log('[achievements] loaded — ' + list().length + ' definitions registered. Steam:', _gwReady)
})()
