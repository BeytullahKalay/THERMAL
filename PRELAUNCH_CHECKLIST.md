# THERMAL — Pre-Launch Critical Checklist

Items marked **🔴 BLOCKER** will hurt sales catastrophically if missed. **🟡 IMPORTANT** noticeably hurt. **🟢 NICE-TO-HAVE** are polish.

---

## 🔴 BLOCKERS — must fix before launch

### 1. Steam capsule art (5 sizes)
You will not be visible without these. Steam shows the small capsule (231×87) on the storefront homepage; if it's not readable at that size, no one clicks. You need:
- **Library hero**     1920×620
- **Main capsule**      616×353
- **Small capsule**     231×87
- **Vertical capsule**  748×897 (for promotions)
- **Library logo (PNG transparent)** for the Library

The current `MildlyEpicLogo2.png` is a studio logo, not a game capsule. THERMAL needs its own capsule featuring the title + a single iconic visual (e.g. red ER code over green CRT gauges). Hire a freelancer ($50-150 on Fiverr/Reddit) or commission art if you can't draw.

### 2. Refund-safe first 30 minutes — playtested
Steam's 2-hour refund window means **the first ER and the first "manual is wrong" hint must land before minute 30**. Auto-spawn currently lands first ER at ~3-5 game-min real time. Verify in a blind playtest: does an unfamiliar player understand the hook within 30 min? If not, tighten further.

### 3. Steamworks achievements integration
Achievements you wrote in MARKETING_PLAN.md will NOT fire automatically just because you defined them. You need:
- Register the app via Steamworks portal
- Install **Greenworks** npm package (Electron-Steamworks bridge)
- Replace localStorage flags (e.g. `op17NewsSeen`) with `greenworks.activateAchievement('ACH_OP17_NEWS')`
- ~4-6 hours of work

Without this, achievements show "0 unlocked" forever. Players notice immediately.

### 4. Clean-install build test
You've never run `npm run dist` and tested the EXE on a fresh Windows machine without Node.js. **Do this on a VM or a friend's PC before launch.** Common failures: missing native module rebuilds, hardcoded dev paths, fonts not bundled.

### 5. Save schema versioning
Right now `thermalSave` has no version field. Any update that changes the shape will crash old saves. Add `version: 1` now and write a migration block in `saveSystem.js` that handles old shapes. Players who update mid-run will refund if you wipe their save.

---

## 🟡 IMPORTANT — measurably hurts sales

### 6. Wishlist runway (8+ weeks)
Steam's launch-week visibility is driven by wishlist count and conversion rate. **You need wishlists BEFORE launch.** Steam page must go live 8-12 weeks before launch. Don't launch the page same week as the game.

### 7. Press kit + curator outreach
Without a press kit (`/presskit/`-style page with logos, screenshots, factsheet, contact email), no journalist or YouTuber will cover you. Use [presskit() by Rami Ismail](https://dopresskit.com/). Email 30-50 niche horror/sim curators via Steamworks 1 week before launch.

### 8. Demo build (Steam Next Fest)
Steam runs Next Fest 3 times a year — demo participation is free advertising. THERMAL's demo should be: shift 1 only, first ER lands, ends with cliffhanger before lie discovery. Tag end with "WISHLIST FOR FULL GAME". One-time thousands of wishlists.

### 9. Crash recovery / mid-shift autosave
If game crashes mid-shift, player loses 5-15 minutes of progress. Add autosave every 60 game-min (not real time) writing minimal state to `thermalAutosave`. On boot, offer "RESUME" if autosave newer than thermalSave.

### 10. Discord server
Even an empty Discord with 10 members converts launch buyers into community members. Add invite link to Steam page + in-game CREDITS. Solo devs underestimate this.

### 11. Steam Direct + tax + entity
- $100 Steam Direct submission fee
- W-8BEN form (non-US devs) or US tax setup
- Business entity recommended (Mildly Epic Interactive LLC equivalent — protects personal assets)
- Banking account that accepts USD payouts

This is paperwork-only but takes 2-4 weeks for tax forms to clear.

---

## 🟢 NICE-TO-HAVE — polish, not blockers

### 12. Steam Cloud saves
Players expect this. Steamworks → Cloud Storage. Auto-syncs `thermalSave` across machines.

### 13. Localization (Turkish + Russian + German)
English-only is fine for launch. Adding Turkish doubles your TR market overnight (and you're a TR dev). Russian unlocks ~12% of Steam users. German another 8%. Each language ~8-15h of work.

### 14. Launch-day live presence
Stream your own first run on launch day (TikTok live or Twitch). Not for views — to seed the conversation. Players who see the dev playing become evangelists.

### 15. Day-one patch commitment
Have a `v1.0.1` ready to push within 24-48h of launch for inevitable bug reports. Players forgive bugs if fixes ship fast.

### 16. PEGI/IARC self-rating
Free, takes 20 minutes via IARC questionnaire on Steamworks. THERMAL likely PEGI 12 (mention of death, no graphic violence). Required by some regions.

### 17. Refund-prevention friction
Add a "// PRESS [F1] FOR DEBUG" hint somewhere subtle. Players who hit a wall in shift 1 can self-rescue. Lower refund rate.

---

## My top 3 priorities (in order)

1. **Steam capsule art** — without this you have nothing
2. **Steamworks achievements + clean-install build test** — broken game in launch week = mass refunds
3. **Steam page live 8 weeks early + demo for Next Fest** — wishlist runway

Do these three before anything else marketing-side. Trailer / TikTok / curator pitch all come AFTER the page is up.
