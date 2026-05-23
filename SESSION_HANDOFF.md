# THERMAL — Session Handoff

Drop this file into a new Claude Code session as context. Project root: `C:\Users\Beytullah KALAY\OneDrive\Desktop\THERMAL`. Read `CLAUDE.md` first for architecture.

---

## Where we left off

Plan **`C:\Users\Beytullah KALAY\.claude\plans\vast-pondering-moon.md`** approved.

**Sprint 1 (A — Power → Sensor noise) — DONE**
- `_drift()` resource-aware (tier 1.0/1.6/2.8/4.5 by guc/basinc/sicaklik allocation) [js/game.js _drift]
- `SENSOR_SYS` mapping + `_noiseAmpFor()` + `_precisionTierFor()` helpers
- `systemTick` increments `gameState.lowPrecisionSeconds` + `critPrecisionSeconds` per subsystem
- Gauges: `<span class="precision-badge">` + classes `precision-low`/`precision-crit` → flicker animation
- Pause overlay: `_paintPausePrecision()` populates `#pause-precision-rows` (hidden when all OK)
- Shift-end report: `sensorReliability: { sys: {pct, lowSec, critSec} }`; rendered by `paintReliability` IIFE in `js/shift-end.js`
- 6-lang locale keys: `precision.badge.*`, `precision.reliability`, `shift.report.reliabilityHeader`

**Sprint 2 (B — Anomaly severity dynamic) — DONE**
- `ANOM_TYPES` entries got `targetSys` + `baseSeverity: 1.0`
- `_calcAnomSeverity(targetSys, base)` returns `{ factor, reasons[] }` — compounds gauge warn/crit (×1.3/1.6), valvePenalty on pressure (×1.5), missing freqBonus on temp (×1.2), demand-shift uncovered (×1.4), demand-spike concurrent (×1.2), precision low/crit (×1.15/1.3). Hard-capped at ×3.0.
- Real-anomaly branch in `_anomSpawn`: logs `⚠ ANOMALY — severity ×N (reasons)` + shrinks decide window `max(25000, _B.anomDecide / sev)`
- `gameState.anomalyEvents = []` per spawn `{ ts, sensor, targetSys, severity, reasons, isFake:false, outcome:'pending' }`
- `_setLastAnomalyOutcome(outcome)` called from `_anomDecide` (`correct`/`wrong`) and `_anomEscalate` stage 2 (`escalated`)
- endShift report includes `anomalyEvents`. Shift-end UI: `paintAnomalyHistory` IIFE renders `.anom-row` table with `↳ reasons` sub-row.
- 6-lang keys: `anomalyHistory.*`

**Sprint 3 (D — Viral end screen) — DONE**
- endShift `realState` object: `realAnomalyEvents`, `escalatedEvents`, `calledTotal/correctCalls/wrongCalls/missedAnomalies`, `peakActualRad` (=`_radMax`), `peakReportedRad` (=sensor B radiation), `externalVentCount/externalSv`, `nearbyDistrict + nearbyPopulation` (random pick from 6 cardinal districts), `facilityStatement: 'PENDING'`
- New shift-end panel `#recon-panel` (melancholic; amber title; 2-col grid YOUR REPORT vs ACTUAL STATE; context block; `THERMAL · UNIT 4` watermark; "// WHAT REALLY HAPPENED — SHIFT N" footer). Screenshot-friendly at 1280×720.
- `paintReconstruction` IIFE in shift-end.js
- 6-lang keys: `recon.*`

## Next up — Faz 2 (deferred from approved plan)

**C — Demand-shift cross-system penalty** (NOT STARTED). Plan idea: when demand-shift is uncovered, also degrade dispatch info quality and add sensor noise to non-target sectors as collateral. Hook into `_demandShift` state and `_isMiniGameActive`/dispatch info renderer.

**E — News continuity** (NOT STARTED). Add `lastShiftDecisions` save field (`missedAnomalies, falseAlarms, ventCount, peakRad, workerDeaths`). Hook into `buildNewsPanel` IIFE in `screens/home-terminal.html` to inject deniable articles based on those values (e.g., `missedAnomalies > 2` → "regional patient cluster reported in {loc}").

**F (family messages)** — DELIBERATELY SKIPPED per user decision.

## Conventions (don't break)

- All UI strings: `data-i18n="key"` (HTML) or `window.i18n.t('key', vars?)` (JS). Locales in `/locales/{en,tr,zh-Hans,ru,de,ja}.json`. **Add to ALL 6** whenever you add a key.
- `i18n.setLang(code)` dispatches `thermal-lang-changed` event — re-render JS-set dynamic strings on receipt.
- Save: `saveSystem.loadGame()` / `updateShift()` / `writeAutosave()`. Save versioned via `SAVE_VERSION` + `_MIGRATIONS`.
- Achievements: `window.achievements.unlock('ACH_*')` — registered IDs in `js/achievements.js`. Graceful without Greenworks.
- Timers in game.js use monkey-patched `setTimeout/setInterval` (pause-aware); use captured `_origST` / `_origSI` for navigation/watchdog that must fire regardless of pause.
- `_spawnMs(realMs)` divides by `_gcSpeed` — use for any sub-system spawn delay so 4× actually feels 4× faster.
- ER scheduler in `js/error-system.js` — gated by `_isMiniGameActive()` and `_isShiftBlocked()`.

## Quick syntax check command

```
node -c js/game.js && node -c js/shift-end.js && node -e "for (const c of ['en','tr','zh-Hans','ru','de','ja']) JSON.parse(require('fs').readFileSync('locales/'+c+'.json'))" && echo OK
```

## Key reference files

| File | Role |
|---|---|
| `CLAUDE.md` | Repo-level architecture brief |
| `js/game.js` | Main game loop, anomaly spawn, sensor drift, endShift |
| `js/shift-end.js` | Shift-end render (perf panel, atmospheric, anomaly history, recon) |
| `js/i18n.js` | Translation core + DOM auto-apply |
| `js/achievements.js` | Greenworks wrapper + 14 ACH definitions |
| `js/saveSystem.js` | Persistence (save versioning, autosave, predecessor) |
| `js/error-system.js` | ER mechanic (combo lock, scheduler, log integration) |
| `screens/game.html` | Main shift UI + all overlays |
| `screens/shift-end.html` | 3 panels: perf, atmospheric (+reliability +anomaly history), recon |
| `config/error-codes.json` | 15 ER codes with truthful/lying prescriptions |
| `locales/*.json` | 6-language UI strings |
| `MARKETING_PLAN.md` / `PRESSKIT.md` / `STEAM_DESCRIPTION.md` / `CAPSULE_AI_PROMPTS.md` | Launch assets |
| `TRANSLATION_HANDOFF.md` | What's still EN-only (narrative) + contractor brief |

## Open todos at handoff

All 3 sprints from the approved plan are complete + syntax-clean. **Next concrete step:** start Faz 2 / C (demand-shift cross penalty) OR E (news continuity). Each is ~2-4h of focused work.

Manual test still pending from user side (Sprints 1+2+3 wired but not yet playtested end-to-end at user). Bug fixes may surface — check chat history briefly for any "şu da çalışmıyor" notes that postdate the last syntax check.
