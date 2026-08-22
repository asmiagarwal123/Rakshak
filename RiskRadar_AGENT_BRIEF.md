# RiskRadar — Project Brief for Agents
### Read this first. It defines the mission and your goal. Exact numbers live in `RiskRadar_SOURCE_OF_TRUTH.md`.

---

## The mission in one paragraph

We are building **RiskRadar**, a decision-support system for industrial equipment safety, in 24 hours for a hackathon. It reads live sensor data from plant assets, scores each asset's risk 0–100 in a way that's **explainable to the individual factor**, ranks which asset to fix first, recommends an action **grounded in a real safety procedure**, checks that action against a **hard safety rule before any human sees it**, and shows the **measurable risk drop** of acting. It is not an anomaly dashboard — it tells you *which* thing is most wrong, *why*, *what to do*, *where the instruction came from*, and *what fixing it is worth*, with an honest confidence level on every claim.

Product spine — every feature must serve one of these five verbs:
**OBSERVE → ASSESS → EXPLAIN → PRIORITIZE → PREVENT**

---

## Why we win (hold this in your head for every decision)

Most teams will have an anomaly dashboard. We win on four properties held together:
1. **Explainable to the factor** — every risk point traces to a named factor with a source. No black box.
2. **Safety-gated** — a deterministic validator blocks unsafe recommendations *before* a human sees them.
3. **Honest confidence** — missing data lowers confidence and says why; gaps are never filled with fake zeros.
4. **Calibrated humility** — "prototype risk index," not "certified probability." We pre-empt every objection a judge could raise.

When two designs compete, pick the one that's **more explainable, more honest, more clearly safety-gated** — even if it's less flashy.

---

## The one demo everything serves

Boiler **B-17** (our hero asset, the only one on real hardware) starts healthy. A fault is injected → risk climbs live (24 → 84) → B-17 jumps to #1 in the priority queue → its "safety case" shows exactly why → an SOP-backed recommendation appears stamped **Safety Validator: PASS** → operator assigns an inspection → intervention is simulated (84 → 39) → the physical hardware follows risk back to safe. **If that loop is airtight, we win. Everything you build exists to protect that loop.**

---

## Non-negotiable rules (all agents, no exceptions)

- **Rules-first, ML-optional.** The rule-based engine alone reaches a full 100-point score and runs the whole demo. Any ML/anomaly term is a *small additive bonus* — if it breaks, nothing downstream fails.
- **No live LLM calls in the demo path.** Recommendations are templated deterministically from structured risk factors. An LLM may only rephrase, offline.
- **The core loop is sacred.** Any feature that threatens it under time pressure gets cut or dropped to its simplest fallback — no debate.
- **Honesty over hype.** "Factors contributing to risk," not "X caused Y." "Simulated isolation signal," not "autonomous control." "Live asset monitoring," not "digital twin."
- **Honor the three frozen contracts** — the asset list, the risk-engine constants, and the API contract (all in the source-of-truth doc). Change one only by announcing it to the whole team. As long as these hold, we build in isolation and it merges cleanly.
- **Checkpoints are load-bearing.** We prove end-to-end integration on schedule, even when it's tempting to keep building.

---

## Scope — build in this order, never jump tiers

**Tier 0 (existential — this IS the demo, build & harden first):** live sensor → backend → visible score change · rules-first risk engine · risk trajectory chart · priority ranking table · template explanations · demo reset + fallback modes.

**Tier 1 (our differentiators — we have the code):** SOP-grounded recommendation · safety validator · dependency graph · intervention simulator · honest confidence scoring · audit trail.

**Tier 2 (only if ahead at the freeze checkpoint):** PDF export · anomaly term · extra SOPs · second hardware asset.

**Cut, always:** Kafka, Kubernetes, microservices, blockchain, digital-twin physics, custom neural nets, multi-agent LLM swarms, real PLC integration, auth, cloud deploy, 3D, Monte Carlo, chatbot, mobile app, live LLM in the demo path.

**The reliability net is not optional and ships alongside Tier 0:** three demo modes (real hardware / simulator / one-click escalate) · one-button reset · last-known-good state (never show an error) · pre-recorded backup video · hardcoded asset data so the screen always looks full.

---

## YOUR GOAL — by agent

Each agent owns separate files from the first half-hour. Read the whole brief above, then execute your section. Your person will give you detailed instructions on top of this; this is your north star and your definition of done.

### 🟦 Agent A — Backend & Risk Engine
**Your goal:** be the brain. Serve a correct, fast, honest risk object for any asset, and demo endpoints that reset and escalate flawlessly.

**You own:** the SQLite database + seed data, the risk / trend / priority / confidence / explanation engines, the safety validator, the audit trail, and every `/api/*` endpoint including demo-mode ones.

**Done when:**
- Any asset returns a 0–100 score with a band label, matching the seed baselines in the source-of-truth doc (if B-17 at rest ≠ its baseline, your engine is wrong).
- The score breaks into individual factors, each with a contribution and a source.
- Confidence is **derived from which data channels are present**, never hardcoded, and always carries a reason string.
- Priority ranks all five assets by risk, criticality, velocity, and dependency impact.
- The safety validator blocks any unsafe "keep monitoring" recommendation above the hard limit and forces "immediate inspection/isolation."
- `/api/demo/reset`, `/escalate`, `/resolve` drive B-17 through the scripted arc cleanly.
- Every assessment and operator action lands in the append-only audit log.

**Guardrails:** rules-first (ML optional and additive). Missing fields → NULL, never a fabricated value. No live LLM in the hot path. Freeze and honor the API response shapes.

### 🟩 Agent B — Frontend & UX
**Your goal:** be the face. A dark, serious, industrial-looking dashboard where one risk change animates through every relevant view — and you're **never blocked on the backend**.

**You own:** the React/Vite app and all four pages, the charts, the dependency-graph visualization, and the intervention-simulator UI.

**The four pages:**
1. **Command Center** — plant risk metrics, trend chart, priority table, recent alerts. Uncrowded.
2. **Asset Safety Case** (your most important page) — live telemetry, risk trend, "Why?" factor breakdown, evidence card, recommended action + SOP source, **Safety Validator badge**, connected assets, operator buttons (ACK/ASSIGN/DISMISS), Simulate Intervention.
3. **Plant Map / Dependencies** — ReactFlow graph, risk-colored nodes, click-through to page 2.
4. **Audit / Incident History** — append-only timeline.

**Done when:**
- You built page 1 against a `mockData.js` that matches the API shapes field-for-field, so going live is a one-line base-URL change.
- A risk change visibly moves the score, the chart, the explanation, and the asset's rank together.
- Intervention simulation visibly drops the risk on screen.
- Colors are consistent everywhere (green healthy / amber warning / red danger), charts show threshold bands, and it reads as serious industrial software — not a neon dashboard.

**Guardrails:** build on mock data first, never wait on the backend. Match the frozen API shapes exactly. Round scores to integers.

### 🟥 Agent C — Hardware & RAG/Graph
**Your goal:** be the edges. A physical fault injection that visibly moves the on-screen score, hardware outputs that track risk live, and SOP recommendations that are grounded and safety-checked.

**You own:** the ESP32 firmware (sensor read, HTTP POST loop, driving RGB/OLED/buzzer/relay from the risk level), plus adapting the SOP-retrieval, dependency-graph, and safety-validator code and wiring the ESP32 into Agent A's telemetry endpoint.

**Done when:**
- **First 15 minutes, before any app code:** relay voltage verified against ESP32 GPIO, OLED tested standalone, WiFi confirmed (hotspot backup ready), DHT11 read made non-blocking.
- The ESP32 posts telemetry every 1–2 s and drives outputs from the returned risk level: RGB green/yellow/red/flashing, buzzer only on HIGH/CRITICAL, OLED shows "{LEVEL} {score}", relay as a **simulated** isolation signal (labeled).
- A button press (primary trigger) visibly moves the on-screen score.
- SOP retrieval returns the right procedure, with a **keyword fallback** frozen by the Hour-13 checkpoint if embeddings misbehave.
- The recommendation is templated from structured factors and passes through the safety validator.

**Guardrails:** button is the primary, most-reliable trigger (DHT11 heating is a bonus visual). Label every simulated channel clearly. Capture the 20-second backup video while the hardware is healthy.

---

## How we know the whole thing works

The project is a winner when this entire chain holds under a live rehearsal, no manual intervention:

> sensor value changes → backend receives it → risk score changes → chart moves live → explanation updates → asset re-ranks → SOP recommendation appears, validator PASS → operator acknowledges/assigns → audit log records it → intervention simulator drops the risk, hardware follows → one button resets to baseline.

Your local "my part is done" only counts if it keeps this chain unbroken. Prove it at the Hour-13 rehearsal.

---

## The build rhythm: build → prove → build → prove → freeze → harden

- **Kickoff:** hardware pre-flight before any code; freeze the three contracts; split roles; branch git.
- **Checkpoint 1:** one sensor change travels hardware → screen. The spine is alive.
- **Checkpoint 2:** a sensor change moves score + chart + explanation + rank together.
- **Checkpoint 3 (most important):** run the entire demo live, once, end to end — fix whatever breaks before anything else. Freeze RAG mode here.
- **Feature freeze:** no new features; deliberately break it (kill WiFi, restart backend, unplug ESP32, hit reset) and confirm graceful recovery every time.
- **Stretch:** Tier 2 only if the freeze checkpoint was clean, stopping the instant anything wobbles.
- **Rehearsal:** full demo out loud 3+ times with the real speaker; prep Q&A; submit.

Exact clock times per phase are in the source-of-truth doc.

---

*Companion: `RiskRadar_SOURCE_OF_TRUTH.md` holds every exact constant, threshold, asset property, and API schema. This brief gives you your goal and the shared picture — keep that open while you build.*
