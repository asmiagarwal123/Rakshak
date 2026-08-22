# RiskRadar — Project Statement & Implementation Plan
### The primary referential document. Every agent reads this first.

**Version 1.0** · Hackathon build · 24-hour window · 3 engineers + assistive agents

---

## How to use this document

This is the **shared brain** for the project. Before any agent (or person) starts role-specific work, they read this end to end. It answers four questions every contributor must hold in their head:

1. **What are we building, and for whom?** (§1–§2)
2. **Why does it win?** (§3)
3. **What are the parts, how do they connect, and who owns what?** (§4–§7)
4. **In what order does it get built, and how do we know it's working?** (§8–§10)

This document defines **goals, boundaries, and shared understanding.** It deliberately does *not* contain every constant, threshold, and payload schema — those live in the companion **`RiskRadar_SOURCE_OF_TRUTH.md`**, which is the authoritative reference for exact values. When this plan says "the risk engine scores 0–100 from six weighted factors," the source-of-truth doc says exactly what those weights are. **Read this for context and goals; read that for numbers.**

After reading this, each person gives their own agent role-specific instructions and works independently. This is the document that guarantees those independent efforts converge.

---

## 1. Project statement

**RiskRadar is a decision-support system for industrial equipment safety.** It watches live sensor telemetry from plant assets, computes an explainable risk score for each one, ranks which asset needs attention first, recommends a specific action grounded in a real safety procedure, checks that recommendation against a hard safety rule before any human sees it, and demonstrates the measurable risk reduction of acting.

It is **not** an anomaly-detection dashboard. Dashboards tell you something is wrong. RiskRadar tells you **which** thing is most wrong, **why**, **what to do about it**, **where the instruction came from**, and **what fixing it is worth** — with an honest confidence level attached to every claim.

The product journey, and the spine of the whole build, is five verbs:

> **OBSERVE → ASSESS → EXPLAIN → PRIORITIZE → PREVENT**

- **OBSERVE** — ingest live telemetry (real ESP32 sensor + seeded asset history).
- **ASSESS** — fuse telemetry with maintenance, failure, and inspection data into a 0–100 risk score.
- **EXPLAIN** — break that score into individual contributing factors, each with a source and a plain-language reason.
- **PRIORITIZE** — rank every asset by risk, criticality, velocity, and downstream dependency impact.
- **PREVENT** — recommend an SOP-grounded action, gate it through a deterministic safety validator, let a human act, and simulate the intervention's effect.

Every feature we build must serve one of those five verbs. If a feature doesn't, it's out of scope.

---

## 2. Who it's for & the scenario we demo

**User:** a plant operator or maintenance supervisor responsible for many pieces of equipment, who cannot personally watch every gauge and must decide where to send a limited crew first.

**Demo world:** a small industrial plant with five connected assets — a feedwater tank, a pump, a boiler, a valve, and a production-line motor. The **boiler (B-17)** is our hero: it's the one wired to real hardware, and the one that deteriorates live on stage.

**The story we tell in 3 minutes:** the boiler starts healthy and low-risk. A fault is injected (a button press / heat on the sensor). RiskRadar watches the score climb in real time, re-ranks the boiler to the top of the priority queue, opens its "safety case" showing exactly why it's dangerous, produces a procedure-backed recommendation stamped "Safety Validator: PASS," lets the operator assign an inspection, and then simulates the fix — risk drops, and the physical hardware (light, buzzer, display) follows it back to safe.

That end-to-end loop — deterioration detected, justified, prioritized, acted on, and shown to improve — is the entire pitch. Everything in the plan exists to make that loop airtight.

---

## 3. Why RiskRadar wins (the thesis every agent must internalize)

You don't win a hackathon by having more modules than the next team. Almost every competing team will have *some* anomaly dashboard. **We win by being the team whose answers to judges' questions have no cracks.**

Four properties, held together, are the moat. Very few teams will have all four:

1. **Explainability to the factor level.** The risk score is never a black box. Every point is traceable to a named factor with a data source. A judge can ask "why 84?" and get a real answer.
2. **Deterministic safety gating.** Every recommendation passes through a hard-coded safety rule *before* a human sees it. A dangerous "keep monitoring" suggestion gets blocked and replaced. This is our answer to "how do you stop the AI from hallucinating a dangerous recommendation" — generative reasoning is *subordinate* to deterministic safety rules.
3. **Honest confidence.** When data is missing, confidence drops and says why — it never silently pretends. Missing data lowers the score's confidence, it doesn't get quietly filled with zeros.
4. **Calibrated humility.** We never claim more than we've built. It's a "prototype risk index," not a "certified probability." The DHT11 "simulates an industrial telemetry channel." The relay is a "simulated isolation signal." Pre-empting the objection makes us read as *more* rigorous, not less.

That combination is what turns a dashboard into a **decision-support system.** Keep this framing in mind for every design choice — when in doubt, choose the option that makes the system more explainable, more honest, and more clearly safety-gated, even if it's less flashy.

**A note on our two "advanced" features — RAG and the dependency graph.** They're in the plan because we already have working code for them, so they're cheap to adapt and add real payoff. They are *not* in the plan because more features win. If either one threatens the core loop under time pressure, it gets cut or dropped to its simplest fallback without hesitation.

---

## 4. System overview — the parts and how they connect

RiskRadar is one FastAPI backend, one React frontend, and one ESP32 microcontroller, talking over plain HTTP.

```
   INPUTS                    BRAIN (FastAPI backend)                     OUTPUTS
 ┌─────────┐          ┌──────────────────────────────────┐         ┌──────────────┐
 │  ESP32  │──POST───►│  Ingest → Feature engine →        │         │  Dashboard   │
 │ sensor  │ telem.   │  Risk engine (rules-first) →      │◄──poll──│ (4 pages)    │
 └─────────┘          │  Priority · Confidence ·          │         └──────────────┘
 ┌─────────┐          │  Explanation · Dependency ·       │         ┌──────────────┐
 │ Seed DB │─────────►│  Safety validator → Recommendation│──resp──►│ ESP32 outputs│
 │(SQLite) │          │  → Audit trail                    │  level  │ RGB/OLED/    │
 └─────────┘          └──────────────────────────────────┘         │ buzzer/relay │
 ┌─────────┐                        ▲                              └──────────────┘
 │  Demo   │────────────────────────┘
 │triggers │  (reset / escalate / resolve)
 └─────────┘
```

**The nine engines inside the brain** (each is small; none is a research project):

| Engine | Its one job | Serves |
|--------|-------------|--------|
| Ingestion | Validate, timestamp, normalize telemetry; handle missing fields as NULL | OBSERVE |
| Risk engine | Fuse six weighted factors into a 0–100 score + band label | ASSESS |
| Trend/velocity | Measure how fast risk is climbing | ASSESS |
| Explanation | Turn the score into factor breakdown + plain-language text | EXPLAIN |
| Confidence | Weight which data channels are present; report honestly | EXPLAIN |
| Priority | Rank assets by risk, criticality, velocity, dependency | PRIORITIZE |
| Dependency graph | Map downstream impact of each asset (lookup, not traversal) | PRIORITIZE |
| RAG / SOP recommendation | Retrieve the right procedure, template a recommendation | PREVENT |
| Safety validator | Block unsafe recommendations against hard rules | PREVENT |

Plus the **audit trail** (append-only record of every assessment and operator action) that runs underneath all five verbs and gives us traceability.

**Design principle across all engines: rules-first, ML-optional.** The rule-based risk engine alone must be able to reach a full 100-point score and drive the entire demo. Any machine-learning or anomaly term is a small *additive* bonus — if it's missing or breaks, nothing downstream fails. We never bet the demo on a model.

**Design principle for the demo hot path: no live LLM calls.** Recommendations are templated deterministically from structured risk factors. An LLM may only rephrase text offline. Nothing in the live demo path waits on an external model to respond.

---

## 5. What we're building vs. what we're reusing vs. what we're cutting

**Reusing (adapted from our existing GenTwin codebase — this is our IP):** the FastAPI/CORS scaffold, the React/Vite/axios setup, Recharts chart components, the ReactFlow dependency-graph component, SQLite helper patterns, the audit-timeline pattern, the SOP retrieval structure, and the safety-validator pattern. Reuse is *why* Tier-1 features are affordable in 24 hours.

**Rewriting (our old code is too narrow for this):** the orchestrator becomes asset-centric instead of tracking a single pipeline; the database schema, global state, and operator workflow are new.

**Cutting — do not attempt, regardless of remaining time:** Kafka, Kubernetes, microservices, blockchain, full digital-twin physics, any custom neural net (LSTM/Transformer/GNN), multi-agent LLM swarms, real PLC integration, auth/roles, cloud deployment, 3D models, Monte Carlo cascades, chatbots, mobile apps, and any live LLM call in the demo path. These are how good hackathon teams run out of time. We don't.

---

## 6. Build priorities — what "must work" means

We build in strict tiers. **Nothing in a higher tier begins until the tier below it is solid.**

**Tier 0 — Existential.** If any of these fail, we have no demo: live sensor value → backend → visible risk-score change; the rules-first risk engine; the risk trajectory chart; the priority ranking table; template-based explanations; and the demo reset + fallback modes. This tier *is* the demo. It gets built and hardened first.

**Tier 1 — Our differentiators.** These are what make us memorable, and we have the code for them: SOP-grounded recommendations, the safety validator, the dependency graph, the intervention simulator, honest confidence scoring, and the full audit trail.

**Tier 2 — Only if we're ahead at the Hour-18 checkpoint:** PDF export, an anomaly-detector term, extra SOP documents, a second hardware asset.

**The reliability net is not optional and is not "Tier 2."** Three selectable demo modes (real hardware / software simulator / one-click escalation), a one-button reset, last-known-good state so the dashboard never shows an error, a pre-recorded backup video of a clean run, and hardcoded asset data so the screen always looks populated. Given how much we're building, this net is what protects all of it. It gets built alongside Tier 0, not after.

---

## 7. Team & agent roles — how three people build in parallel without colliding

The system is split so each person owns separate files from the first half-hour. Assistive agents take direction from their person, but every agent shares the context in this document.

**Person A — Backend & Risk Engine.** Owns the brain: the database and seed data, the risk/trend/priority/confidence/explanation engines, the safety validator, the audit trail, and every `/api/*` endpoint including the demo-mode ones. Success looks like: a correct, fast, honest risk object served for any asset, and demo endpoints that reset and escalate cleanly.

**Person B — Frontend & UX.** Owns the face: the React app and all four pages (Command Center, Asset Safety Case, Plant Map/Dependencies, Audit History), the charts, the dependency-graph visualization, and the intervention-simulator UI. **Person B is never blocked on the backend** — the frontend is built against mock data that matches the agreed API shape exactly, so going live is a one-line change. Success looks like: a dark, serious, industrial-looking dashboard where a risk change animates through every relevant view.

**Person C — Hardware & RAG/Graph integration.** Owns the edges: the ESP32 firmware (sensor read, HTTP POST loop, and driving the RGB light / OLED / buzzer / relay from the risk level), plus adapting our SOP-retrieval, dependency-graph, and safety-validator code and wiring the ESP32 into Person A's telemetry endpoint. Success looks like: a physical fault injection that visibly moves the on-screen score, and hardware outputs that track the risk level live.

**The three contracts that make this work** — frozen at kickoff, changed only by team-wide announcement:
- the **asset list** (which assets exist and their fixed properties),
- the **risk-engine constants** (thresholds and weights), and
- the **API contract** (endpoints and response shapes).

All three live in `RiskRadar_SOURCE_OF_TRUTH.md`. As long as everyone honors those three contracts, the three of you can build in near-total isolation and it will fit together on merge.

---

## 8. Implementation plan — the 24-hour arc

The timeline is organized around **checkpoints, which are load-bearing.** A checkpoint is a moment where we prove the whole team's work still connects end to end. **We do not skip checkpoints to keep building** — a missed checkpoint is how a team discovers at hour 20 that nothing integrates.

**Phase 0 — Kickoff (first hour).** Hardware pre-flight *before any app code* (verify voltages, test the display, confirm WiFi, make the sensor read non-blocking). Freeze the three contracts. Split roles. Set up git branches. Pull and audit the reusable modules.

**Phase 1 — First light (to Checkpoint 1).** A builds the risk engine and core endpoints; B builds the dashboard shell on mock data; C gets the ESP32 posting to the backend. **Checkpoint 1 proves one thing: a single sensor value change travels all the way from hardware to a number changing on screen.** If that works, the spine is alive.

**Phase 2 — The differentiators (to Checkpoint 2).** A adds priority, confidence, explanation, and velocity; B builds the all-important Asset Safety Case page; C adapts the RAG, dependency graph, and validator and wires the physical outputs. **Checkpoint 2 proves the full assessment loop: a sensor change moves the score, the chart, the explanation, and the asset's rank together.**

**Phase 3 — Complete the loop (to Checkpoint 3).** A finishes the intervention endpoint, audit trail, and demo-mode endpoints; B builds the priority table, dependency page, and intervention UI; C finishes integration and **captures the backup video while the hardware is healthy.** **Checkpoint 3 is the most important of all: we run the entire demo story, live, end to end, once — and fix whatever breaks before doing anything else.** We also freeze the RAG mode (full retrieval vs. keyword fallback) here.

**Phase 4 — Polish & harden (overnight).** Bug fixes, error handling, last-known-good state, and visual consistency. Staggered short rest breaks — we don't walk into the rehearsal on zero sleep.

**Phase 5 — Feature freeze & regression.** **No new features past this point.** We deliberately try to break it: kill the WiFi, restart the backend, unplug the ESP32, hit reset — and confirm it recovers gracefully every single time.

**Phase 6 — Stretch (Tier 2, only if the freeze checkpoint was clean).** PDF, then extra SOPs, then anomaly term, then a second asset — in that order, stopping the instant anything destabilizes the core loop.

**Phase 7 — Rehearsal & buffer.** Run the full demo out loud 3+ times with the actual speaker, prep the Q&A answers, finalize slides, submit, breathe.

Exact clock times for each phase are in the source-of-truth doc; the *shape* — build, prove, build, prove, freeze, harden — is what matters here.

---

## 9. What "done" looks like

The project is genuinely strong when this entire chain holds under a live rehearsal, without manual intervention:

> A sensor value changes → the backend receives it → the risk score changes → the trajectory chart moves live → the explanation text updates with the new factors → the asset moves up the priority ranking → an SOP-grounded recommendation appears with the validator showing PASS → the operator acknowledges or assigns it → the audit log records the event → the intervention simulator visibly lowers the risk, and the hardware follows it back to safe → and one button resets the whole thing to baseline.

If every link in that chain holds at our Hour-13 rehearsal, we have a winning project — independent of what any other team built. Every agent's local definition of "my part is done" rolls up to *this* chain staying unbroken.

---

## 10. The rules we don't break

These are commitments, not suggestions. They protect both our integrity and our Q&A performance.

- **Honesty over hype.** "Factors contributing to risk," never "X caused Y." "Prototype risk index," never "certified." "Live asset monitoring," never "digital twin." "Simulated isolation signal," never "autonomous control." We pre-empt every objection a judge could raise.
- **Rules before models.** The deterministic engine can run the whole demo alone. ML is additive and optional, never load-bearing.
- **Safety gates the AI.** No recommendation reaches a human without passing the deterministic validator.
- **Confidence never lies.** Missing data lowers confidence and says why. We never fill gaps with fake values.
- **The core loop is sacred.** Any feature — RAG, graph, anything — that threatens the core loop under time pressure gets cut or dropped to its simplest fallback, no debate.
- **Checkpoints are not optional.** We prove integration on schedule, every time, even when it's tempting to keep building.

---

*Companion document: `RiskRadar_SOURCE_OF_TRUTH.md` — the authoritative reference for every constant, threshold, asset property, API schema, and payload. This plan gives you the goals and the shared picture; that document gives you the exact numbers. Read this first, keep that open while you build.*
