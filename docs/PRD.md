# Jira Bulk Transition — Product Requirements Document

Version 1.1 · 5 October 2026 · Status: implementation baseline; Jira-specific behaviour requires a discovery spike.

Implementation clarification (5 October 2026): target instance is Jira v9 Data Center. Develop against a local fixture first; exact minor version, workflows and DOM selectors remain unvalidated. See `IMPLEMENTATION_STATUS.md` for delivered scope.

## 1. Product outcome
A single-user local web application lets an engineering user teach a Jira transition once, review and validate the resulting flow, and apply it to approximately 40–50 Epics through Jira's visible browser UI. Primary transitions are Implement and Done. No Jira REST integration, Jira Automation access, API credentials, or cloud service is required.

The web application runs on the user's Windows laptop. It opens a separate visible Chrome browser for Jira. The user performs corporate SSO/MFA manually; the application retains a dedicated browser profile subject to corporate session expiry policies.

## 2. Users and problem
The primary user is a solution architect or delivery owner who repeatedly changes groups of Epics. Opening each issue, choosing its transition, completing fields and checking success is repetitive and error-prone. Workflows may differ by project, initial status and transition screen.

Success means fewer repetitive actions, verified outcomes and an exportable record of every requested issue. A recording of one workflow is evidence for that workflow variant, not proof that all Jira projects behave identically.

## 3. Scope
| MVP | Later | Excluded |
|---|---|---|
| Local React web UI and visible Chrome worker | UI-driven JQL search and pagination | Jira REST and Automation rules |
| Manual login and persistent dedicated profile | More issue types and workflow variants | Automatic SSO/MFA entry |
| Teach via Playwright recorder and guided annotation | Integrated in-browser recorder | Shared hosted SaaS deployment |
| Immutable flow versions and second-issue validation | Optional locally approved AI normalization | Arbitrary generated code execution |
| Paste keys or upload CSV, default maximum 100 unique keys | Scheduling and multi-user administration | Bypassing permissions or validators |
| Read-only preview; selected execution | Controlled parallelism after proven reliability | Automatic rollback or status hopping |
| Field parameters, sequential execution, pause/stop | Rich analytics | Child-issue transitions unless separately requested |
| Reload-based verification; CSV/JSON reports | Additional browsers | Silent mutation retries |

The baseline keeps all normalization local and deterministic. No issue content, screenshots or recordings are sent to an LLM.

## 4. User journey
1. Setup: enter Jira base URL, use installed Google Chrome, check connectivity, open Jira and log in manually.
2. Teach: choose a representative Epic, target status and workflow scope. Read a clear notice that the demonstration changes that real Epic. Start recording after login; manually perform the transition and record a final status assertion.
3. Review: import the raw recording into a constrained flow draft; mark the status reader, issue type reader, discovery steps, first mutation boundary, field parameters and success assertion. Show unsupported or ambiguous actions as blocking findings.
4. Validate: run read-only checks, then explicitly execute the draft on a second representative Epic. Reload and verify target status. Record exact validated project, initial status, issue type and flow version.
5. Prepare: paste keys or upload CSV with an `issueKey` header. Deduplicate and show rejected input; choose the validated flow and field values.
6. Preview: inspect each issue through UI, checking identity, Epic type, scope, current status and visible transition availability. Stop before the mutation boundary. Show eligible, already at target, blocked and needs further execution-time validation.
7. Execute: watch the live Chrome viewport inside the application alongside the current script step and per-Epic results. Select eligible rows and confirm the concrete plan. Recheck each issue, execute sequentially, reload and verify. Pause if login expires or a systemic flow mismatch occurs.
8. Report: review confirmed successes, skips, blocks, failures and uncertain outcomes. Export CSV/JSON; resume only after reconciling interrupted items.

## 5. Screens
| Screen | Main content and controls |
|---|---|
| Dashboard | Session state, active job, recent runs, Teach Workflow, New Bulk Run |
| Connection | Base URL, Chrome availability, Open Login, Check Session, sign-out/profile reset |
| Teach wizard | Sample key, source/target status, recording instructions, import, capture status assertion |
| Flow editor | Ordered steps, locator evidence, field parameters, discovery/mutation boundary, scope, validation findings |
| Validation | Second Epic, read-only result, Execute Test confirmation, reload result, activate version |
| Bulk input | Keys/CSV, selected flow version, shared/per-issue field values |
| Preview | Issue, summary, type, source, target, eligibility, reason, required values, selection |
| Live run | Embedded live Chrome viewport, current Epic and script step, progress, counters, expand preview, pause/resume/stop, login-required state |
| History/detail | Plan and version, event timeline, results, artifacts, CSV/JSON exports |

The UI explains Jira outcomes in business terms. It must show “Outcome uncertain — check Jira” instead of treating a timeout as a definite failure.

## 6. Functional requirements and acceptance criteria
| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-01 | Browser session management | A dedicated profile is reused; SSO expiry requires manual login; only one owner uses the profile. |
| FR-02 | Capture a demonstration | Raw Playwright code and a status assertion are retained after authentication; the UI identifies that teaching is a live Jira update. |
| FR-03 | Normalize a recording | Supported AST statements become constrained actions; unsupported statements block activation; no raw code is evaluated. |
| FR-04 | Review flow meaning | User explicitly confirms transition label, destination status, source-state scope, field values and mutation boundary. |
| FR-05 | Validate a version | A second-issue execution with a different key and reload verification is required for each supported variant before activation. |
| FR-06 | Validate input | Invalid keys and duplicates are reported; CSV is bounded; non-Epics never execute. |
| FR-07 | Preview without updates | Discovery cannot select a potentially immediate transition or submit a dialog. Required fields that cannot be inspected safely are marked unknown. |
| FR-08 | Bind execution to a plan | Confirmation references selected issues, values and immutable version. Changing any of them requires a new preview. |
| FR-09 | Recheck before updating | Identity, type, source state, scope and transition availability are rechecked. Changed conditions block that item. |
| FR-10 | Handle transition fields | User-approved shared or per-issue values fill supported controls. Unknown required fields block; values are never invented. |
| FR-11 | Verify persistence | Success requires independent reload and exact status evidence. Ambiguous results enter reconciliation. |
| FR-12 | Recover safely | Pause acts between items; stop prevents subsequent mutations; no automatic reverse transition; interrupted mutations are reconciled first. |
| FR-13 | Audit and export | Each item has timestamps, from/to, version, result and reason; exports contain all requested keys. |
| FR-14 | Retain artifacts locally | Screenshots/recordings have deletion controls and default retention; authentication secrets stay out of reports and exports. |

| FR-15 | Embedded execution preview | Live Chrome viewport frames appear within the web application during validation and bulk execution; show issue key, step and frame timestamp; stale/disconnected frames are clearly identified. |
| FR-16 | Preview controls | Expand/collapse and fit-to-panel work; preview is view-only; pause/resume/stop control the worker; login is completed in the actual Chrome window. |

## 7. Flow rules
A transition action's label can differ from its destination status. Both are explicitly configured. A status button whose name changes from Ready to Implement cannot be reused as a static Ready locator across all initial states; use a verified stable locator or separately validated variants.

Preview confirms observable eligibility, not all server-side validators. Jira may only reveal required fields or reject business conditions after selecting/submitting a transition. These checks occur during execution, with a clear limitation in the preview.

No automatic intermediate transitions: if Backlog cannot go directly to Done, the item is blocked. No arbitrary fallback clicks when a locator matches multiple elements.

## 7a. Live execution preview
The Live Run screen uses a two-column layout: a large Chrome viewport panel on the left and the current script step, Epic progress and results on the right. Show opening the Epic, menu selection, field entry, submission and verification as execution progresses. Users can expand the viewport and pause/resume/stop from the application.

This is distinct from the pre-execution eligibility preview. The execution panel displays refreshed images of the actual automated Chrome page, rather than embedding Jira directly. Default target refresh is two frames per second, best effort; fast actions may occur between frames. The current step and event timeline remain visible. Authentication displays a placeholder and directs users to the Chrome window. Preview frames are transient and are not saved as a recording.

## 8. Non-functional requirements
- Local-only operation, bound to loopback; network needed only for Jira, SSO and initial dependency installation.
- One active browser job per profile; one issue at a time; refresh of the dashboard does not interrupt the worker.
- Persist item state before and after every possible mutation; preserve completed outcomes across app restart.
- Target workload: 50 Epics; acceptance benchmark with a fixture and a small authorized Jira sample. No fixed throughput guarantee before measuring real Jira latency.
- Progress updates at least every two seconds while active; long-running Jira actions show the current stage.
- Fail closed on ambiguous selectors, unexpected dialogs, identity mismatches and unvalidated variants.
- Authentication profile protected using OS file permissions. Redact secrets; avoid logging full DOM by default.
- Keyboard-accessible UI, readable tables, explicit confirmations for live tests and bulk execution.

## 9. Proposed success measures
Measure baseline manual effort, total elapsed time, user intervention time, confirmed success rate, block reasons and reconciliation count. MVP acceptance: all eligible items in a controlled fixture batch are correctly transitioned and verified; zero incorrect-issue updates; zero duplicate submissions in crash tests; all unsupported cases are clearly reported. Aim for materially lower user effort on a real 40–50 Epic batch after workflow validation.

## 10. Delivery plan
| Phase | Deliverable | Exit condition |
|---|---|---|
| 0 — Jira spike | Inspect sample Epic, controls, dialogs, SSO and Chrome availability | Implement/Done variants and safe discovery boundaries documented |
| 1 — Local shell | Web UI, local server, worker, SQLite, login and fixture Jira | Session lifecycle and single-profile lock work |
| 2 — Teach and validate | Recorder import, flow editor, versioning, second-issue test | At least one live workflow validated; unsupported recordings rejected |
| 3 — Bulk MVP | Input, eligibility preview, live browser preview, confirmations, execution and reports | Fixture batch and small authorized Jira pilot pass |
| 4 — Recovery and packaging | Crash reconciliation, retention, Windows launcher | Recovery tests and 40–50 Epic pilot pass |

Indicative planning estimate: 17–28 engineer working days plus time for corporate setup and Jira access, assuming one developer and one or two workflow variants. Reassess after the spike; live preview tuning, custom Jira widgets and recorder integration can expand effort.

## 11. Open decisions
Confirm Jira edition/version, base URL/context path, exact Implement/Done labels, source states, transition dialogs and mandatory fields, installed Chrome and managed-browser policy. Determine whether policy allows a dedicated automation profile. Select approved sample Epics for live teaching and validation. These determine selectors and variants; they do not prevent building the local shell or fixture tests.

## 12. Implementation handoff
See `TECHNICAL_IMPLEMENTATION_SPEC.md` for architecture, API contracts, flow model, recorder constraints, execution semantics, storage and test plan. This document authorizes planning, not live Jira updates.

## Subsequent implementation extension — 5 October 2026

The user authorized a separate interactive Teach Workflow screen and configurable Epic status transitions. The local fixture release now permits input through the teaching viewport and field editor, emits reviewable/editable Playwright scripts, saves immutable drafts and requires second-Epic validation before bulk use. This extends the earlier view-only teaching assumption; the existing bulk execution viewport remains view-only. Source status, transition label and destination are configured independently. Actual Jira connections remain disabled pending a Jira 9 Data Center adapter and environment validation. See `IMPLEMENTATION_STATUS.md` and the README for supported input/script constraints.
