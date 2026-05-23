# THERMAL — Translation Handoff

## Status

✅ **UI labels (~70 strings)** localised to 6 languages: EN, TR, ZH-Hans, RU, DE, JA.
   Settings, menu items, pause overlay, action bar, demo-end, credits.

❌ **Narrative content (~16,000 words)** still hardcoded in English. Listed below per file. This is where THERMAL's identity lives and where it needs PROFESSIONAL translation (not AI) for non-English players to actually feel the game.

---

## What's localised today (`locales/*.json`)

Roughly the strings a player sees in their first 5 minutes WITHOUT entering a shift:
splash, menu items, settings overlay, pause overlay, demo-end screen, credits, controls labels, language picker, rebind modal, ER panel hint, manual footer, files badges, orientation tips, adaptive hints, achievements toast.

The active language is selected in **Settings → LANGUAGE** and persists in `localStorage.thermalLang`. The `data-i18n="key"` attribute system auto-translates on every page load.

---

## What still needs translating (per file)

### 1. `js/log-reader.js` (~3,000 words)
- **BRIEFING_OP18.LOG** — 25-line orientation memo (full narrative)
- **OP17_HANDOVER.LOG** — predecessor's handover note
- **OP18_NOTE.LOG** — player's self-authored discovery log (auto-spawns)
- **KOWALSKI_OP14.LOG** — 7 shift entries, each with timestamped lines, classifications (hi/lo/cut)
- **REZNOV_OP15.LOG** — 8 shift entries
- **OP16_[DELETED].LOG** — metadata + 3 recovered margin-note fragments
- **PREVIOUS_OP_FINAL.LOG** — built dynamically from save data (template strings)

**Strategy:** Move each `lines: [{ ts, text, cls }]` array's `text` field through a `t()` key. Suggested namespace: `log.kowalski.s12.l1`, `log.reznov.s8.l3` etc.

### 2. `js/messaging.js` (~2,000 words)
Elena's full conversation tree across shifts. Decision branches (send_all / send_what / keep_some / no_send), 4 tone levels (warm → hostile), per-shift contextual variants.

**Strategy:** Each dialogue node lives in a key like `elena.s3.tone0.send_all` → an array of message strings.

### 3. `js/game.js` (~1,500 words)
- ~150 calls to `_lsAdd(msg, category)` for anomaly logs, CRM events, valve sequences, dispatch outcomes, demand shifts, ER fires
- Dispatch SCRIPTS object — 8+ event scripts with prompts and response choices
- ER bonus / fixed messages
- Demand-spike notifications
- Shift-start entries / phase transition logs (23:00, 03:00, 05:00)

**Strategy:** Wrap `_lsAdd(t('key'), 'category')`. Dispatch SCRIPTS: replace strings with keys, lookup at render time.

### 4. `screens/home-terminal.html` (~2,500 words)
- News article pools: `FILLER_POOL`, `makeMinorPool()`, `makeModeratePool()`, `makeSeverePool()`, vent-tier articles, OP17 fate article, manual revision article
- News reader overlay text
- Bank panel labels
- Housing badge messages
- Messages tab UI
- Sleep transition lines (`// 06:14 / ARRIVING HOME / // CHECKING MAIL.`)
- Going-home interstitial

**Strategy:** Keep procedural variation but key each template. News pools have placeholders like `{n}`, `{loc}` — i18n.js already supports `{var}` interpolation.

### 5. `screens/manual.html` (~2,500 words)
6 sections of game manual text. Headers, paragraphs, step lists, footers. The INTERFACE & CONTROLS section also has static UI replica labels.

**Strategy:** Bulk refactor — wrap each `<div class="para">...</div>` with `data-i18n` or move text wholesale to locale.

### 6. `config/error-codes.json` (~1,500 words)
- 15 codes × `title` field (e.g. "COOLANT LOOP PHASE DRIFT")
- 15 codes × `manualText` field (prescription prose)
- 3 codes × `logCitation` field (e.g. "KOWALSKI / SHIFT 12 / OP.14")

**Strategy:** Move `title`, `manualText`, `logCitation` into locales under `er.ER-3505.title`, `er.ER-3505.manualText`. Manual overlay reads via `i18n.t()`.

### 7. `screens/shift-end.html` + `js/shift-end.js` (~400 words)
Score readout labels, RANK calculations, exemplary/satisfactory/marginal/unsatisfactory copy, going-home transition text.

### 8. `screens/death.html` + `screens/boot.html` + `screens/splash.html` (~600 words)
Death screen variants, boot log lines (BIOS messages), splash byline.

---

## Recommended Translation Workflow

### Option A — Premium ($1,400-2,500 / language)
1. Hire a game-specialised translator per language (Fiverr Pro, OneSky, LocalizeDirect)
2. Export all narrative as a single CSV/XLSX with key + EN source columns
3. Pay per word; turnaround 1-3 weeks per language
4. **Total cost for 5 paid languages (TR free): ~$10,000**

### Option B — Hybrid AI + Native Proofread ($200-400 / language) — RECOMMENDED
1. Use GPT-4 / Claude / DeepL Pro for first-pass translation
2. Hire a single native speaker per language on Upwork ($15-30/hr) for proofreading
3. They fix machine errors, idioms, register, and game-specific tone
4. **Total cost: ~$1,000-2,000 for 5 paid languages**
5. Risk: AI mistranslations for narrative (e.g. "the chair was empty" idioms break in CN/JA)

### Option C — Community ($0)
1. Ship in EN + TR only at launch
2. Open a Discord channel + Steam community thread "Help translate THERMAL"
3. Native-speaker fans translate the locale JSON files
4. Credit them in CREDITS section
5. Quality varies; takes 3-6 months post-launch

---

## Refactor Cost Estimate (engineering, not translation)

| Task | Hours |
|---|---|
| log-reader.js bulk key refactor | 4-6 |
| messaging.js (Elena dialogue tree) | 3-4 |
| game.js anomaly/dispatch log strings | 4-6 |
| home-terminal.html news pools | 3-5 |
| manual.html static content | 2-3 |
| error-codes.json key migration | 2-3 |
| shift-end / death / boot / splash | 1-2 |
| **TOTAL refactor** | **~20-30 hours** |

After refactor is done, adding any new language is just adding a new `locales/<code>.json` file. No code changes needed.

---

## Font Compatibility Note

| Lang | VT323 / Share Tech Mono | Fallback needed? |
|---|---|---|
| EN, TR, DE | ✓ | No |
| RU | ✓ (both fonts ship Cyrillic) | No |
| ZH-Hans | ✗ | **Noto Sans CJK SC** (free, open) |
| JA | ✗ | **Noto Sans CJK JP** (free, open) |

For CJK languages, you need to:
1. Download Noto Sans CJK from Google Fonts (or bundle TC subset)
2. Add a `@font-face` declaration in each screen's CSS
3. Adjust `font-family` cascade: `'VT323', 'Noto Sans CJK SC', monospace`

The CJK font has no terminal/CRT aesthetic, but the player gets readable text — far better than tofu boxes. Test JA/ZH builds; if visual feel breaks, source a phosphor-style bitmap CJK font.

---

## Next Concrete Step

1. Build the bulk-refactor script that:
   - Walks log-reader.js + messaging.js + game.js + home-terminal.html
   - Extracts every quoted string into `locales/en.json`
   - Generates auto-keys like `auto.kowalski.s12.l3`
   - Replaces source with `t('auto.kowalski.s12.l3')` calls
2. Run that script → ~2,000 new keys appear in `en.json`
3. Hand the new EN keys to your translator(s) → they fill the 5 other JSONs
4. Drop the translated JSONs in `locales/` → game speaks 6 languages, fully.

I can write that bulk-refactor script when you give the green light — separate session, ~3-4 hours of work, produces ~20,000 lines of mechanical refactor.

---

## TL;DR

- ✅ Game speaks 6 languages **at the UI level today**. Try it: Settings → LANGUAGE → 简体中文 → menu, settings, pause, demo-end all switch.
- ⏳ The other ~16,000 words of narrative are still EN-only. They need a 20-30 hour engineering refactor + a translation contract.
- Recommend: **Option B hybrid (AI + native proofread)**, ~$1,500 total, 3-4 weeks per language with overlapping freelancers.
