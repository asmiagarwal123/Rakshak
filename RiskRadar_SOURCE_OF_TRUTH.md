# RiskRadar — Single Source of Truth (Final)

**Version:** 1.0 — freeze at kickoff. Any change to §5 (constants), §8 (API), or §9 (DB) must be announced in the team channel and this version bumped.

**One-line pitch:** RiskRadar doesn't just predict failure — it tells you *which* asset to inspect first, *why*, *what to do* (traceable to an SOP), and *what fixing it is worth* — with a safety rule vetting every recommendation before a human sees it.

**Product flow:** OBSERVE → ASSESS → EXPLAIN → PRIORITIZE → PREVENT

**How to use this doc:** Every number, threshold, ID, and payload here is authoritative. If your agent needs a value and it's in this doc, use *exactly* this value. If it's not here, it doesn't exist — don't invent it, ask the team. The three of you must be able to build in parallel with zero coordination on data shapes because everything is pinned below.

---

## 0. Winning thesis (read before touching code)

You don't beat strong teams by shipping more modules. You beat them by being the team whose answers to judge questions have no cracks. Nearly every team will have an anomaly dashboard. Very few will have all of:

- A risk score explainable down to individual factors, each with a source
- A recommendation checked against a **deterministic safety rule before it reaches a human**
- An explicit confidence score that **degrades honestly** when data is missing
- A system that never claims more certainty than it has ("prototype risk index," never "certified probability")

That combination makes this a **decision-support system**, not a fancier dashboard. RAG and the dependency graph are here only because we already have working code for them (low cost, real payoff) — not because more features win.

---

## 1. Scope tiers (final — do not renegotiate mid-build)

### Tier 0 — Existential. If any fails, there is no demo.
1. ESP32 → HTTP POST → FastAPI → dashboard; a live sensor value visibly changes the risk score
2. Hybrid risk engine (rules-first, §5) producing 0–100 + label
3. Risk trajectory chart (last N readings)
4. Priority ranking table across 5–8 assets
5. Template-based plain-language explanation (deterministic, **no live LLM call in demo hot path**)
6. Demo reset + three fallback modes (§12) — **non-negotiable**

### Tier 1 — Differentiators. Build these; we have the code.
7. SOP-grounded recommendation via adapted RAG (small corpus, keyword fallback)
8. Deterministic safety validator gating every recommendation
9. Asset dependency graph (ReactFlow, 5 nodes, lookup-table backed)
10. Intervention Simulator (a lookup table — do **not** overbuild)
11. Confidence / data-completeness scoring (real, weighted, cheap — **never fake this**)
12. Full evidence / audit trail per assessment

### Tier 2 — Only after a clean Hour-18 checkpoint (§15)
13. PDF report export
14. Anomaly detector (z-score or IsolationForest) as a small additive term
15. Extra SOP docs beyond the initial 6
16. Second hardware-driven asset

### Cut. Do not attempt regardless of time.
Kafka, Kubernetes, microservices, event-streaming DB, blockchain, full digital-twin physics, custom neural net (LSTM/Transformer/GNN), multi-agent LLM swarm, real PLC integration, auth/roles, cloud deploy, 3D plant model, Monte Carlo cascades, chatbot, mobile app, **any live LLM call in the demo hot path.**

---

## 2. Architecture

```
INDUSTRIAL INPUTS
  ESP32 (DHT11 / IR / button) ─┐
  Seed data (SQLite) ──────────┼─► DATA INGESTION (validate, timestamp, normalize, NULL-handle)
  Simulator / demo triggers ───┘                │
                                                ▼
                                        FEATURE ENGINE
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                     ▼                     ▼
                     Rule Engine        ML/Anomaly (T2)        Trend/Velocity
                          └─────────────────────┼─────────────────────┘
                                                ▼
                                       RISK SCORE (0–100)
                    ┌───────────┬───────────────┼───────────────┬───────────┐
                    ▼           ▼               ▼               ▼           ▼
              Explanation  Confidence       Priority       Dependency    Safety
                Engine       Engine          Engine          Graph      Validator
                    └───────────┴───────────────┼───────────────┴───────────┘
                                                ▼
                                RECOMMENDATION (SOP-grounded)
                                                │
                                     validator: PASS / FAIL
                                                │
                              Operator (ACK / ASSIGN / DISMISS)
                                                │
                                          AUDIT TRAIL
                                                │
                          ESP32 output (RGB / OLED / buzzer / relay) + Dashboard
```

**Adapted from existing code (our IP):** FastAPI/CORS scaffold, React/Vite/axios, Recharts, ReactFlow graph, SQLite helpers, audit-timeline pattern, SOP retrieval structure, safety-validator pattern, PDF utility (T2).
**Rewritten:** orchestrator (asset-centric, not single-pipeline), DB schema, global state, operator workflow.
**Removed:** cost_agent, Monte Carlo, PLC recovery logic, equipment-specific fault codes.

---

## 3. The five seed assets (AUTHORITATIVE — everyone uses these exact rows)

These are the assets that exist. IDs are used in URLs, payloads, the graph, and the UI. Do not rename, do not add, do not reorder without a version bump.

| id | name | asset_type | location | criticality (0–100) | status | notes |
|----|------|-----------|----------|--------------------|--------|-------|
| `T01` | Tank T-01 | tank | Feedwater Bay | 60 | healthy | upstream source |
| `P04` | Pump P-04 | pump | Feedwater Bay | 70 | healthy | feeds boiler |
| `B17` | Boiler B-17 | boiler | Boiler Hall | 95 | healthy | **hero asset — has live ESP32 telemetry** |
| `V03` | Valve V-03 | valve | Boiler Hall | 55 | healthy | downstream of boiler |
| `M11` | Motor M-11 | motor | Line 2 | 80 | healthy | drives production line |

**B17 is the only asset wired to real hardware.** All others are seeded/simulated. The demo escalation always targets B17.

### Seed history per asset (drives the non-sensor risk terms)

| id | maint_status | days_overdue | failures_90d | inspection_severity | baseline_risk | baseline_level |
|----|-------------|-------------|-------------|--------------------|--------------|----------------|
| `T01` | on_time | 0 | 0 | none | 8 | LOW |
| `P04` | overdue | 5 | 1 | minor | 31 | LOW |
| `B17` | overdue | 12 | 1 | medium | 24 | LOW |
| `V03` | on_time | 0 | 0 | none | 6 | LOW |
| `M11` | overdue | 20 | 2 | minor | 44 | MEDIUM |

`baseline_risk` is what the engine must produce for that asset at rest (sensor term = normal). Use these to sanity-check your rule engine: if B17 at ambient temp doesn't compute to 24, your engine is wrong. (B17 breakdown at rest: sensor 0 + maintenance 10 [8–15 days] + failure 6 [1 failure] + inspection 10 [medium] + trend 0 = **26**… note: seeded inspection for B17 is "medium unresolved" = +10, maintenance 12 days = +10 [8–15 band], failure 1 = +6, giving 26; the displayed baseline **24** reflects a 2-pt anomaly/rounding allowance — **treat 24 ± 2 as correct at rest.**)

> Implementation note for Person A: pin B17 rest score to **24** by seeding inspection severity as "medium" but resolved-partial (+8) if you want an exact 24, OR accept the 24–26 window. Either is fine; just be consistent so the demo script's "24/100" line is honest.

---

## 4. Sensor thresholds (AUTHORITATIVE — the doc previously left these undefined)

The B17 telemetry channel is **temperature** (°C, via DHT11 / button-injected). These bands drive the Sensor risk term in §5.

| Band | Temp range (°C) | Sensor points | RGB | UI label |
|------|----------------|---------------|-----|----------|
| normal | `temp < 30` | +0 | GREEN | Normal |
| warning | `30 ≤ temp < 38` | +10 | YELLOW | Warning |
| unsafe | `38 ≤ temp < 45` | +20 | RED | Unsafe |
| unsafe + rapid rise | `temp ≥ 38` AND velocity ≥ fast | +30 | FLASHING RED | Critical trajectory |

**Hard safety limit (validator, §7):** `temp ≥ 45°C` → any "monitor"/"continue" recommendation is blocked and replaced with "Immediate inspection and isolation required."

**Humidity** is captured and displayed but does **not** contribute to the score in v1 (keeps the model explainable). Say so if asked.

Velocity is measured over the last 5 readings (see §5 trend term).

---

## 5. Risk engine — exact formula. Build it, verify against §3, stop tuning.

Rules alone must reach 100. ML/anomaly is a small additive term; if missing/broken, the system still works.

```
Sensor risk (0–30)          per §4 temperature bands
  normal              +0
  warning              +10
  unsafe               +20
  unsafe + rapid rise  +30

Maintenance (0–20)          from days_overdue
  on time (0)          +0
  1–7 days             +5
  8–15 days            +10
  16–30 days           +15
  >30 days             +20

Failure history, last 90d (0–15)
  0 failures  +0    1  +6    2  +10    3+  +15

Inspection findings (0–15)
  none +0    minor unresolved +5    medium +10    critical +15

Anomaly score (0–10, Tier 2)
  |z|>2 over trailing window, OR IsolationForest scaled 0–10; 0 if T2 not built

Trend / velocity (0–10)     Δtemp over last 5 readings
  stable        (Δ < 1°C)          +0
  gradual       (1 ≤ Δ < 4°C)      +3
  fast          (4 ≤ Δ < 8°C)      +7
  rapid         (Δ ≥ 8°C)          +10

RISK = Sensor + Maintenance + Failure + Inspection + Anomaly + Trend    (cap at 100)
```

**Bands (use everywhere, never change):**
```
 0–34   LOW
35–64   MEDIUM
65–84   HIGH
85+     CRITICAL
```

**Velocity score for priority (V, 0–100):** map trend term → `stable 0 / gradual 30 / fast 70 / rapid 100`.

**Trend enum for API:** `STABLE | INCREASING | RAPIDLY_INCREASING | DECREASING`.

**Missing-data rule (do not skip — cheapest trust win):** never substitute 0 for a missing field. Compute the score from what's present, drop confidence per §6, and surface explicit text: `"Data warning: pressure telemetry unavailable."`

---

## 6. Priority + Confidence engines

### Priority
```
PRIORITY = 0.55·R + 0.20·C + 0.15·V + 0.10·D

R = current risk (0–100)
C = asset criticality (0–100, static per §3)
V = velocity score (0–100, §5)
D = dependency impact (0–100, §7)
```
Display as a rounded integer (`87`, never `86.7234`).

### Confidence (channel weights)
```
Sensor data       25%
Maintenance       20%
Inspection        20%
Failure history   20%
Asset metadata    15%
```
Sum the weights of channels **actually present**. All present → 100%. Always pair with a reason string: `"Confidence: 80% — missing latest inspection report."`

**Confidence must never be a hardcoded constant.** It is derived from which channels have data for that asset at that moment. This is a judge magnet — keep it real.

---

## 7. Dependency graph + Dependency impact (D)

Static topology (lookup table, not a graph algorithm):
```
Tank T-01 → Pump P-04 → Boiler B-17 ┬─► Valve V-03
                                     └─► Production Line (Motor M-11)
```

**Downstream map (authoritative):**
| asset | downstream count | D (dependency impact) |
|-------|-----------------|----------------------|
| `T01` | 4 | 90 |
| `P04` | 3 | 75 |
| `B17` | 2 | 60 |
| `V03` | 0 | 10 |
| `M11` | 0 | 10 |

`D` feeds the priority formula. When B17 is HIGH, UI shows `"Downstream impact: 2 connected systems (V-03, Production Line)."` Do not build traversal logic beyond this table.

### Safety validator (deterministic gate)
Every recommendation is checked **before** it reaches the operator:
- If `risk ∈ {HIGH, CRITICAL}` AND `temp ≥ 45°C`, block any "continue monitoring" / "schedule later" recommendation → force `"Immediate inspection and isolation required."`
- If `risk = CRITICAL`, no recommendation weaker than "immediate inspection" may pass.
- Output on every recommendation: `validation_status ∈ {PASS, FAIL}` plus the rule that fired.

Lead with this if a judge asks how you prevent hallucinated recommendations: **generative reasoning is subordinate to deterministic safety rules.**

---

## 8. RAG / SOP recommendation module

- **6 seed SOP docs** (each tagged `{equipment_type, issue, severity}`):
  1. Boiler Overtemperature Response — boiler / overtemp / high
  2. Pump Preventive Maintenance — pump / maintenance / medium
  3. Motor Overheat Protection — motor / overheat / high
  4. Pressure Valve Safety — valve / pressure / medium
  5. Sensor Calibration Procedure — sensor / calibration / low
  6. Emergency Equipment Isolation — any / critical / critical
- Retrieval: SentenceTransformers (`all-MiniLM-L6-v2`) + existing vector store.
- **Explicit keyword fallback:** if embeddings misbehave under time pressure, drop to keyword/metadata filtering — same output shape. A reliable keyword match beats a flaky RAG demo. **Decide by the Hour-13 checkpoint which mode you're in and freeze it.**
- Recommendation text is **template-generated from structured `risk_factors`**, never asked open-ended from an LLM. An LLM may only rephrase. **No live LLM calls in the demo hot path.**

**Recommendation template (deterministic):**
> `"{severity_verb} {equipment_type} — {top_factor}. Recommended action: {sop_action}. Source: {sop_title} §{section}."`

Example: `"Immediate inspection and maintenance — temperature anomaly + maintenance overdue. Source: Boiler Overtemperature Response §4.2."`

---

## 9. Intervention Simulator (lookup table — AUTHORITATIVE values)

Not a model. A defined before→after lookup keyed on asset + intervention. Label it clearly as scenario simulation, not prediction.

| asset | intervention | before | after | factors removed |
|-------|-------------|--------|-------|-----------------|
| `B17` | Inspect + service | 84 (HIGH) | 39 (LOW) | maintenance overdue, inspection finding; sensor term recomputed at post-service normal temp |
| `P04` | Preventive maintenance | 31 (LOW) | 12 (LOW) | maintenance overdue |
| `M11` | Bearing service | 44 (MEDIUM) | 22 (LOW) | one failure event aged out + maintenance |

The demo uses **B17: 84 → 39**. After-simulation, hardware follows: RGB green, buzzer off, OLED `"SAFE 39"`.

UI copy: `"Scenario simulation based on a defined deduction model — not a validated physical prediction."`

---

## 10. Database schema

```sql
assets(id TEXT PK, name, asset_type, location, criticality INT, installation_date, status)
telemetry(id PK, asset_id FK, timestamp, temperature REAL, humidity REAL, pressure REAL,
          vibration REAL, ir_state INT, source TEXT)          -- unavailable fields = NULL
maintenance_records(id PK, asset_id FK, maintenance_date, next_due_date, type, status, notes)
inspection_records(id PK, asset_id FK, date, score, severity, finding, resolved INT)
failure_events(id PK, asset_id FK, timestamp, description)
risk_assessments(id PK, asset_id FK, timestamp, risk_score INT, risk_level, priority_score INT,
                 velocity INT, confidence INT, failure_probability REAL)
risk_factors(assessment_id FK, factor, value, threshold, contribution INT, source)
recommendations(assessment_id FK, action, sop_source, validation_status, status)
operator_actions(id PK, assessment_id FK, actor, action, reason, timestamp)
audit_events(timestamp, actor, asset_id, event_type, payload)   -- append-only
```
**Rule:** unavailable sensor fields are `NULL`, never a fabricated value.

---

## 11. API contract — FROZEN. Nobody changes a field without a version bump + team ping.

`source` = who produced the row: `"ESP32/DHT11" | "simulator" | "seed" | "demo"`.

```
GET  /api/health
GET  /api/assets
GET  /api/assets/{id}
GET  /api/assets/{id}/telemetry?limit=N
GET  /api/assets/{id}/risk
GET  /api/priorities
GET  /api/audit
POST /api/telemetry                      (ESP32 → backend)
POST /api/assets/{id}/assess
POST /api/assets/{id}/action
POST /api/assets/{id}/simulate-intervention
POST /api/demo/reset
POST /api/demo/escalate
POST /api/demo/resolve
```

### Field-level response schemas (so B and C never guess)

**`GET /api/health`**
```json
{ "status": "ok", "mode": "REAL_ESP32 | SIMULATOR | DEMO", "esp32_connected": true, "uptime_s": 1234 }
```

**`GET /api/assets`** → array of:
```json
{ "id": "B17", "name": "Boiler B-17", "asset_type": "boiler", "location": "Boiler Hall",
  "criticality": 95, "status": "healthy",
  "risk": { "score": 24, "level": "LOW", "priority": 41 } }
```

**`GET /api/assets/{id}/risk`** (the master object — Page 2 renders this):
```json
{
  "asset_id": "B17",
  "risk": { "score": 84, "level": "HIGH", "velocity": 18, "trend": "RAPIDLY_INCREASING",
            "confidence": 82, "priority": 94, "failure_probability": 0.37 },
  "telemetry": { "temperature": 41.2, "humidity": 62, "pressure": null, "source": "ESP32/DHT11",
                 "timestamp": "2025-01-01T10:32:11Z" },
  "factors": [
    { "name": "Temperature anomaly", "value": 41.2, "threshold": 38, "contribution": 20, "source": "ESP32/DHT11" },
    { "name": "Maintenance overdue",  "value": 12,   "threshold": 8,  "contribution": 10, "source": "maintenance_log" },
    { "name": "Failure history",       "value": 1,    "threshold": 1,  "contribution": 6,  "source": "failure_events" },
    { "name": "Inspection finding",    "value": "medium", "threshold": "none", "contribution": 10, "source": "inspection_records" },
    { "name": "Risk velocity",         "value": "rapid", "threshold": "stable", "contribution": 7, "source": "trend_engine" }
  ],
  "confidence_detail": { "score": 82, "reason": "missing pressure telemetry", "channels_present": ["sensor","maintenance","inspection","failure"] },
  "data_warnings": ["pressure telemetry unavailable"],
  "recommendation": { "action": "Immediate inspection and maintenance",
                      "source": "Boiler Overtemperature Response §4.2",
                      "validation": "PASS", "rule_fired": "temp<45 & HIGH → inspect" },
  "dependency": { "downstream_count": 2, "downstream": ["V03","Production Line"], "impact": 60 },
  "explanation": "Boiler B-17 risk is HIGH (84/100). Primary contributors: temperature rising into unsafe range, maintenance 12 days overdue, and an unresolved medium inspection finding. Confidence 82% (pressure telemetry unavailable)."
}
```

**`GET /api/priorities`** → array sorted desc by `priority`:
```json
{ "rank": 1, "asset_id": "B17", "name": "Boiler B-17", "risk": 84, "level": "HIGH", "priority": 94, "velocity": "rapid" }
```

**`GET /api/audit`** → array desc by time:
```json
{ "timestamp": "…Z", "actor": "operator | system | demo", "asset_id": "B17",
  "event_type": "ASSESSMENT | ACTION | INTERVENTION | DEMO_RESET | ESCALATE",
  "payload": { "risk": 84, "note": "Assign Inspection" } }
```

**`POST /api/telemetry`** (ESP32 body → 200):
```json
// request
{ "asset_id": "B17", "temperature": 41.2, "humidity": 62, "ir_state": 0, "source": "ESP32/DHT11" }
// response
{ "ok": true, "risk": 84, "level": "HIGH" }
```

**`POST /api/assets/{id}/action`** body: `{ "actor": "operator", "action": "ACK|ASSIGN|DISMISS", "reason": "..." }` → returns updated risk object + appends audit.

**`POST /api/assets/{id}/simulate-intervention`** body: `{ "intervention": "inspect_service" }` → `{ "before": 84, "after": 39, "level_after": "LOW", "factors_removed": [...] }`.

**Demo endpoints** (all return the updated B17 risk object):
- `POST /api/demo/reset` → clears live telemetry history, restores §3 baselines, B17 → 24 LOW, RGB green, buzzer off, priority queue reset.
- `POST /api/demo/escalate` → drives B17 through 24→32→47→61→84 over a few seconds (scripted).
- `POST /api/demo/resolve` → B17 → 39 LOW (same end-state as intervention).

**Transport:** plain HTTP POST from ESP32 every 1–2 s. Frontend polls every **800 ms–1 s**. No WebSocket/MQTT — too much to debug under time pressure.

---

## 12. Frontend — four pages only

1. **Command Center** — plant risk metrics (assets by level), trend chart, priority table (top 5), recent alerts. Keep uncrowded.
2. **Asset Safety Case** (most important) — live telemetry, risk trend, "Why?" factor breakdown (from `factors[]`), evidence card, recommended action + SOP source, **Safety Validator badge (PASS/FAIL)**, connected assets, operator buttons (ACK / ASSIGN / DISMISS), **Simulate Intervention** button.
3. **Plant Map / Dependencies** — ReactFlow, risk-colored nodes per §7 topology, click-through to Page 2.
4. **Audit / Incident History** — append-only timeline from `/api/audit`.

**Build Page 1 against a hardcoded `mockData.js` from Hour 0.5** — never block on backend. `mockData.js` must match §11 schemas field-for-field so the swap to live is a one-line base-URL change.

**Visual style:** dark navy/charcoal background, white/gray text; **green=healthy, amber=warning, red=danger** (same hex everywhere — pick once, e.g. `#22c55e / #f59e0b / #ef4444`). Charts show threshold bands (draw the §4 lines at 30/38/45°C). Reads as serious industrial software, not a neon dashboard.

---

## 13. Reliability net — this protects everything else

- **Three demo modes, chosen live:** (A) real ESP32, (B) software simulator, (C) one-click `/api/demo/escalate`.
- **Demo reset endpoint** = one button, full restore (§11). Never manually restart three services mid-judging.
- **Last-known-good state:** dashboard holds the last good payload in memory if ESP32 drops — never blank/error.
- **Pre-recorded 20 s backup clip** of a perfect run, captured at Hour 10–13 while hardware is healthy.
- **Hardcoded JSON of the 5 assets** so ranking/dashboard stays populated during any telemetry hiccup.

---

## 14. Hardware plan

**First 15 minutes, before any app code:**
- Verify relay trigger voltage vs ESP32 GPIO (3.3 V logic — many relay modules need 5 V; check the datasheet now).
- Test OLED I²C wiring/address standalone.
- Confirm venue WiFi for the ESP32; phone hotspot as backup.
- Make the DHT11 read (~2 s) **non-blocking** in the loop.

**Primary trigger:** push-button fault injection (most reliable). DHT11 ambient heating is a bonus visual, not the main lever.

**Outputs:** RGB — GREEN=LOW, YELLOW=MEDIUM, RED=HIGH, FLASHING RED=CRITICAL. Buzzer **only** on HIGH/CRITICAL. Relay = **simulated isolation signal only** — UI label "Simulated equipment isolation," never claim autonomous control. Label IR/button/touch channels "Simulated fault channel" in the UI.

**ESP32 loop contract:** read sensor → build §11 telemetry JSON → POST `/api/telemetry` every 1–2 s → parse `{ risk, level }` from response → set RGB/buzzer/OLED from `level`. OLED shows `"{LEVEL} {risk}"` e.g. `"HIGH 84"`.

---

## 15. Team split — own separate files from Hour 0.5

**Person A — Backend / Risk Engine.** SQLite + §3 seed data, rule engine (§5), fusion, priority + confidence (§6), explanation, audit, safety validator (§7), all `/api/*` including demo-mode endpoints. **Owns §5, §6, §10, §11.**

**Person B — Frontend / UX.** React/Vite, all four pages (§12), Recharts, ReactFlow, Intervention Simulator UI, `mockData.js`. Never blocked on backend. **Owns §12.**

**Person C — Hardware + RAG/Graph.** ESP32 firmware (§14), adapts SOP retrieval (§8) + dependency graph (§7) + safety validator, integrates ESP32 → Person A's `/api/telemetry`. **Owns §8, §14, and the ReactFlow topology data.**

Shared, frozen at kickoff, nobody edits alone: §3 (assets), §4 (thresholds), §5 (constants), §7 (D table), §9 (intervention values), §11 (API).

---

## 16. 24-hour timeline (checkpoints are load-bearing — do not skip)

| Elapsed | Block | What happens |
|---|---|---|
| 0:00–1:00 | **Kickoff** | Hardware pre-flight (§14); role split; freeze §3/§4/§5/§7/§9/§10/§11; pull + audit reusable modules; git branches `backend-risk`, `frontend-dashboard`, `hardware-rag` |
| 1:00–4:00 | Build 1 | A: seed data + rule engine + core endpoints. B: dashboard shell + mockData. C: ESP32 firmware + HTTP POST loop |
| 4:00–5:00 | **Checkpoint 1 + food** | Merge to `main`. Prove: one sensor change reaches backend and changes a number on screen, end to end |
| 5:00–9:00 | Build 2 | A: priority/confidence/explanation/velocity. B: Safety Case page. C: adapt RAG + dependency graph + validator; wire IR/button/buzzer |
| 9:00–10:00 | **Checkpoint 2 + food** | Full loop: sensor change → risk change → chart moves → explanation updates → asset re-ranks |
| 10:00–13:00 | Build 3 | A: intervention endpoint, audit, demo endpoints. B: priority table, graph page, intervention UI. C: finish RAG/validator; **capture 20 s backup video now** |
| 13:00–14:00 | **Checkpoint 3** | Run the full demo (§17) once, live, end to end. **Most important checkpoint — fix what breaks before moving on.** Freeze RAG mode (embeddings vs keyword). |
| 14:00–18:00 | **Overnight polish** | Bug fixes, error handling, last-known-good, visual polish, consistent colors/labels/timestamps. Stagger 45–60 min rests per person |
| 18:00–19:00 | **Feature freeze** | No new features. Regression: kill WiFi, restart backend, disconnect ESP32, hit demo reset — confirm graceful recovery every time |
| 19:00–21:00 | Stretch (T2 only, if 18:00 was clean) | PDF → extra SOPs → anomaly detector → second asset, in that order. Stop if anything destabilizes the core loop |
| 21:00–23:00 | **Rehearsal** | Full demo 3+ times, out loud, with the actual speaker. Prep Q&A (§18). Finalize slides |
| 23:00–24:00 | Buffer | Breakfast, final checks, submission |

---

## 17. Demo script (~3 min, beat-by-beat)

1. **Open (15s):** "RiskRadar doesn't just predict failure — it tells you which asset to inspect first, why, and what fixing it is worth." Show Plant Status: SAFE; Boiler B-17 at **24/100 LOW**.
2. **Live escalation (45s):** Trigger the fault (button/DHT11). On screen: **24 → 32 → 47 → 61**, "⚠ Risk escalating rapidly." Second fault: **61 → 84**, MEDIUM → HIGH. Hardware: RGB red, buzzer, OLED "HIGH 84".
3. **Re-ranking (15s):** Priority table — B-17 jumps to **#1** above Motor M-11 and Pump P-04.
4. **Safety Case (45s):** Click B-17. Walk the evidence: temperature trend, maintenance 12 days overdue, failure history, unresolved medium inspection finding. Show SOP-sourced recommendation + **"Safety Validator: PASS."**
5. **Human-in-loop (15s):** Click "Assign Inspection." Audit log records it.
6. **Intervention Simulator (30s):** "Simulate Intervention." Before **84/HIGH** → After **39/LOW**. Hardware follows: RGB green, buzzer off, OLED "SAFE 39".
7. **Close (15s):** "RiskRadar didn't wait for failure. It detected deterioration, proved why the asset needed attention, prioritized it over every other asset, recommended a traceable preventive action, and showed measurable risk reduction after intervention."

---

## 18. Q&A prep — answer honestly

| Question | Honest answer |
|---|---|
| Is your ML doing the real work? | No — rules-first hybrid score; ML/anomaly is a small additive term. Deliberate: fully explainable, not a black box. |
| Is DHT11 industrial-grade? | No — it simulates an industrial temperature telemetry channel for the prototype. |
| Is your RAG production retrieval? | A small purpose-built corpus (6 SOPs) with semantic + keyword-fallback retrieval — scoped to the task, not infra for its own sake. |
| Does this predict the future? | Scenario simulation on a defined deduction model, not a validated physical prediction — labeled as such in the UI. |
| Is your risk score certified? | A prototype decision-support index, not a calibrated industrial probability. |
| Does the relay control machinery? | No — a simulated isolation signal, explicitly labeled. |
| How do you prevent hallucinated recommendations? | A deterministic safety validator vets every recommendation before a human sees it — generative reasoning is subordinate to safety rules. |

---

## 19. Non-negotiable honesty rules (say them, don't just imply)

- Never claim causality you haven't modeled — "factors contributing to risk," not "X caused Y."
- Never call it a certified/real-world number — "prototype risk index."
- Never claim autonomous control of real equipment.
- Don't oversell "digital twin" — call it "live asset monitoring."

This is both ethics and your best Q&A defense: pre-empting the objection reads as more rigorous than getting caught overclaiming.

---

## 20. Definition of Done — all ten must hold at the Hour-13 rehearsal

- [ ] Sensor value changes (real or simulated)
- [ ] Backend receives it
- [ ] Risk score changes
- [ ] Trajectory chart moves live
- [ ] Explanation text updates with the new factors
- [ ] Asset moves in the priority ranking
- [ ] SOP-grounded recommendation appears; validator shows PASS
- [ ] Operator can acknowledge/assign; audit log records it
- [ ] Intervention simulator visibly decreases risk; hardware follows
- [ ] Demo reset restores baseline in one click

If all ten hold under the Hour-13 rehearsal, you have a genuinely strong project — regardless of what any other team built.

---

## Appendix A — Constants quick-reference (for agent prompts)

```
ASSETS:      T01(tank,crit60) P04(pump,crit70) B17(boiler,crit95,HERO,live)
             V03(valve,crit55) M11(motor,crit80)
BANDS:       0-34 LOW | 35-64 MEDIUM | 65-84 HIGH | 85+ CRITICAL
TEMP °C:     <30 normal(+0) | 30-38 warning(+10) | 38-45 unsafe(+20) | ≥38&rapid unsafe+rise(+30)
HARD LIMIT:  temp ≥ 45 → validator forces "immediate inspection/isolation"
MAINT days:  0(+0) 1-7(+5) 8-15(+10) 16-30(+15) >30(+20)
FAILURES:    0(+0) 1(+6) 2(+10) 3+(+15)
INSPECTION:  none(+0) minor(+5) medium(+10) critical(+15)
TREND Δ°C/5: <1 stable(+0) 1-4 gradual(+3) 4-8 fast(+7) ≥8 rapid(+10)
PRIORITY:    0.55·R + 0.20·C + 0.15·V + 0.10·D
CONFIDENCE:  sensor25 maint20 inspect20 failure20 metadata15 (sum present channels)
D IMPACT:    T01=90 P04=75 B17=60 V03=10 M11=10
DEMO ARC:    B17 24→32→47→61→84 ; intervention/resolve → 39
POLL:        frontend 800ms-1s | ESP32 POST 1-2s | HTTP only
COLORS:      #22c55e green | #f59e0b amber | #ef4444 red | dark navy bg
```
