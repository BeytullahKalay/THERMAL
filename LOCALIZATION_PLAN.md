# THERMAL — Localization Plan & Language Recommendations

## SCOPE — what needs to be translated

THERMAL is text-heavy. Rough word count:

| Source | Approx. words |
|---|---|
| BRIEFING + OP17 + OP18 + Predecessor logs | ~1,200 |
| KOWALSKI / REZNOV / DELETED operator logs | ~1,800 |
| Manual prescriptions + ER code titles + notes | ~1,500 |
| Elena messaging dialogues + decisions | ~2,000 |
| Dispatch worker scripts (radio convos) | ~3,000 |
| News articles (procedural + scripted) | ~2,500 |
| SAFE OPERATION MANUAL (5 sections + interface) | ~2,500 |
| In-game log lines (anomaly, CRM, valve, ER, shift-end) | ~1,500 |
| UI labels (gauges, buttons, badges, tooltips, settings) | ~600 |
| Shift-end, death, credits, splash, demo-end | ~400 |
| **TOTAL** | **~17,000 words / language** |

## COST ESTIMATE (per language)

| Option | Cost / Quality |
|---|---|
| **Professional game translator** (Fiverr / Upwork pro) | $0.08-0.15/word → **$1,400-2,500 / lang** |
| **Mid-tier translator + GPT4 polish** | $0.04/word → **$700 / lang** |
| **AI (GPT-4 / DeepL Pro) + native speaker proofread** | $200-400 / lang |
| **AI only** (NOT recommended for narrative) | $0-50 / lang |

**Reality check:** THERMAL is 70% narrative. Machine-only translations will read broken in Russian / Japanese / Chinese — players notice immediately and post one-star reviews. **Minimum acceptable**: AI translation + native speaker proofread.

---

## RECOMMENDED LANGUAGE TIERS

### 🟢 Tier 1 — Ship at launch (high ROI)

| Lang | Why | Notes |
|---|---|---|
| **English** | Baseline, required | You already have this |
| **Turkish (TR)** | You're a TR dev — native, free, your home audience | Use the Turkish dev community for free QA |
| **Simplified Chinese (zh-Hans)** | ~25% of Steam buyers. Atmospheric horror sells huge in CN | Mandatory for indie horror in 2026 |
| **Russian (RU)** | ~12-15% of Steam users. Soviet/reactor aesthetic is a perfect fit. THERMAL is FOR this audience | Almost mandatory for this genre |
| **German (DE)** | Strong indie horror buyer base; Beholder/Papers Please did well | Polite necessity for EU |

### 🟡 Tier 2 — Within 60 days post-launch (regional value)

| Lang | Why |
|---|---|
| **Japanese (JA)** | You asked for it. Niche but loyal — Iron Lung sells well in JP. Atmospheric horror has audience |
| **Korean (KO)** | You asked for it. Small market but high-paying. Quick add if you have JP translator |
| **Brazilian Portuguese (pt-BR)** | Fast-growing market, hungry indie buyers, BR community very vocal about localization |
| **Spanish (ES)** | Covers Spain + LATAM, ~5% Steam, easy win |

### 🔵 Tier 3 — Long-term (smaller markets)

| Lang | Why |
|---|---|
| **French (FR)** | Polite EU coverage, moderate sales |
| **Traditional Chinese (zh-Hant)** | Taiwan + Hong Kong (separate market from Simplified) |
| **Polish (PL)** | Surprisingly strong indie horror market, Cold War setting bonus |
| **Italian (IT)** | Standard EU completion |

### ⚪ Probably skip

- **Arabic, Hebrew** — Need right-to-left layout work, not worth the engineering cost for a CRT terminal UI
- **Vietnamese, Thai, Indonesian** — Small Steam markets, low ROI
- **Czech, Hungarian, Ukrainian** — Niche; consider if you have community translators only

---

## MY HONEST RECOMMENDATION

**Launch with:** English, Turkish, Simplified Chinese, Russian, German, Japanese — **6 languages**.

**Add at 60-day patch:** Korean, Brazilian Portuguese, Spanish — **3 more** (9 total).

**Optional after success:** French, Traditional Chinese, Polish.

This covers ~80% of Steam's revenue-bearing markets. Skipping Russian or Chinese loses serious sales. Skipping Polish/French is fine — they buy in English readily.

### Why these specific 6 for launch:

1. **English** — required
2. **Turkish** — free for you, important to your home market, demonstrates respect
3. **Simplified Chinese** — biggest market by volume; THERMAL atmosphere is highly compatible
4. **Russian** — perfect genre/setting fit; vocal community
5. **German** — buys indie horror reliably; demands localization
6. **Japanese** — you asked; loyal niche; complete Asia coverage with this + CN + KR

Adding Korean separately at 60 days makes sense because it's small enough that delaying it costs little.

### Cost if you do this right

- TR: free (you do it yourself)
- 5 paid languages × $400 (AI + native proofread) = **~$2,000 total** for launch
- Or 5 paid languages × $1,800 (professional) = **~$9,000 total** for premium quality

---

## TECHNICAL IMPLEMENTATION (when approved)

1. **`js/i18n.js`** — central translation registry. API: `t(key, [vars])` returns string in current language
2. **`locales/en.json`, `locales/tr.json`, ...** — flat key-value maps
3. **Refactor:** replace all hardcoded strings across:
   - log-reader.js (BRIEFING, all operator logs)
   - error-codes.json (titles, manualText, logCitation)
   - messaging.js (Elena dialogues)
   - game.js (~150 `_lsAdd(...)` calls, dispatch scripts, anomaly logs)
   - home-terminal.html (news articles, UI, sections)
   - menu.html, settings, manual.html, shift-end, death, splash, demo-end, credits
4. **Settings → LANGUAGE section** — radio list of available languages; on change, reload current page so new strings render
5. **Persist** language choice in localStorage `thermalLang` (separate key, NOT in `thermalSave` so reset-game doesn't wipe it)
6. **Font compatibility:** VT323 + Share Tech Mono only support Latin + extended Latin. For CN/JA/KO/RU we need a fallback CJK font (Noto Sans CJK is free + open) + Cyrillic font (VT323 supports Cyrillic; double-check)

**Estimated dev time:** 2-3 days for the refactor + i18n machinery. Translation time on top is per-language.

---

## QUESTION FOR YOU

Pick ONE before I start:

**A)** Build the i18n machinery + ship launch with **English + Turkish ONLY** (you translate TR yourself), prepare keys for other languages, ship them later as patches once translations come back from freelancers. **← My recommendation.** Fastest to launch, no waiting on translators.

**B)** Build i18n + wait for all 6 languages translated before launch. **Slower** (4-6 weeks of waiting for translation contractors), more complete experience day-one.

**C)** Different list — give me a custom set of languages.

Reply with A / B / a custom list, plus which 6 (or N) languages you want ultimately. Then I'll start the refactor.
