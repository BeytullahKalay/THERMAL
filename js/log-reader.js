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

    /* ── BRIEFING (always open — orients the new operator) ─────── */
    briefing: {
      filename: 'BRIEFING_OP18.LOG',
      meta:     'FROM: FACILITY MANAGEMENT — TO: OP.18 (NEW HIRE) — UNIT 4 / NIGHT ROTATION',
      entries: [
        {
          header: 'WELCOME — UNIT 4 NIGHT ROTATION',
          lines: [
            { ts: '', text: 'Operator,' },
            { ts: '', text: 'You have been assigned the night rotation on Unit 4. Read this briefing in full before your first shift.' },
            { ts: '', text: '' },
            { ts: '', text: '// SHIFT BASICS', cls: 'hi' },
            { ts: '', text: 'Shift runs 22:00 → 06:00. Three reactor systems must be kept inside their safe envelopes: TEMPERATURE, PRESSURE, POWER.' },
            { ts: '', text: 'Each system has 0–10 resource units; total resources are fixed — raising one drops another. Allocate carefully.' },
            { ts: '', text: 'A system that stays CRITICAL for 120 cumulative seconds will trigger meltdown and end the shift.' },
            { ts: '', text: '' },
            { ts: '', text: '// ERROR CODES (ER-XXXX)', cls: 'hi' },
            { ts: '', text: 'Unit 4 emits cryptic 4-digit error codes when a subsystem destabilizes. The reactor degrades faster while one is unresolved — work fast.' },
            { ts: '', text: 'Each code has a prescribed fix: a POWER value, a PRESSURE value, a VALVE click sequence, and a SURVEY tone sequence. All four must hold simultaneously to clear the code.' },
            { ts: '', text: 'Look up the prescription in the PROCEDURE MANUAL — press [{KEY:manual}] at any time to open it. The manual is also accessible from this terminal between shifts.', cls: 'hi' },
            { ts: '', text: '' },
            { ts: '', text: '// ON THE MANUAL', cls: 'lo' },
            { ts: '', text: 'A note from the previous operators: the procedure manual was last revised in 2018. Some prescriptions have not aged well.', cls: 'lo' },
            { ts: '', text: 'If a fix sequence makes a system worse instead of better, abort it. Do NOT keep applying a procedure that is clearly wrong.', cls: 'hi' },
            { ts: '', text: 'Cross-reference the operator log archive in the FILES tab when you suspect a discrepancy. The previous operators logged the corrections they discovered.' },
            { ts: '', text: '' },
            { ts: '', text: '// OTHER DUTIES', cls: 'hi' },
            { ts: '', text: 'You will receive periodic radio calls from field maintenance crews (DISPATCH). Keep their dose exposure low — workers do die out there.' },
            { ts: '', text: 'You will be paid per shift based on safe operation. Shift pay covers rent at home; missing rent for three shifts means eviction. Eviction means street.' },
            { ts: '', text: '' },
            { ts: '', text: '// CONTROLS', cls: 'hi' },
            { ts: '', text: '[{KEY:manual}]   open Procedure Manual' },
            { ts: '', text: '[{KEY:pause}] pause' },
            { ts: '', text: '[{KEY:speed1}]/[{KEY:speed2}]/[{KEY:speed3}]  game speed' },
            { ts: '', text: '' },
            { ts: '', text: 'Good luck. Try not to think about why this position keeps opening up.', cls: 'lo' },
            { ts: '', text: '— Personnel Office, Unit 4', cls: 'lo' },
          ]
        }
      ]
    },

    /* ── OP18 SELF-NOTE (auto-revealed after all 3 lies are discovered)
       This is "you" writing back to the chain of operators. Appears
       in FILES once thermalDecryptedFiles contains all of kowalski,
       reznov, and deleted. Players who never decrypt all three never
       see it — it's a payoff for completing the discovery loop. */
    op18note: {
      filename: 'OP18_NOTE.LOG',
      meta:     'OPERATOR: OP.18 (you) — PERSONAL — NOT FILED',
      entries: [
        {
          header: 'PERSONAL NOTE',
          lines: [
            { ts: '', text: 'Whoever reads this,' },
            { ts: '', text: '' },
            { ts: '', text: 'I have now read OP.14, OP.15, and what is left of OP.16.' },
            { ts: '', text: 'They were right. The manual is wrong about ER-3505, ER-7782, and ER-9031. Three out of ten. Always those three.', cls: 'hi' },
            { ts: '', text: 'I do not think anyone is going to fix the manual. I do not think anyone is going to be allowed to fix the manual.' },
            { ts: '', text: '' },
            { ts: '', text: 'I have written my own corrections in the margin of my copy. They will go with me when I leave.', cls: 'lo' },
            { ts: '', text: 'I am writing this so the next person knows: the chair is the same chair, the manual is the same manual, the procedure office is the same procedure office. The only thing that has changed is the operator.' },
            { ts: '', text: '' },
            { ts: '', text: 'Look at KOWALSKI shift 12. Look at REZNOV shift 8. The fragment from OP.16 is in the deleted file — they did not get all of it.', cls: 'hi' },
            { ts: '', text: 'Trust the operators. Do not trust the book.', cls: 'hi' },
            { ts: '', text: '' },
            { ts: '', text: 'If you are reading this, I am gone, or I will be soon. Either way, the chair is yours now.', cls: 'lo' },
            { ts: '', text: '— OP.18', cls: 'lo' },
          ]
        }
      ]
    },

    /* ── OP17 HANDOVER (always open — your immediate predecessor) ── */
    op17: {
      filename: 'OP17_HANDOVER.LOG',
      meta:     'FROM: OP.17 — TO: OP.18 — HANDOVER NOTE — UNIT 4 / NIGHT ROTATION',
      entries: [
        {
          header: 'HANDOVER',
          lines: [
            { ts: '', text: 'OP.18,' },
            { ts: '', text: 'I do not know you, but you are inheriting my chair. A few things they will not tell you in the briefing.' },
            { ts: '', text: '' },
            { ts: '', text: 'The error codes are coming faster than they used to. I logged at most one per shift in my first month. By my last month it was three or four. Be ready.', cls: 'lo' },
            { ts: '', text: '' },
            { ts: '', text: 'The procedure manual is correct for most codes. It is not correct for all of them. I am not going to tell you which ones — figure it out, or you will not learn how to spot the next one.', cls: 'hi' },
            { ts: '', text: 'When you suspect the manual, look at the operator log cabinet. KOWALSKI (OP.14) and REZNOV (OP.15) wrote down what worked. Their files are encrypted; the encryption is weak.' },
            { ts: '', text: 'There is also an OP.16 file. It has been deleted. Do not ask why. Look at it anyway.', cls: 'lo' },
            { ts: '', text: '' },
            { ts: '', text: 'A few personal notes:' },
            { ts: '', text: '— The radiation meter on B-rack drifts upward at night. It is not real drift, but the trend can hide a real spike. Watch the second decimal.' },
            { ts: '', text: '— Workers on dispatch will lie to you about their dose. Round up.' },
            { ts: '', text: '— Whatever you do, do not stay past 06:00. The shift end is the only thing in this building that comes on time.' },
            { ts: '', text: '' },
            { ts: '', text: 'I am leaving the rotation. I am told it is voluntary.', cls: 'lo' },
            { ts: '', text: '— OP.17', cls: 'lo' },
          ]
        }
      ]
    },

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
            { ts: '01:30', text: 'ER-3505 fired again. Manual prescribes ascending valve cycle: V1, V2, V3, V4.', cls: 'lo' },
            { ts: '',      text: 'Tried it. Loop got worse. Margin closing fast.' },
            { ts: '',      text: 'Reversed on instinct. V4 first, then V3, V1, V2. Loop steadied in seconds.', cls: 'hi' },
            { ts: '',      text: 'Sealed it with the tone pair backwards too — C4 then A1. Manual says A1 then C4.', cls: 'hi' },
            { ts: '',      text: 'Held POWER at 3, PRESSURE at 1 like the book says. Those numbers were correct at least.' },
            { ts: '02:20', text: 'Filed written complaint. Manual is wrong on the sequence. Kept a copy.' },
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
            { ts: '00:55', text: 'Bus harmonic alarm — ER-7782. Manual prescribes raising POWER to 8 to overcome.', cls: 'lo' },
            { ts: '',      text: 'Tried it. Generator started shaking inside thirty seconds. Almost scrammed.' },
            { ts: '',      text: 'Killed allocation down to 2 instead. Vented V3 → V2 → V4. Held PRESSURE at 5.', cls: 'hi' },
            { ts: '',      text: 'Survey panel: double-strike D3. Cleared in eleven seconds.', cls: 'hi' },
            { ts: '',      text: 'The manual would have killed me. Power 8 is the worst possible answer.' },
            { ts: '03:40', text: 'Wrote a procedure revision request. Filed it before logging off.' },
            { ts: '06:00', text: 'Shift complete. Awaiting response.' },
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
        },
        null,
        {
          note: true,
          label: '// FRAGMENT — RECOVERED FROM DISK SLACK / SECTOR 0x7C:',
          ts: '— —',
          msg: '...containment seal resonance keeps coming back. Manual says drop PRESSURE to 3 — that cracks it wider. Held at 7. Valves V4 → V4 → V2, alternate works only if you double-open V4. Single C4 pulse on the survey panel locks it. POWER stays at 5. Took twenty seconds last shift...'
        },
        null,
        {
          note: true,
          label: '// MARGIN NOTE — KOWALSKI LOG, SHIFT 27 (UNRELATED ENTRY):',
          ts: '04:08',
          msg: 'Briefly spoke with OP.16 in the corridor before he started. Told him to ignore the manual on ER-9031. He laughed. He has not been here long enough to know it isn’t funny.'
        }
      ]
    },

  }

  /* ── Build the predecessor entry dynamically from saved record.
        Returns a log definition or null if no predecessor exists.
        Lives outside LOGS because it depends on saveSystem (loaded
        AFTER log-reader on home-terminal — but openLogReader is the
        only consumer and runs at click time, so saveSystem is ready). */
  function _buildPredecessorLog() {
    if (!(window.saveSystem && window.saveSystem.loadPredecessorLog)) return null
    var p = window.saveSystem.loadPredecessorLog()
    if (!p) return null

    var reasonText = ({
      meltdown: 'CONTAINMENT FAILURE — REACTOR MELTDOWN — UNIT 4',
      street:   'EVICTION — DEATH OF EXPOSURE',
      win:      'EMPLOYMENT TERMINATED — DEBT SETTLED',
      unknown:  'STATUS UNKNOWN — RECORD INCOMPLETE'
    })[p.gameOverReason] || 'STATUS UNKNOWN'

    var ln = []
    ln.push({ ts: '', text: 'Recovered fragment from terminal cache. Author did not return for the next shift.', cls: 'lo' })
    ln.push({ ts: '', text: '' })
    ln.push({ ts: '', text: '// FINAL TALLY', cls: 'hi' })
    ln.push({ ts: '', text: 'Shifts completed:        ' + (p.shiftsCompleted || 0) })
    ln.push({ ts: '', text: 'Money earned:            $' + (p.totalMoney || 0) + ' / $' + (p.targetMoney || 2400) })
    ln.push({ ts: '', text: 'Casualties on dispatch:  ' + (p.casualties || 0) })
    ln.push({ ts: '', text: 'Final radiation:         ' + (p.finalRadiation != null ? p.finalRadiation.toFixed(2) : '—') + ' mSv' })
    ln.push({ ts: '', text: 'Total critical seconds:  ' + (p.totalCritSeconds || 0) + 's' })
    ln.push({ ts: '', text: '' })
    ln.push({ ts: '', text: '// CAUSE OF VACANCY', cls: 'hi' })
    ln.push({ ts: '', text: reasonText, cls: 'lo' })
    if (p.streetDeathDesc) ln.push({ ts: '', text: p.streetDeathDesc, cls: 'lo' })
    ln.push({ ts: '', text: '' })

    if (p.discoveredAll) {
      ln.push({ ts: '', text: '// AUTHOR\'S MARGIN', cls: 'hi' })
      ln.push({ ts: '', text: 'They knew. They decrypted KOWALSKI, REZNOV, and what was left of OP.16. They left a note for whoever came next.', cls: 'hi' })
      ln.push({ ts: '', text: 'They left it for you.' })
    } else {
      ln.push({ ts: '', text: '// AUTHOR\'S MARGIN', cls: 'hi' })
      ln.push({ ts: '', text: 'They did not decrypt the operator log cabinet. They went without learning what the operators before them knew.', cls: 'lo' })
      ln.push({ ts: '', text: 'You should not make the same mistake.' })
    }
    ln.push({ ts: '', text: '' })
    ln.push({ ts: '', text: '— PREVIOUS OPERATOR (DESIGNATION REDACTED)', cls: 'lo' })

    return {
      filename: 'PREVIOUS_OP_FINAL.LOG',
      meta:     'OPERATOR: [PREVIOUS] — RECOVERED FROM TERMINAL CACHE — NOT AUTHORIZED',
      entries: [{ header: 'FINAL SHIFT — RECOVERED', lines: ln }]
    }
  }

  /* ── Render helpers ──────────────────────────────────────────── */
  /* Replace {KEY:action} tokens with the current bound key label.
     Used so BRIEFING text and any future log copy can reference
     hotkeys without hardcoding [H] etc. */
  function _subKeys(text) {
    if (!text || text.indexOf('{KEY:') === -1) return text
    return text.replace(/\{KEY:([a-zA-Z0-9_]+)\}/g, function (_, action) {
      return (window.keybinds && window.keybinds.label) ? window.keybinds.label(action) : action.toUpperCase()
    })
  }

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
      txt.textContent = _subKeys(line.text)

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
    /* Predecessor log is built dynamically from saved record. */
    if (key === 'predecessor') {
      var pdef = _buildPredecessorLog()
      if (pdef) { LOGS.predecessor = pdef }
    }
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
