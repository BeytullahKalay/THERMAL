# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

```
npm start          # launches Electron (electron .)
```

No build step, no bundler. All JS runs directly in Electron with `nodeIntegration: true` and `contextIsolation: false`. Entry point is `screens/boot.html`.

## Architecture

THERMAL is a single-window Electron game. Every screen is a standalone `.html` file in `screens/` that navigates to the next via `window.location.href`. There is no router, no framework, no module system.

### Screen flow

```
boot.html → menu.html → game.html → shift-end.html → home-terminal.html → game.html (loop)
                                                    ↘ death.html → menu.html
```

- `main.js` creates the BrowserWindow, strips the native menu, and exposes two IPC handles (`get-display-info`, `apply-settings`) for the resolution settings panel.
- All screen transitions use a shared `crtOff` CSS animation (collapse to horizontal line → black) followed by a `setTimeout(..., 620)` redirect.

### JS files in `js/`

| File | Purpose |
|---|---|
| `saveSystem.js` | Central persistence via `localStorage` key `thermalSave`. Exposes `window.saveSystem` with `loadGame / saveGame / resetGame / updateShift / calcShiftPay`. Every screen loads this first. |
| `game.js` | All gameplay logic: sensor simulation, anomaly system, CRM mini-game, valve sequencing, demand shift events, difficulty scaling, debug panel (F1). Calls `endShift()` at 06:00 or 4 s after meltdown. |
| `shift-end.js` | Reads `thermalShiftReport` from localStorage, populates the report screen, wires NEXT SHIFT / MAIN MENU buttons. |
| `messaging.js` | Elena's post-shift conversation in home-terminal's MESSAGES tab. Reads/writes `thermalMsgDecision` for per-shift persistence. |
| `menu.js` | Three-case menu logic: `fresh` (no save) / `continue` (save, not gameOver) / `ended` (gameOver). |
| `boot.js` | Boot animation percentage counter + keypress handler to advance to menu. |

### Persistence (localStorage keys)

| Key | Written by | Read by |
|---|---|---|
| `thermalSave` | `saveSystem.js` | everywhere |
| `thermalShiftReport` | `game.js` `endShift()` | `shift-end.js`, `home-terminal.html` |
| `thermalShiftNumber` | `game.js`, `shift-end.js` | `game.js` boot (legacy sync) |
| `thermalMsgDecision` | `messaging.js` | `messaging.js` (re-read guard) |

### Save object shape (`thermalSave`)

```js
{
  shiftNumber, totalMoney, targetMoney,   // 2400 = win condition
  shiftsWithoutRent,                      // ≥3 → street death on sleep
  evicted, gracePeriod,
  lastShiftRadiation, lastShiftMoneySent,
  elenaToneLevel,                         // 0 warm → 3 hostile
  gameOver, gameOverReason                // 'meltdown' | 'street' | 'win'
}
```

### Game-over paths

- **Meltdown**: any system stays critical 120 s → `gameState.meltdownOccurred = true` → `endShift()` after 4 s delay → `saveSystem.updateShift()` sets `gameOver: true, gameOverReason: 'meltdown'`
- **Street death**: `shiftsWithoutRent >= 3` at sleep time → `home-terminal.html` writes the report and navigates to `death.html`
- **Win**: `totalMoney >= targetMoney` (2400) detected inside `updateShift()`

Both meltdown and street death hide the `[ NEXT SHIFT ]` button on `shift-end.html`, leaving only `[ MAIN MENU ]`. Menu then shows CASE 3 (new game only).

## Visual system (CRT aesthetic)

Every screen shares the same CSS variables and effects. Do not deviate from these:

```css
--phosphor: #a8ff3e    /* primary text */
--phosphor-dim: #4a7a1a
--amber: #ffb830       /* warnings */
--red-alert: #ff3a3a   /* critical / game-over */
--bg: #080a04
--panel-bg: #0b0f05
--border: #1e2e0c
```

- Fonts: `VT323` (titles, large readouts), `Share Tech Mono` (body text)
- Every page has: scanlines (`body::before`), vignette (`body::after`), `powerOn` animation on `.terminal`, `flicker` ambient animation, `crtOff` on exit
- `#6a9a2a` is used specifically for Elena's sender label in messaging

## Debug panel (game.html, F1)

- `[ SKIP TO 05:58 ]` — advances game clock to near-end
- `[ END: EXEMPLARY / SATISFACTORY / MARGINAL / UNSATISFACTORY / MELTDOWN / STREET DEATH ]` — force-ends the shift with preset stats; all marked `// TEST ONLY — REMOVE BEFORE RELEASE`
