# THERMAL — Project Context

## What this is
A short horror game (~2 hours playtime) built in Electron 
(HTML/CSS/JavaScript, no frameworks). Targeting Steam release.
Solo developer project. Casual pricing, short runtime, 
designed for replay.

## Core concept
Player is a night shift operator at an aging nuclear facility.
Manages three systems (TEMPERATURE, PRESSURE, POWER) via a 
control panel while monitoring a log feed, two sensor panels, 
and two mini-games.

The horror mechanic: contradictions between what the log says 
and what sensors show. Which do you trust?

The moral mechanic: reactor equipment is unreliable. Sometimes 
the only way to complete a shift cleanly is to release radiation 
into the environment. Player's performance determines pay. Pay 
goes to family overseas — daughter Mira needs expensive medicine.
Player must balance self-preservation, family needs, and 
environmental consequences.

## Tech stack
- Electron
- Pure HTML/CSS/JavaScript — no React/Vue/jQuery
- Each screen is a self-contained HTML file
- Save state via localStorage (js/saveSystem.js)
- No audio yet

## Visual style (strict)
- Background: #080a04
- Phosphor green: #a8ff3e (bright), #4a7a1a (dim), 
  #6a9a2a (body text)
- Amber warning: #ffb830
- Red alert: #ff3a3a
- Fonts: VT323 (titles/values), Share Tech Mono (body)
- CRT effects throughout: scanlines, vignette, flicker, 
  power on/off transitions
- Aesthetic: 1980s Soviet nuclear facility terminal

## Project structure
thermal/
├── main.js
├── package.json
├── screens/
│   ├── boot.html          — BIOS boot sequence
│   ├── menu.html          — main menu
│   ├── game.html          — main gameplay screen
│   ├── shift-end.html     — end of shift report
│   └── home-terminal.html — post-shift home screen
├── js/
│   └── saveSystem.js      — localStorage persistence
└── assets/

## Screen flow
boot → menu → game → shift-end → home-terminal → game (next shift)
If player dies (meltdown or street death): → menu with gameOver state

## Game screen layout (game.html)
Three-column main area:
- LEFT (280px): control panel — 3 gauges + resource distribution
- CENTER (flex): log feed — scrollable, auto-scroll with pause
- RIGHT (280px): sensor panels (Sensor A, Sensor B)

Bottom bar (180px):
- LEFT (60%): mini-games — CRM + Valves, always visible
- RIGHT (40%): debug panel (F1 toggle, will be removed before release)

## Systems implemented and working

### Resource distribution
- 10 total units split across TEMPERATURE, PRESSURE, POWER
- +/- buttons (never disabled, even in critical state)
- Updates every second via systemTick()

### Deterioration (balanced)
Starting values: TEMP 65°C, PRESS 52%, POWER 72%
Zero-resource rates: TEMP +0.2/s, PRESS +0.15/s, POWER -0.1/s
Resource formula: ≤3 linear lerp to 0.05; >3 improvement at 0.06/s
Difficulty scaling: 0.4x → 0.7x → 1.0x → 1.4x → 1.8x by time
systemFailure triggers after 120s consecutive critical

### Log feed
- Game clock: 22:00 start, 1 real sec = 1 game min
- Shift ends at 06:00 (~480 real seconds)
- Routine entries every 15-25s from curated English pool
- Warning/critical/anomaly entries auto-generated
- Scrollable with pause detection
- addLogEntry(message, category) global function

### Sensor panels
- Sensor A: SOĞUTMA ODASI — SICAKLIK, AKIŞ HIZI, VALF DURUMU
  (note: labels may be in English now — check current state)
- Sensor B: REAKTÖR ODASI — ÇEKIRDEK ISISI, RADYASYON, BASINÇ
- triggerAnomaly(sensorId, valueKey, type) 
- resolveAnomaly(sensorId, valueKey)
- Glitch effect, shake animation, color state changes

### Radiation
- Passive increase: +0.02 mSv every 30 seconds
- Player CANNOT interact with it
- No log entries about radiation
- Color shifts at 2.0 and 3.0 mSv
- No warning text explaining what it does
- This is intentional — story-level consequence later

### Anomaly system
- Types 1-4: value/state/physics/cross conflicts
- 40% LOG_CLUE type: clue planted 60-90s before in log
  (routine-looking entry that reveals false alarm)
- 60% real anomalies (ANOMALI REPORT correct)
- 90 second decision window
- Escalation if ignored
- Spawn rate increases through the shift

### Coolant Resonance Monitor (CRM)
- Formerly "Frequency Monitor" — renamed
- Rectangular oscilloscope with rotary knobs
- FREQ (0.5-5.0 Hz) and AMP (0.1-2.0 V) via SVG rotary knobs
- Continuous drift on target values (speed scales with time)
- IDLE mode: always visible, player can tune freely
- ACTIVE mode: 60s calibration window
- Penalty system (threshold 95% sync):
  - 15s below 95%: TEMPERATURE deterioration +20%
  - 90s below 95%: anomaly trigger
  - 120s below 95%: permanent shift damage
- Above 95%: freqBonus = true, reduces TEMP deterioration

### Pressure Valve Sequencing
- 4 valves (V1-V4), OPEN/CLOSED states
- Log provides sequence, player clicks in order
- 60% log correct, 40% log wrong (horror mechanic)
- Wrong sequence frequency scales with time:
  20% early → 40% mid → 60% late
- 45s timer
- Success: PRESSURE paused 45s, valveBonus = true
- Failure: PRESSURE +25% for 60s
- Idle: valves toggle autonomously every 40-60s

### Demand shift events
- Once per shift, one of three types spawns:
  - Type A (Thermal): 23:00-00:00, TEMP needs 5+ for 2h
  - Type B (Pressure): 00:00-01:00, PRESS needs 5+ for 2.5h
  - Type C (Power): 01:00-02:00, POWER needs 5+ for 2h
- Log entry announces event
- Affected system shows "▲ HIGH DEMAND" indicator
- Player not forced to reallocate — their choice

### Shift end screen
- Triggered at 06:00
- Performance rating: 
  EXEMPLARY / SATISFACTORY / MARGINAL / UNSATISFACTORY / CRITICAL FAILURE
- Environmental telemetry: ASCII bar chart of radiation over time
- Incident classification based on final radiation
- Money calculation based on radiation:
  <1.5 mSv: 400, 1.5-2.5: 300, 2.5-3.5: 200, >3.5: 100
  Meltdown: 0

### Save system (js/saveSystem.js)
```javascript
{
  shiftNumber: 1,
  totalMoney: 0,
  targetMoney: 2400,
  shiftsWithoutRent: 0,
  evicted: false,
  gracePeriod: false,
  lastShiftRadiation: 0,
  lastShiftMoneySent: 0,
  elenaToneLevel: 0,  // 0=warm, 1=neutral, 2=cold, 3=hostile
  gameOver: false,
  gameOverReason: null  // 'win', 'meltdown', 'street'
}
```

Functions: saveGame, loadGame, resetGame, updateShift, getDefault

### Main menu logic
- No save: shows only "NEW GAME"
- Active save: shows "CONTINUE — SHIFT [N]" + "NEW GAME" (with confirmation)
- Game over save: shows only "NEW GAME"
- Displays current shift and money progress
- Records and Operator File items locked until later shifts

### Debug panel (F1)
Shows all game state in real time.
Includes "FORCE SHIFT END" buttons for testing:
EXEMPLARY / SATISFACTORY / MARGINAL / UNSATISFACTORY / MELTDOWN / STREET DEATH
Must be removed before release.

### Home terminal (complete)
- Three tabs: MESSAGES, NEWS, BANK
- Sleep button unlocks after all tabs visited AND Elena decision made
- MESSAGES: Elena conversation with tone-based sets,
  4 decision outcomes based on money state.
  Decision required before sleep button activates.
- NEWS: Procedural articles based on lastShiftRadiation (4 tiers).
  [LOCATION] and [N] variables. Never mentions facility or radiation.
- BANK: Balance, treatment fund progress bar, last transfer summary,
  housing status badge. Rebuilds on Elena decision to show live balance.

### Rent / eviction system (complete)
- shiftsWithoutRent tracked in save (incremented on SEND ALL / SEND WHAT,
  reset on KEEP SOME / DON'T SEND)
- gap=1 → amber hint in action bar
- gap=2 → red hint "EVICTION IMMINENT"
- gap≥3 → street death triggered on sleep button click

### Street death screen (screens/death.html) (complete)
- Bypasses shift-end entirely
- Typewriter sequence: header → STATUS: NON-RETURN → 3-line death
  description → bureaucratic record → "THIS POSITION WILL BE FILLED."
- 4 randomized scenarios. Button + keypress to return to menu.
- Writes gameOver:true / gameOverReason:'street' to save.

## Currently in progress
Nothing. All home terminal systems complete.

## Next up (not started)
- Shift counter integration across screens
- Records screen (unlocks at shift 3)
- Operator File screen
- Onboarding/tutorial (likely in-game, first shift slower)
- Audio (asset store + custom UI sounds)
- Steam page, trailer, wishlist campaign

## Design principles to follow
1. Scope discipline. 4-month solo dev window. 
   Always ask: can this be simpler?
2. No feedback loops into the main game from home terminal 
   beyond what's already defined (money, Elena tone, news).
3. Player discovers connections — never tell them directly.
4. Log is the primary narrative vehicle during gameplay.
5. Paraphrase of existing mechanics is preferred over 
   adding new mechanics.
6. All copy/text in English.

## Story (for context only, not fully implemented yet)
Player is an operator supporting family overseas. Daughter Mira 
is sick, needs expensive medication. Player sends earnings home. 
Reactor is old and unreliable — sometimes leaking radiation is 
the only way to complete a clean shift for full pay. 

Every shift, player reads Elena's messages and regional news. 
News shows the consequences of any radiation released. Moral 
question: how much will you pollute to keep your family alive?

Also: player needs to keep some money for rent. Two consecutive 
shifts sending everything → eviction warning. Third shift → 
street death (one of 4 randomized scenarios).

Game length target: 7 shifts (~2-2.5 hours playtime).
Target money for treatment: 2400 units.

## Things to NEVER do
- Do not add frameworks or libraries
- Do not build Unity equivalents — this is HTML/JS now
- Do not reference earlier abandoned Unity attempts
- Do not add any Turkish text (all copy is English now)
- Do not directly mention radiation in news content
- Do not add telephone calls or voice audio to messaging
- Do not make Elena emotionally manipulative beyond the 
  tone levels defined
- Do not add save-scumming prevention — player freedom is fine
- Do not disable input controls during critical states

## Known issues / tech debt
- Shift-end environmental telemetry could be more dramatic
- No audio whatsoever
- Onboarding nonexistent — players won't understand the game
- News articles need ~30+ more variations for variety
- Elena messages need more variety within each tone set
- Balance needs playtest with full shift + all systems