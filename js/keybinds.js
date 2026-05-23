/* ═══════════════════════════════════════════════════════════════════
   THERMAL — keybinds.js
   Central keybinding registry. Persists user customizations to
   localStorage so all screens use the same bindings.

   Action ids:
     pause       — pause overlay toggle (default Escape — protected)
     manual      — open/close MANUAL overlay (default H)
     erMini      — minimize / expand active ER panel (default M)
     speed1      — game speed 1× (default 1)
     speed2      — game speed 2× (default 2)
     speed3      — game speed 4× (default 4)

   Public API:
     window.keybinds.get(action)     → key string (e.g. 'h', 'Escape')
     window.keybinds.matches(ev, a)  → bool (case-insensitive single-key match)
     window.keybinds.set(a, key)     → persist binding
     window.keybinds.reset(a?)       → reset one or all to defaults
     window.keybinds.all()           → object snapshot
     window.keybinds.label(action)   → display string ('H', 'ESC', 'SPACE'...)

   Reserved: 'Escape' is the safety key. Pause always responds to it
   even if the user remaps pause to something else, so the player
   can never accidentally trap themselves.
   ═══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  var STORAGE_KEY = 'thermalKeybinds'

  var DEFAULTS = {
    pause:  'Escape',
    manual: 'h',
    erMini: 'm',
    speed1: '1',
    speed2: '2',
    speed3: '4'
  }

  var ACTIONS_META = {
    pause:  { label: 'Pause / Resume',           protected: true  },
    manual: { label: 'Open Procedure Manual',    protected: false },
    erMini: { label: 'Minimize / Expand Error',  protected: false },
    speed1: { label: 'Game Speed 1×',            protected: false },
    speed2: { label: 'Game Speed 2×',            protected: false },
    speed3: { label: 'Game Speed 4×',            protected: false }
  }

  function _load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      var saved = raw ? JSON.parse(raw) : {}
      var out = {}
      Object.keys(DEFAULTS).forEach(function (k) {
        out[k] = (typeof saved[k] === 'string' && saved[k]) ? saved[k] : DEFAULTS[k]
      })
      return out
    } catch (e) { return Object.assign({}, DEFAULTS) }
  }

  function _save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch (e) {}
  }

  var _state = _load()

  function get(action) {
    return _state[action] || DEFAULTS[action] || ''
  }

  function set(action, key) {
    if (!ACTIONS_META[action]) return false
    if (typeof key !== 'string' || key.length === 0) return false
    /* Escape stays bound to pause forever — UI prevents this binding
       but be defensive in case someone calls set() programmatically. */
    if (action === 'pause' && key !== 'Escape') {
      /* allowed but pause keeps Escape as a fallback at the call site */
    }
    _state[action] = key
    _save(_state)
    return true
  }

  function reset(action) {
    if (action) {
      _state[action] = DEFAULTS[action]
    } else {
      _state = Object.assign({}, DEFAULTS)
    }
    _save(_state)
  }

  function all() { return Object.assign({}, _state) }

  /* Compare an event to a bound action. Case-insensitive for letter
     keys. 'Escape', 'Enter', 'Space', arrow keys etc. matched literally. */
  function matches(ev, action) {
    if (!ev || !action) return false
    var bound = get(action)
    if (!bound) return false
    var k = ev.key
    if (!k) return false
    if (bound.length === 1 && k.length === 1) {
      return bound.toLowerCase() === k.toLowerCase()
    }
    return bound === k
  }

  /* Friendly label for UI display ('h' → 'H', ' ' → 'SPACE', etc.) */
  function label(action) {
    var k = get(action)
    if (!k) return '—'
    if (k === ' ' || k === 'Spacebar') return 'SPACE'
    if (k === 'Escape') return 'ESC'
    if (k === 'ArrowUp')    return '↑'
    if (k === 'ArrowDown')  return '↓'
    if (k === 'ArrowLeft')  return '←'
    if (k === 'ArrowRight') return '→'
    if (k.length === 1) return k.toUpperCase()
    return k.toUpperCase()
  }

  window.keybinds = {
    get:      get,
    set:      set,
    reset:    reset,
    all:      all,
    matches:  matches,
    label:    label,
    DEFAULTS: Object.assign({}, DEFAULTS),
    META:     ACTIONS_META
  }
})()
