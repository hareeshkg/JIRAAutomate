# Implementation status — 5 October 2026

Target confirmed by the project owner: **Jira v9 Data Center**. Exact minor version and corporate configuration remain unknown. Implementation is intentionally independent of live Jira access.

The initial release provides a functional fixture-driven shell and bulk execution foundation. Built-in fixture identifiers (`fixture-implement-v1`, `fixture-done-v1`) are preserved. Users can also configure status transitions and teach versioned workflows through the embedded preview; all versions remain fixture-scoped. Live connection creation is unavailable rather than accepting unvalidated URLs or selectors.

## Architecture delivered

- `apps/web`: React UI for input, eligibility, confirmation, viewport, results and history.
- `apps/server`: loopback API, local session security, SQLite storage, durable job controls and worker ownership.
- `apps/worker`: separate Chrome/Playwright process, fixture page inspection, sequential execution and reload verification.
- `packages/contracts`: shared types, input/CSV validation, hashing and safe report serialization.
- `fixtures/jira-ui`: persistent simulated issues and direct/modal workflow handlers; independent mutation log for verification.
- `tests`: unit coverage plus isolated real-browser integration, recovery and UI smoke checks.

The server commits worker checkpoints before acknowledging them. The worker awaits that acknowledgement before a possible mutation. SQLite WAL stores canonical plans and durable runs, including event sequences and timestamps. A per-directory owner lock prevents concurrent application instances. A process crash leaves in-flight mutations uncertain; startup never replays them. Read-only reconciliation can confirm the target status, but cannot prove exactly-once external side effects.

## Scope and deviations from the final design

- Runtime uses Node's built-in SQLite module (requires Node 22.13+), avoiding native driver installation for the initial shell.
- One exclusive application owner covers the fixture profile; a general multi-connection lease/heartbeat service remains later work.
- Progress uses one-second polling rather than SSE. Viewport capture is demand-driven, at most one capture in flight, with a single latest frame retained in memory.
- Built-in, configured and recorded workflows are scoped to DEMO. Interactive teaching generates scripts from supported control interactions, and a TypeScript AST allowlist normalizes edited scripts without executing raw code. Validation requires a different Epic for recorded versions.
- Custom transitions preserve source status, transition label and destination separately. The fixture uses the saved transition graph; draft definitions are visible for teaching but unavailable for bulk execution until validation.
- Editing creates new immutable drafts; activation never overwrites an older version. Run exports identify the actual saved version.
- Teaching is an isolated screen. Bulk execution previews remain view-only. Teaching supports image clicks and a field editor; generic keyboard forwarding and arbitrary Jira widgets remain later work.
- No actual Jira connection, credential entry, auth recording, fixture reset UI, LAN exposure or generated-code execution exists.
- Windows installation and managed Chrome policies remain unverified. Local verification uses installed Chrome on macOS.

## Jira 9 context

Atlassian documents Jira 9's dropdown beside the current status and permission-dependent transition availability. The fixture models these interactions and preserves separate transition labels and expected statuses. Exact DOM locators, custom fields and workflow behavior must still be validated against the corporate deployment.

Reference: https://support.atlassian.com/jira/kb/workflow-transition-buttons-are-missing-or-the-error-you-dont-have-permission-to-transition-this-issue-is-displayed-in-jira-data-center/

The original PRD and technical specification remain the full product baseline. This file records delivered scope rather than implying all their acceptance criteria are implemented.

## Verification of teaching and custom transitions

The browser suite retains the original 50-item batch/recovery coverage and adds UI-defined custom transitions, clicks in the embedded teaching image, script edits and AST rejection, immutable draft save, second-Epic validation, custom-label bulk replay and preservation of the built-in workflows. The test suite uses a new data directory and installed Chrome headlessly; normal application jobs remain visible.
