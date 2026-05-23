/* ═══════════════════════════════════════════════════════════════════
   THERMAL — i18n.js
   Lightweight translation registry. Each locale lives in a flat
   JSON file under /locales/<code>.json and is loaded synchronously
   at boot (via require since nodeIntegration is on).

   Public API:
     window.i18n.t(key, vars?)         — translated string
     window.i18n.setLang(code)         — switch + persist + reload page
     window.i18n.getLang()             — current code
     window.i18n.LANGS                 — meta list for UI pickers
     window.i18n.applyDOM(scope?)      — translate elements with
                                          data-i18n / data-i18n-attr-*
                                          (re-run on DOM mutations)

   Languages registered: en, tr, zh-Hans, ru, de, ja
   ═══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  var STORAGE_KEY = 'thermalLang'

  /* ─── Language metadata for UI ───────────────────────────────── */
  var LANGS = [
    { code: 'en',      name: 'ENGLISH',      native: 'English' },
    { code: 'tr',      name: 'TURKISH',      native: 'Türkçe' },
    { code: 'zh-Hans', name: 'CHINESE',      native: '简体中文' },
    { code: 'ru',      name: 'RUSSIAN',      native: 'Русский' },
    { code: 'de',      name: 'GERMAN',       native: 'Deutsch' },
    { code: 'ja',      name: 'JAPANESE',     native: '日本語' }
  ]

  /* ─── Locale tables — loaded lazily ──────────────────────────── */
  var _tables = {}
  var _current = 'en'

  function _loadTable(code) {
    if (_tables[code]) return _tables[code]
    try {
      var path = require('path')
      var fs   = require('fs')
      /* __dirname is the dir of the page that loaded this script
         (renderer process). Build path to project /locales. */
      var p = path.join(__dirname, '..', 'locales', code + '.json')
      _tables[code] = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch (e) {
      console.warn('[i18n] failed to load locale ' + code + ':', e)
      _tables[code] = {}
    }
    return _tables[code]
  }

  function _init() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY)
      if (saved && LANGS.some(function (l) { return l.code === saved })) {
        _current = saved
      }
    } catch (e) {}
    _loadTable('en')          // fallback always loaded
    _loadTable(_current)
  }

  function _interp(str, vars) {
    if (!vars) return str
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] != null ? String(vars[k]) : m
    })
  }

  function t(key, vars) {
    var tbl = _tables[_current] || {}
    var en  = _tables.en || {}
    var val = (tbl[key] != null) ? tbl[key]
            : (en[key]  != null) ? en[key]
            : key
    return _interp(val, vars)
  }

  function setLang(code) {
    if (!LANGS.some(function (l) { return l.code === code })) return false
    _current = code
    try { localStorage.setItem(STORAGE_KEY, code) } catch (e) {}
    _loadTable(code)
    /* Apply to current DOM immediately; host pages can also reload. */
    applyDOM(document)
    /* Notify any listeners (overlays, dynamic renderers) */
    try { window.dispatchEvent(new CustomEvent('thermal-lang-changed', { detail: { code: code } })) } catch (e) {}
    return true
  }

  function getLang() { return _current }

  /* ─── DOM auto-translation
        Elements decorated with `data-i18n="key"` get their
        textContent replaced. For attributes use
        `data-i18n-attr-<name>="key"` (e.g. data-i18n-attr-title). */
  function applyDOM(scope) {
    scope = scope || document
    var els = scope.querySelectorAll('[data-i18n]')
    els.forEach(function (el) {
      var key = el.getAttribute('data-i18n')
      if (!key) return
      el.textContent = t(key)
    })
    /* Translate any data-i18n-attr-* attributes */
    var attrEls = scope.querySelectorAll('*')
    attrEls.forEach(function (el) {
      for (var i = 0; i < el.attributes.length; i++) {
        var a = el.attributes[i]
        if (a.name.indexOf('data-i18n-attr-') === 0) {
          var targetAttr = a.name.replace('data-i18n-attr-', '')
          el.setAttribute(targetAttr, t(a.value))
        }
      }
    })
  }

  _init()

  window.i18n = {
    t: t,
    setLang: setLang,
    getLang: getLang,
    applyDOM: applyDOM,
    LANGS: LANGS
  }

  /* Auto-apply once DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyDOM(document) })
  } else {
    applyDOM(document)
  }

  console.log('[i18n] loaded — current:', _current, '— languages:', LANGS.map(function (l) { return l.code }).join(', '))
})()
