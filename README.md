# Jira Bulk Transition

A local workflow application targeting **Jira 9 Data Center**, developed independently of corporate Jira access. This release runs exclusively against a local Jira-like fixture using real Playwright browser automation. It cannot connect to or update corporate Jira.

## Run

Prerequisites: Node.js 22.13+ (Node 24 LTS recommended), npm, and installed Google Chrome. No Playwright browser download is needed; automation uses the installed Chrome channel. Windows is the deployment target; this foundation was verified on macOS and still needs a Windows smoke test.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3210**. Development mode serves React through Vite. The worker opens a separate visible Chrome window when preview or execution starts.

Production build and local start:

```sh
npm run build
npm start
```

`PORT` overrides 3210. `DATA_DIR` overrides the application data directory. By default data lives in `%LOCALAPPDATA%\JiraBulk` on Windows or `~/.jira-bulk` elsewhere. Only one application can own a data directory. Close Chrome normally through the application worker; do not reuse your everyday Chrome profile.

The fixture seeds DEMO-1 through DEMO-60 on first start. It persists status changes across restarts. Use a **new DATA_DIR** for a fresh dataset; there is no reset button that can erase history by mistake.

## Try it

1. Leave the sample input and choose Implement. Preview opens Chrome and reads eligibility.
2. Select eligible Epics and confirm the concrete local fixture plan.
3. Watch the viewport and per-issue results. Export CSV or JSON from the results panel.
4. Choose Done and preview issues that successfully reached Implement. This transition requires the approved Resolution value Done and uses a dialog.
5. Use DEMO-11 through DEMO-60 for a normal 50-Epic batch.

Fixture scenarios:

| Issue | Scenario |
|---|---|
| DEMO-3 | Starts at Implement |
| DEMO-4 | Unsupported Backlog source |
| DEMO-5 | Story instead of Epic |
| DEMO-6 | Starts at Done |
| DEMO-7 | Transition permission denied |
| DEMO-8 | Unknown required field on Done transition |
| DEMO-9 | Update persists before a delayed HTTP response |
| DEMO-10 | Login expiry page |

The fixture approximates Jira 9 status-dropdown interactions; it is not a replica or compatibility certification. Built-in, configured and recorded workflow versions all apply only to DEMO issues in this release. Corporate Jira workflows, plugins, permissions, SSO and mandatory fields require later discovery and validation.

## Custom statuses and teaching

**Status transitions** is a separate screen for defining source status, transition label, destination status and immediate/dialog behavior. For example: `Ready` → `In Review`, using the label `Send for review`. Definitions are saved as immutable drafts and added to the local fixture's transition graph. They do not reconfigure corporate Jira. Validate a definition on a fixture Epic before choosing it in the existing **Prepare batch** screen. Built-in Implement/Done workflows remain available.

**Teach Workflow** is a separate feature:

1. Select a workflow definition and an eligible sample Epic such as DEMO-11. Confirm that teaching changes that sample.
2. Start teaching. Click controls inside the refreshed Chrome image to open the status menu and select the intended transition. Actions in the separate Chrome window are not recorded by this feature.
3. For a dialog field, click the field in the image and use the app's field editor to select/type its value. Apply the value, then click the submit control in the image.
4. Finish recording. The app reloads the sample and displays its persisted status.
5. Review and edit the generated Playwright spec; confirm the field values and first mutation boundary, then save a workflow draft.
6. Validate on a different sample Epic such as DEMO-12. Only a successful reload-verified result activates the version for bulk selection.

Scripts accept a bounded AST subset: the generated test wrapper, literal issue navigation, exact supported locators, click/fill/selectOption, and a final reload/status assertion. Unsupported code receives a line-numbered error. Edited JavaScript is never evaluated. Saving changes produces a new draft version; existing validated versions and plans stay intact. Downloaded scripts are review artifacts; external execution requires separate baseURL/authentication setup for the protected fixture.

The teaching viewer supports clicking and explicit form editing, not arbitrary keyboard shortcuts or interaction with every custom Jira widget. Coordinates are tied to a fresh frame and supported controls must have unique locators. One worker/profile is shared, so teaching and bulk execution cannot run concurrently.

## Implemented

- React/TypeScript UI and Fastify API bound to IPv4 loopback.
- Separate Playwright worker with dedicated persistent Chrome profile and exclusive application ownership.
- Bounded keys/CSV input; explicit duplicates and rejected input; Epic/source/transition checks.
- Read-only eligibility preview and 15-minute immutable plans with version/value binding.
- Custom source/label/destination definitions, interactive teaching, constrained script editing and second-Epic validation.
- Selected execution confirmation, server-side eligibility validation, and request idempotency.
- Sequential execution with durable SQLite mutation intent before every potentially mutating action.
- Independent reload and exact issue/status verification; uncertain outcomes never blindly retry.
- Pause/resume/stop between items, interrupted-run recovery, read-only reconciliation.
- Refusal to execute issues with unresolved outcomes from prior runs.
- View-only JPEG viewport with item/step/timestamp metadata; bounded transient frames and stale display.
- Persistent per-issue results, event timeline, formula-safe CSV and JSON exports.
- Local session cookie, CSRF validation, Host/Origin checks, guarded fixture endpoints and no LAN binding.

## Remaining milestones

This is the initial implementation, not the full PRD delivery. Next work includes a Jira 9 adapter, richer widget/keyboard support, standalone recorder import, real manual-login/session lifecycle, sensitive-field masks, artifacts/retention, richer fixture widgets, SSE progress, Windows packaging and operator acceptance testing. Progress currently uses polling; scripts and workflow definitions are stored locally; screenshots are transient.

The fixture login-expiry case is blocked during preview. Re-authentication into actual Jira is deliberately unavailable. Unknown fields after a mutation boundary produce an uncertain result and require reconciliation/manual review. A status read cannot prove that other transition side effects did not occur.

## Verify

```sh
npm run build
npm test
npm run test:e2e
```

The E2E suite uses installed Chrome **headlessly for tests only**, starts an isolated local server and data directory, and exercises preview mutation counts, direct/modal transitions, delayed responses, idempotency, pause/resume/stop, a 50-item batch, crash recovery, reconciliation, exports, local access guards and the rendered UI. Test output prints the temporary artifact directory. Normal application execution remains headed.

See [PRD](docs/PRD.md), [technical design](docs/TECHNICAL_IMPLEMENTATION_SPEC.md), and [implementation status](docs/IMPLEMENTATION_STATUS.md).
