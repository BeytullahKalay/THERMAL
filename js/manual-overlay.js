/* ═══════════════════════════════════════════════════════════════════
   THERMAL — manual-overlay.js
   Procedure manual that the operator consults to fix ER codes.
   ─────────────────────────────────────────────────────────────────
   Reads window.ER_CODES (loaded by the host screen). Renders the
   `manualPrescription` of each code — note this is sometimes WRONG.
   Roughly 30% of codes carry `manualLies: true` and the truth lives
   in the previous-operator hack logs (KOWALSKI / REZNOV / DELETED).

   The manual itself does NOT reveal which entries are lies — the
   layout treats every prescription as equally authoritative. The
   only hint is the small dated-revision footer ("REV 2018.04 —
   DISCREPANCIES MAY EXIST"). Players learn to cross-reference logs
   the hard way.

   Public API:
     window.manualOverlay.open()           — show, default to first code
     window.manualOverlay.openTo(codeId)   — show, jump to specific code
     window.manualOverlay.close()
     window.manualOverlay.toggle()
     window.manualOverlay.isOpen()
   ═══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  var CODES = (window.ER_CODES && window.ER_CODES.codes) ? window.ER_CODES.codes : []
  var _open       = false
  var _selectedId = null

  function _q(id) { return document.getElementById(id) }

  /* Manual revision string — bumps to '2018.05' once HQ pushes the
     placebo revision (shift 6 home-terminal). Reads from saveSystem. */
  function _currentRev() {
    try {
      var s = (window.saveSystem && window.saveSystem.loadGame) ? window.saveSystem.loadGame() : null
      return (s && s.manualRev) || '2018.04'
    } catch (e) { return '2018.04' }
  }

  /* ── Self-inject CSS + DOM container ──────────────────────────
     The manual is reused on multiple screens (game.html, home-
     terminal.html). Rather than asking each host page to embed the
     same ~200 lines of CSS and the container <div>, we inject them
     here on first load if they don't already exist. Hosts that
     already define them (e.g. inline in game.html) are no-ops. */
  function _injectCSS() {
    if (document.getElementById('mn-style')) return
    var s = document.createElement('style')
    s.id = 'mn-style'
    s.textContent =
      '#manual-overlay{position:fixed;inset:0;z-index:1800;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.78);pointer-events:auto}' +
      '#manual-overlay.mn-open{animation:mnFadeIn 0.18s ease-out}' +
      '@keyframes mnFadeIn{from{opacity:0}to{opacity:1}}' +
      '.mn-frame{width:min(880px,92vw);height:min(600px,86vh);background:#0b0f05;border:1px solid #4a7a1a;box-shadow:0 0 30px rgba(168,255,62,0.18),inset 0 0 24px rgba(0,0,0,0.6);display:flex;flex-direction:column;font-family:"Share Tech Mono",monospace;color:#a8ff3e}' +
      '.mn-header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #1e2e0c;flex-shrink:0}' +
      '.mn-title{font-size:14px;letter-spacing:4px;color:#a8ff3e;text-shadow:0 0 8px rgba(168,255,62,0.4)}' +
      '.mn-close-btn{font-family:"Share Tech Mono",monospace;font-size:13px;color:#4a7a1a;background:transparent;border:1px solid #1e2e0c;padding:4px 10px;cursor:pointer;letter-spacing:2px}' +
      '.mn-close-btn:hover{color:#a8ff3e;border-color:#a8ff3e;background:rgba(168,255,62,0.08)}' +
      '.mn-body{flex:1;display:flex;overflow:hidden}' +
      '.mn-index{width:240px;border-right:1px solid #1e2e0c;overflow-y:auto;padding:8px 0;flex-shrink:0}' +
      '.mn-index::-webkit-scrollbar{width:6px}.mn-index::-webkit-scrollbar-thumb{background:rgba(168,255,62,0.18);border-radius:3px}' +
      '.mn-idx-row{display:flex;align-items:baseline;gap:6px;padding:6px 12px;cursor:pointer;border-left:2px solid transparent;font-size:11px;letter-spacing:1px;transition:background 0.1s,border-color 0.1s}' +
      '.mn-idx-row:hover{background:rgba(168,255,62,0.06)}' +
      '.mn-idx-row.mn-idx-sel{background:rgba(168,255,62,0.10);border-left-color:#a8ff3e}' +
      '.mn-idx-id{font-family:"VT323",monospace;font-size:14px;color:#a8ff3e;width:62px;flex-shrink:0}' +
      '.mn-idx-tag{font-size:9px;letter-spacing:1px;color:#4a7a1a;width:44px;flex-shrink:0}' +
      '.mn-idx-ttl{flex:1;font-size:10px;letter-spacing:1px;color:#6a9a2a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.mn-detail{flex:1;overflow-y:auto;padding:22px 28px}' +
      '.mn-detail::-webkit-scrollbar{width:6px}.mn-detail::-webkit-scrollbar-thumb{background:rgba(168,255,62,0.18);border-radius:3px}' +
      '.mn-page{position:relative;font-size:13px;line-height:1.55;letter-spacing:1px}' +
      '.mn-page-no{position:absolute;top:0;right:0;font-size:10px;letter-spacing:3px;color:#4a7a1a}' +
      '.mn-page-id{font-family:"VT323",monospace;font-size:36px;letter-spacing:6px;color:#a8ff3e;text-shadow:0 0 8px rgba(168,255,62,0.4);margin-bottom:4px}' +
      '.mn-page-sub{font-size:14px;letter-spacing:4px;color:#a8ff3e;margin-bottom:4px}' +
      '.mn-page-sys{font-size:11px;letter-spacing:3px;color:#4a7a1a;margin-bottom:14px}' +
      '.mn-rule{border-top:1px dashed rgba(168,255,62,0.25);margin:12px 0}' +
      '.mn-section-label{font-size:11px;letter-spacing:3px;color:#6a9a2a;margin-bottom:10px}' +
      '.mn-grid{display:flex;flex-direction:column;gap:6px;margin-bottom:4px}' +
      '.mn-row{display:flex;justify-content:space-between;gap:16px;font-size:12px;border-bottom:1px dotted rgba(74,122,26,0.3);padding-bottom:4px}' +
      '.mn-key{color:#6a9a2a;letter-spacing:1px}' +
      '.mn-val{color:#a8ff3e;letter-spacing:2px;text-align:right}' +
      '.mn-val-num{font-family:"VT323",monospace;font-size:22px;line-height:1}' +
      '.mn-val-seq{font-family:"VT323",monospace;font-size:18px;letter-spacing:3px}' +
      '.mn-prose{font-size:12px;line-height:1.6;color:#a8ff3e;background:rgba(168,255,62,0.04);padding:10px 14px;border-left:2px solid #4a7a1a}' +
      '.mn-page-foot{margin-top:22px;font-size:10px;letter-spacing:3px;color:#4a7a1a;text-align:center;border-top:1px solid #1e2e0c;padding-top:10px}' +
      '.mn-empty{padding:40px;text-align:center;color:#4a7a1a;font-size:12px;letter-spacing:3px}' +
      '.mn-footer{padding:8px 18px;border-top:1px solid #1e2e0c;font-size:10px;letter-spacing:3px;color:#4a7a1a;text-align:center;flex-shrink:0}' +
      /* Annotated prescription rows — manual lie struck through red,
         hand-written correction in bright phosphor with subtle tilt. */
      '.mn-val-lie{color:#ff5a5a;text-decoration:line-through;text-decoration-color:#ff3a3a;text-decoration-thickness:2px;opacity:0.65;text-shadow:none}' +
      '.mn-val-arrow{color:#ff5a5a;font-family:"VT323",monospace;font-size:18px;margin:0 8px;opacity:0.7}' +
      '.mn-val-truth{color:#a8ff3e;font-family:"VT323",monospace;font-size:22px;letter-spacing:3px;text-shadow:0 0 6px rgba(168,255,62,0.55)}' +
      '.mn-page-annotated .mn-page-id::after{content:" ✦";color:#a8ff3e;font-size:18px;text-shadow:0 0 8px rgba(168,255,62,0.7)}' +
      '.mn-margin{margin-top:18px;padding:10px 14px;border:1px dashed rgba(168,255,62,0.45);background:rgba(168,255,62,0.03);font-family:"Share Tech Mono",monospace;color:#a8ff3e;position:relative}' +
      '.mn-margin-header{font-size:13px;letter-spacing:1px;color:#ffb830;margin-bottom:4px;font-family:"Share Tech Mono",monospace}' +
      '.mn-margin-body{font-size:12px;line-height:1.5;letter-spacing:1px;color:#a8ff3e;text-shadow:0 0 4px rgba(168,255,62,0.4)}' +
      '.mn-margin-source{margin-top:6px;font-size:10px;letter-spacing:2px;color:#6a9a2a;font-family:"Share Tech Mono",monospace;opacity:0.85}'
    document.head.appendChild(s)
  }

  function _injectDOM() {
    if (_q('manual-overlay')) return
    var ov = document.createElement('div')
    ov.id = 'manual-overlay'
    ov.style.display = 'none'
    ov.innerHTML =
      '<div class="mn-frame">' +
        '<div class="mn-header">' +
          '<div class="mn-title">// PROCEDURE MANUAL — UNIT 4 OPERATIONS HANDBOOK</div>' +
          '<button id="mn-close" class="mn-close-btn" title="Close (Esc)">[ × ]</button>' +
        '</div>' +
        '<div class="mn-body">' +
          '<div id="mn-index" class="mn-index"></div>' +
          '<div id="mn-detail" class="mn-detail"></div>' +
        '</div>' +
        '<div class="mn-footer" id="mn-footer">// PRESS [' + (window.keybinds ? window.keybinds.label('manual') : 'H') + '] TO TOGGLE — [ESC] TO CLOSE — REV ' + _currentRev() + ' — PRINTED ON RECYCLED FORM</div>' +
      '</div>'
    document.body.appendChild(ov)
  }

  function _ensureMounted() {
    _injectCSS()
    if (document.body) _injectDOM()
    else document.addEventListener('DOMContentLoaded', _injectDOM)
  }
  _ensureMounted()

  /* ── Render the system tag glyph ─────────────────────────────── */
  var SYSTEM_TAG = {
    sicaklik: '[TEMP]',
    basinc:   '[PRES]',
    guc:      '[POWR]'
  }

  function _findCode(id) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i].id === id) return CODES[i]
    return CODES[0] || null
  }

  /* ── Build the left index ────────────────────────────────────── */
  function _renderIndex() {
    var ix = _q('mn-index')
    if (!ix) return
    ix.innerHTML = CODES.map(function (c) {
      var sel = (c.id === _selectedId) ? ' mn-idx-sel' : ''
      return '<div class="mn-idx-row' + sel + '" data-code="' + c.id + '">' +
               '<span class="mn-idx-id">'  + c.id + '</span>' +
               '<span class="mn-idx-tag">' + (SYSTEM_TAG[c.systemTag] || '[----]') + '</span>' +
               '<span class="mn-idx-ttl">' + (c.title || '') + '</span>' +
             '</div>'
    }).join('')
  }

  /* ── Decrypted-logs lookup ────────────────────────────────────
     A code's truth becomes visible only after its source log has
     been hacked. The hack mini-game writes 'kowalski'/'reznov'/
     'deleted' into thermalDecryptedFiles. */
  function _decryptedKeys() {
    try { return JSON.parse(localStorage.getItem('thermalDecryptedFiles') || '[]') }
    catch (e) { return [] }
  }
  function _isAnnotated(code) {
    if (!code.manualLies || !code.logKey) return false
    return _decryptedKeys().indexOf(code.logKey) !== -1
  }

  /* Per-code "annotation has been revealed once" tracking — drives
     the typewriter reveal on first view post-hack. Persists so the
     animation only plays once per code, not on every re-open. */
  var _SEEN_KEY = 'thermalAnnotationsSeen'
  function _seenAnnotations() {
    try { return JSON.parse(localStorage.getItem(_SEEN_KEY) || '[]') }
    catch (e) { return [] }
  }
  function _markSeen(codeId) {
    try {
      var s = _seenAnnotations()
      if (s.indexOf(codeId) === -1) {
        s.push(codeId)
        localStorage.setItem(_SEEN_KEY, JSON.stringify(s))
      }
    } catch (e) {}
  }
  function _shouldReveal(code) {
    return _isAnnotated(code) && _seenAnnotations().indexOf(code.id) === -1
  }

  /* For each prescription field, return [manualValue, trueValue, isLie].
     Sequences are rendered as joined strings for display. */
  function _fieldDiff(code, key) {
    var m = code.manualPrescription || {}
    var t = code.truePrescription   || {}
    var fmt = function (v) {
      if (Array.isArray(v)) return v.join('  →  ')
      return (v != null) ? String(v) : '—'
    }
    var manual = fmt(m[key])
    var truth  = fmt(t[key])
    return { manual: manual, truth: truth, lie: manual !== truth }
  }

  /* Render a single prescription row. If the code is annotated AND
     this field is a lie, the manual value is struck through in red
     and the true value is appended as a hand-written correction. */
  function _row(label, manualVal, trueVal, isLie, annotated, valClass) {
    valClass = valClass || 'mn-val-num'
    var inner
    if (annotated && isLie) {
      inner =
        '<span class="mn-val mn-val-lie ' + valClass + '">' + manualVal + '</span>' +
        '<span class="mn-val-arrow">→</span>' +
        '<span class="mn-val mn-val-truth ' + valClass + '">' + trueVal + '</span>'
    } else {
      inner = '<span class="mn-val ' + valClass + '">' + manualVal + '</span>'
    }
    return '<div class="mn-row"><span class="mn-key">' + label + ':</span>' + inner + '</div>'
  }

  /* ── Build the right detail page ─────────────────────────────── */
  function _renderDetail() {
    var det = _q('mn-detail')
    if (!det) return
    var c = _findCode(_selectedId)
    if (!c) {
      det.innerHTML = '<div class="mn-empty">// no procedures indexed</div>'
      return
    }
    var sysLabel = ({
      sicaklik: 'TEMPERATURE LOOP',
      basinc:   'PRIMARY PRESSURE',
      guc:      'POWER GRID'
    })[c.systemTag] || 'GENERAL'

    var annotated = _isAnnotated(c)
    var dPwr = _fieldDiff(c, 'power')
    var dPrs = _fieldDiff(c, 'pressure')
    var dVlv = _fieldDiff(c, 'valveSeq')
    var dSrv = _fieldDiff(c, 'soundSeq')

    /* Annotated note + corrected prose if hacked. */
    var marginNote = ''
    if (annotated) {
      marginNote =
        '<div class="mn-margin">' +
          '<div class="mn-margin-header">// MARGIN NOTE — operator correction</div>' +
          '<div class="mn-margin-body">' +
            'Manual is wrong. Above corrections cross-referenced from operator log.' +
          '</div>' +
          '<div class="mn-margin-source">// VERIFIED SOURCE: ' + (c.logCitation || c.logRef || 'OPERATOR LOG') + '</div>' +
        '</div>'
    }

    /* If lies AND not annotated, no visible discrepancy — manual reads
       confidently. Player must hack the log to see corrections. */
    var pageClass = annotated ? 'mn-page mn-page-annotated' : 'mn-page'

    det.innerHTML =
      '<div class="' + pageClass + '">' +
        '<div class="mn-page-no">PAGE ' +
          (CODES.indexOf(c) + 1) + ' / ' + CODES.length +
        '</div>' +

        '<div class="mn-page-id">' + c.id + '</div>' +
        '<div class="mn-page-sub">' + (c.title || '') + '</div>' +
        '<div class="mn-page-sys">// ' + sysLabel + '</div>' +

        '<div class="mn-rule"></div>' +

        '<div class="mn-section-label">// PRESCRIBED CORRECTIVE ACTION</div>' +

        '<div class="mn-grid">' +
          _row('POWER allocation',     dPwr.manual, dPwr.truth, dPwr.lie, annotated, 'mn-val-num') +
          _row('PRESSURE allocation',  dPrs.manual, dPrs.truth, dPrs.lie, annotated, 'mn-val-num') +
          _row('VALVE sequence',       dVlv.manual, dVlv.truth, dVlv.lie, annotated, 'mn-val-seq') +
          _row('SURVEY tone sequence', dSrv.manual, dSrv.truth, dSrv.lie, annotated, 'mn-val-seq') +
        '</div>' +

        '<div class="mn-rule"></div>' +

        '<div class="mn-section-label">// NOTES</div>' +
        '<div class="mn-prose">' + (c.manualText || 'No additional notes on file.') + '</div>' +

        marginNote +

        '<div class="mn-page-foot">' +
          '// PROCEDURE FILED REV ' + _currentRev() + ' — UNIT 4 OPS — DISCREPANCIES MAY EXIST' +
        '</div>' +
      '</div>'

    /* Annotation reveal — first time the player views THIS code's
       page after hacking the relevant log, animate the corrections
       in as if they're being hand-written right now. Subsequent
       views show the corrections instantly. */
    if (annotated && _shouldReveal(c)) {
      _animateRevealAnnotations(det)
      _markSeen(c.id)
      /* Achievement: viewed an annotated procedure page */
      if (window.achievements) {
        try { window.achievements.unlock('ACH_MARGIN_NOTES') } catch (e) {}
      }
    }
  }

  /* Typewriter-ish reveal: hide all .mn-val-truth + the margin note,
     then fade them back in one at a time with small staggers. The
     green-handwritten font + tilt is already on the elements; we
     only animate visibility/length here. */
  function _animateRevealAnnotations(scope) {
    var truths = scope.querySelectorAll('.mn-val-truth')
    var margin = scope.querySelector('.mn-margin')
    if (truths.length === 0 && !margin) return

    /* Cache final text + zero-out the elements */
    var staged = []
    truths.forEach(function (el) {
      staged.push({ el: el, text: el.textContent })
      el.textContent = ''
      el.style.opacity = '0'
    })
    var marginBody = null
    var marginBodyText = ''
    if (margin) {
      marginBody = margin.querySelector('.mn-margin-body')
      if (marginBody) {
        marginBodyText = marginBody.textContent
        marginBody.textContent = ''
      }
      margin.style.opacity = '0'
      margin.style.transform = 'translateY(6px) rotate(-0.5deg)'
    }

    /* Sequential write-on. Each truth value: 220ms delay between,
       per-character ~22ms typing. Margin body comes last with a
       longer reveal. */
    var t = 220
    staged.forEach(function (s) {
      setTimeout(function () {
        s.el.style.opacity = '1'
        _typeInto(s.el, s.text, 22)
      }, t)
      t += 220 + s.text.length * 22
    })
    if (margin) {
      setTimeout(function () {
        margin.style.transition = 'opacity 0.4s ease, transform 0.4s ease'
        margin.style.opacity = '1'
        margin.style.transform = 'translateY(0) rotate(-0.5deg)'
        if (marginBody) _typeInto(marginBody, marginBodyText, 18)
      }, t + 200)
    }
  }

  function _typeInto(el, text, perChar) {
    var i = 0
    function step() {
      if (i >= text.length) return
      el.textContent = text.slice(0, ++i)
      setTimeout(step, perChar)
    }
    step()
  }

  function _render() {
    _renderIndex()
    _renderDetail()
  }

  /* ── Open / close / toggle ───────────────────────────────────── */
  function open() {
    if (CODES.length === 0) {
      console.warn('[manual] no codes loaded')
      return
    }
    var ov = _q('manual-overlay')
    if (!ov) return
    if (!_selectedId) _selectedId = CODES[0].id
    _render()
    /* Refresh footer text — keybind may have been remapped since
       the DOM was injected. */
    var ftr = _q('mn-footer')
    if (ftr) {
      var k = window.keybinds ? window.keybinds.label('manual') : 'H'
      ftr.textContent = '// PRESS [' + k + '] TO TOGGLE — [ESC] TO CLOSE — REV ' + _currentRev() + ' — PRINTED ON RECYCLED FORM'
    }
    ov.style.display = 'flex'
    ov.classList.add('mn-open')
    _open = true
    if (window.hoverSfx && window.hoverSfx.click) window.hoverSfx.click()
  }

  function openTo(codeId) {
    if (codeId) _selectedId = codeId
    open()
  }

  function close() {
    var ov = _q('manual-overlay')
    if (!ov) return
    ov.classList.remove('mn-open')
    ov.style.display = 'none'
    _open = false
  }

  function toggle() {
    if (_open) { close(); return }
    /* H.4 — If an ER is active, jump straight to that code's
       procedure instead of dumping the player on the first page.
       The player still needs to read it (manual may lie) but they
       don't have to hunt for the section. */
    try {
      if (window.errorSystem && window.errorSystem.isActive && window.errorSystem.isActive()) {
        var code = (window.errorSystem.activeCode && window.errorSystem.activeCode()) || null
        if (code && code.id) { openTo(code.id); return }
      }
    } catch(e){}
    open()
  }

  /* ── Click delegation: index rows + close button ─────────────── */
  document.addEventListener('click', function (ev) {
    var ov = _q('manual-overlay')
    if (!ov || !_open) return

    /* Close button */
    var x = ev.target.closest && ev.target.closest('#mn-close')
    if (x) { ev.stopPropagation(); close(); return }

    /* Backdrop click closes too */
    if (ev.target === ov) { close(); return }

    /* Index row */
    var row = ev.target.closest && ev.target.closest('.mn-idx-row')
    if (row) {
      var id = row.getAttribute('data-code')
      if (id && id !== _selectedId) {
        _selectedId = id
        _render()
        if (window.hoverSfx && window.hoverSfx.log) window.hoverSfx.log()
      }
    }
  }, true)

  /* ── Index navigation while open (↑/↓ to traverse, PgUp/PgDn for
        skip-jump, Home/End for jump). Mouse hover/click still works. */
  function _navIndex(delta) {
    if (!_open || CODES.length === 0) return
    var i = -1
    for (var k = 0; k < CODES.length; k++) {
      if (CODES[k].id === _selectedId) { i = k; break }
    }
    if (i === -1) i = 0
    var next = i + delta
    if (next < 0) next = 0
    if (next >= CODES.length) next = CODES.length - 1
    if (CODES[next].id === _selectedId) return
    _selectedId = CODES[next].id
    _render()
    /* Scroll selected row into view */
    var sel = document.querySelector('.mn-idx-row.mn-idx-sel')
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' })
    if (window.hoverSfx && window.hoverSfx.log) window.hoverSfx.log()
  }

  /* ── Hotkey toggle (default H, rebindable). Esc always closes
        the manual without affecting pause behind it. ─────────── */
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    /* Manual hotkey via central keybinds (falls back to H if module
       isn't loaded for some reason). */
    var manualHit = window.keybinds
      ? window.keybinds.matches(ev, 'manual')
      : (ev.key === 'h' || ev.key === 'H')
    if (manualHit) { ev.preventDefault(); toggle(); return }
    if (ev.key === 'Escape' && _open) { ev.preventDefault(); ev.stopPropagation(); close(); return }
    if (!_open) return
    /* Arrow / page navigation */
    if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); _navIndex(+1) }
    else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); _navIndex(-1) }
    else if (ev.key === 'PageDown') { ev.preventDefault(); _navIndex(+5) }
    else if (ev.key === 'PageUp')   { ev.preventDefault(); _navIndex(-5) }
    else if (ev.key === 'Home')     { ev.preventDefault(); _navIndex(-9999) }
    else if (ev.key === 'End')      { ev.preventDefault(); _navIndex(+9999) }
  }, true)

  /* ── Public API ──────────────────────────────────────────────── */
  window.manualOverlay = {
    open:     open,
    openTo:   openTo,
    close:    close,
    toggle:   toggle,
    isOpen:   function () { return _open }
  }

  console.log('[manualOverlay] loaded — ' + CODES.length + ' procedures indexed')
})()
