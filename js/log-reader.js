/* ═══════════════════════════════════════════════════════════════════
   THERMAL — log-reader.js
   Renders decrypted operator log files in a full-screen overlay.
   Called by hacking.js via window.openLogReader(key) after
   a successful decryption, or directly on re-click of a decrypted
   file entry.
   ═══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  var overlayEl  = document.getElementById('log-overlay')
  if (!overlayEl) return

  var bodyEl     = document.getElementById('log-body')
  var filenameEl = document.getElementById('log-filename')
  var filemetaEl = document.getElementById('log-filemeta')
  var closeEl    = document.getElementById('log-close')

  /* ── Log definitions ─────────────────────────────────────────── */
  /*
     Each entry: { header: 'SHIFT N — ...', lines: [ {ts, text, cls} ] }
     cls: '' (default dim green) | 'hi' (bright) | 'lo' (amber) | 'cut' (unfinished)
     ts: time string or '' for continuation lines
  */

  var LOGS = {

    /* ── KOWALSKI ─────────────────────────────────────────────── */
    kowalski: {
      filename: 'KOWALSKI_OP14.LOG',
      meta:     'OPERATOR: KOWALSKI — 31 SHIFTS — UNIT 4 / NIGHT ROTATION',
      entries: [
        {
          header: 'SHIFT 1',
          lines: [
            { ts: '22:04', text: 'Reporting for duty. Unit 4 nominal on arrival. Handover clean.' },
            { ts: '23:11', text: 'Coolant pressure dropped briefly. Self-corrected. Logged per procedure.' },
            { ts: '06:00', text: 'Shift end. No incidents.' },
          ]
        },
        {
          header: 'SHIFT 7',
          lines: [
            { ts: '22:00', text: 'Handover from day shift. Nothing flagged.' },
            { ts: '01:33', text: 'Temperature spike in secondary loop. Same profile as shift 3.', cls: 'lo' },
            { ts: '',      text: 'Corrected manually. Submitted anomaly report — form R-7.' },
            { ts: '',      text: 'No response yet from technical division.' },
            { ts: '06:00', text: 'Shift end.' },
          ]
        },
        {
          header: 'SHIFT 12',
          lines: [
            { ts: '22:00', text: 'Handover nominal.' },
            { ts: '00:48', text: 'Temperature spike. Third time this month. Same loop, same profile.', cls: 'lo' },
            { ts: '',      text: 'Previous reports marked reviewed. No corrective action on record.' },
            { ts: '',      text: 'Spoke to floor supervisor. He said instrumentation drifts at night.' },
            { ts: '',      text: 'Instrumentation does not drift.', cls: 'hi' },
            { ts: '02:20', text: 'Filed written complaint. Kept a copy.' },
            { ts: '06:00', text: 'Shift end.' },
          ]
        },
        {
          header: 'SHIFT 19',
          lines: [
            { ts: '22:00', text: 'Back from three days off. My complaint was returned.', cls: 'lo' },
            { ts: '',      text: '"Does not meet threshold for escalation."' },
            { ts: '',      text: 'The threshold is apparently my problem.' },
            { ts: '01:15', text: 'Spike again. I stopped filing the forms.' },
            { ts: '06:00', text: 'Shift end.' },
          ]
        },
        {
          header: 'SHIFT 24',
          lines: [
            { ts: '22:00', text: 'Overheard two engineers talking in the corridor outside.' },
            { ts: '',      text: 'They stopped when they saw me.' },
            { ts: '03:44', text: 'Radiation counter gave a reading I have not seen before.', cls: 'lo' },
            { ts: '',      text: 'Reset it twice. Same reading both times.' },
            { ts: '',      text: 'I am going to write this down properly when I get home.' },
            { ts: '06:00', text: 'Shift end.' },
          ]
        },
        {
          header: 'SHIFT 28',
          lines: [
            { ts: '22:00', text: 'Unit 4 nominal. Starting log.' },
            { ts: '04:11', text: 'The reading is back. Higher than last time.', cls: 'lo' },
            { ts: '',      text: 'I have not written it down at home. I keep forgetting.', cls: 'lo' },
            { ts: '',      text: 'I will do it tonight.' },
            { ts: '06:00', text: 'Shift end.' },
          ]
        },
        {
          header: 'SHIFT 31',
          lines: [
            { ts: '22:00', text: 'Handover from day shift. Everything flagged green.' },
            { ts: '01:04', text: 'I have been thinking about the reading from shift 28.' },
            { ts: '',      text: 'I looked up the threshold values in the manual tonight before coming in.' },
            { ts: '',      text: 'The manual says 0.8 mSv is the upper limit for nominal operation.' },
            { ts: '',      text: 'I wrote down 1', cls: 'cut' },
          ]
        },
      ]
    },

    /* ── REZNOV ───────────────────────────────────────────────── */
    reznov: {
      filename: 'REZNOV_OP15.LOG',
      meta:     'OPERATOR: REZNOV — 47 SHIFTS — UNIT 4 / NIGHT ROTATION',
      entries: [
        {
          header: 'SHIFT 1',
          lines: [
            { ts: '22:00', text: 'First shift. Unit 4 fully operational. Clean handover from OP.14.' },
            { ts: '',      text: 'His notes are thorough. He logged more than I would have.', cls: 'hi' },
            { ts: '06:00', text: 'Shift complete. All systems nominal.' },
          ]
        },
        {
          header: 'SHIFT 8',
          lines: [
            { ts: '22:00', text: 'Routine start. Pressure holding. Temperature nominal.' },
            { ts: '01:22', text: 'Minor coolant fluctuation. Self-corrected. No action required.' },
            { ts: '06:00', text: 'Shift complete.' },
          ]
        },
        {
          header: 'SHIFT 14',
          lines: [
            { ts: '22:00', text: 'Routine start.' },
            { ts: '00:30', text: 'Found Kowalski\'s old reports in the cabinet. The ones marked reviewed.', cls: 'hi' },
            { ts: '',      text: 'He was right about the temperature. I have been logging the same drift.' },
            { ts: '',      text: 'Since shift 2. I just did not connect it until now.', cls: 'lo' },
            { ts: '06:00', text: 'Shift complete. Did not file a report.' },
          ]
        },
        {
          header: 'SHIFT 21',
          lines: [
            { ts: '22:00', text: 'Shift start.' },
            { ts: '02:14', text: 'Called down to admin for a meeting. Unusual time for a meeting.', cls: 'lo' },
            { ts: '',      text: 'They said it was routine. Personnel review.' },
            { ts: '',      text: 'I do not remember much of what we discussed.', cls: 'lo' },
            { ts: '06:00', text: 'Shift complete.' },
          ]
        },
        {
          header: 'SHIFT 22',
          lines: [
            { ts: '22:00', text: 'Shift start. Systems nominal.' },
            { ts: '06:00', text: 'Shift complete. No anomalies.' },
          ]
        },
        {
          header: 'SHIFT 30',
          lines: [
            { ts: '22:00', text: 'Shift start. Systems nominal.' },
            { ts: '06:00', text: 'Shift complete. No anomalies.' },
          ]
        },
        {
          header: 'SHIFT 38',
          lines: [
            { ts: '22:00', text: 'Shift start. Systems nominal.' },
            { ts: '06:00', text: 'Shift complete. No anomalies.' },
          ]
        },
        {
          header: 'SHIFT 44',
          lines: [
            { ts: '22:00', text: 'Shift start. Systems nominal.' },
            { ts: '06:00', text: 'Shift complete. No anomalies.' },
          ]
        },
        {
          header: 'SHIFT 47',
          lines: [
            { ts: '22:00', text: 'Shift start. Systems nominal. Handover complete.' },
            { ts: '06:00', text: 'Shift complete. No anomalies.' },
            { ts: '',      text: 'Position vacancy effective end of this shift.', cls: 'lo' },
            { ts: '',      text: 'Next operator has been assigned. File updated.' },
          ]
        },
      ]
    },

    /* ── [DELETED] ────────────────────────────────────────────── */
    deleted: {
      filename: 'OP16_[DELETED].LOG',
      meta:     'OPERATOR: [REDACTED] — [REDACTED] SHIFTS — UNIT 4 / NIGHT ROTATION',
      entries: null,   // rendered differently — metadata only
      metadata: [
        { key: 'FILE',          val: 'OP16_[DELETED].LOG' },
        { key: 'CREATED',       val: '[DATE REDACTED]' },
        { key: 'LAST MODIFIED', val: '[DATE REDACTED]' },
        { key: 'DELETED',       val: 'YEAR 3 / CYCLE 2 / DAY 14',   cls: 'lo' },
        { key: 'AUTHORIZED BY', val: 'FACILITY MANAGEMENT — UNIT 4' },
        { key: 'REASON',        val: 'ADMINISTRATIVE REVIEW' },
        null,   // separator
        { key: 'CONTENT',       val: '[REMOVED]',   cls: 'none' },
        { key: 'RECORDS TRANSFERRED TO', val: '[REMOVED]', cls: 'none' },
        { key: 'BACKUP EXISTS', val: 'NO',           cls: 'none' },
        null,
        {
          note: true,
          label: '// NOTE — FROM OP.15 LOG — DAY FOLLOWING DELETION:',
          ts: '02:31',
          msg: 'New arrangement has been implemented.'
        }
      ]
    },

  }

  /* ── Render helpers ──────────────────────────────────────────── */
  function renderLogEntry(entry) {
    var div = document.createElement('div')
    div.className = 'log-entry'

    var hdr = document.createElement('div')
    hdr.className   = 'log-entry-header'
    hdr.textContent = entry.header
    div.appendChild(hdr)

    entry.lines.forEach(function (line) {
      var row = document.createElement('div')
      row.className = 'log-line'

      var ts = document.createElement('span')
      ts.className   = 'log-ts'
      ts.textContent = line.ts || ''

      var txt = document.createElement('span')
      txt.className   = 'log-text' + (line.cls ? ' ' + line.cls : '')
      txt.textContent = line.text

      row.appendChild(ts)
      row.appendChild(txt)
      div.appendChild(row)
    })

    return div
  }

  function renderMetadata(metaArr) {
    var div = document.createElement('div')
    div.className = 'log-meta-block'

    metaArr.forEach(function (item) {
      if (item === null) {
        var sep = document.createElement('div')
        sep.className = 'sep'
        div.appendChild(sep)
        return
      }

      if (item.note) {
        var noteDiv = document.createElement('div')
        noteDiv.className = 'note'
        noteDiv.innerHTML =
          '<span class="ts">' + item.label + '</span><br>' +
          '<span class="ts">' + item.ts    + '</span>' +
          '<span class="msg"> ' + item.msg  + '</span>'
        div.appendChild(noteDiv)
        return
      }

      var row = document.createElement('div')
      var keyCls = 'key'
      var valCls = 'val' + (item.cls === 'lo'   ? ' lo'
                          : item.cls === 'none' ? ' none' : '')
      row.innerHTML =
        '<span class="' + keyCls + '">' + item.key + '</span>' +
        '<span class="' + valCls + '">' + item.val + '</span>'
      div.appendChild(row)
    })

    return div
  }

  /* ── Open ────────────────────────────────────────────────────── */
  function openLogReader(key) {
    var def = LOGS[key]
    if (!def) return

    if (filenameEl) filenameEl.textContent = def.filename
    if (filemetaEl) filemetaEl.textContent = def.meta

    bodyEl.innerHTML = ''

    if (def.entries === null) {
      /* [DELETED] — metadata only */
      bodyEl.appendChild(renderMetadata(def.metadata))
    } else {
      def.entries.forEach(function (entry, idx) {
        var el = renderLogEntry(entry)
        el.style.animationDelay = (idx * 0.06) + 's'
        el.style.animation = 'fadeSlideIn 0.3s ' + (idx * 0.06) + 's both'
        bodyEl.appendChild(el)
      })
    }

    bodyEl.scrollTop  = 0
    overlayEl.style.display = 'flex'
  }

  /* ── Close ───────────────────────────────────────────────────── */
  function closeLogReader() {
    overlayEl.style.display = 'none'
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.openLogReader = openLogReader

  if (closeEl) closeEl.addEventListener('click', closeLogReader)

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') closeLogReader()
  })

})()
