# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once code is released.

## [Unreleased]

### Added

- **veri-tax portal (`web/`, React + TypeScript + Vite)**, served by FastAPI at `/portal`:
  - Supplier portal (EmaraTax): confirmation queue with due dates, the four questions plus the declaration per invoice (corrections kept field by field, retention split check, SC-05 period warning), bulk confirm, and CSV template download and upload with row-by-row checks.
  - FTA dashboard: overview (with agent ratings and officer overrides), applications with URL-held filters, rating counts and CSV export, application detail (per-invoice rating, reasons, fix guidance, trust lane, precedents and approve/reject; rule evidence; submitted-vs-confirmed comparison; application flags; recommended outcome; application decision; audit trail), supplier search and detail with trust lane and registry status, rejections and flags.
  - Maskan simulator that sends full Article 59 particulars, and an applicant status view backed by `GET /maskan/applications/{ref}/status`.
  - Application detail shows the original document (download and extracted fields with confidence), `EX-01`, the compliance agent's second opinion and the reconciliation agent's decision brief; without an agent configured, those buttons say so.
  - Mock sign-in for the demo suppliers and officer, light and dark themes, phone layouts.
- API additions for the portal:
  - `GET /meta/rules`: the rule catalog (title, description, implemented) for every `TI-*`, `EX-*`, `NR-*`, `CS-*` and `SC-*` rule; a test fails if the engine emits a rule the catalog lacks.
  - `POST /supplier/requests/bulk-respond`: several responses in one call, saved all-or-nothing.
  - `/fta/overview` adds new applications (today, 7 and 30 days), invoices by status, approved refunds, pending requests and average response time.
  - `/fta/applications` and the CSV export filter by search text, supplier, failed rule, submission dates and VAT amount; each row lists its failed rules.
  - `/fta/rejections` filters by rating, rule, status, supplier and emirate and includes the application reference; failed rules use each rule's latest result.
  - `/fta/suppliers/{trn}` lists each invoice with its application, failed rules and declared VAT period.
- CI builds and tests the portal.
- **Original documents, Maskan portal and the Groq agent (Suhayl, 23 Nov):**
  - `app/agent.py` now has `GroqAgent`, selected by `AGENT_PROVIDER=groq`. `app/llm.py` is the Groq client: `qwen/qwen3.8-27b` for vision and text, a token cap per call, one call at a time and `429` back-off, which fits the on-demand limit of 1,000 output tokens per minute.
  - Document store and vision extraction (`app/documents.py`): PDF pages render to JPEG at a capped size, files are checked by magic bytes, and jobs are claimed atomically and recovered after a restart.
  - Maskan portal at `/maskan/portal/<token>`, the main entry for pulling invoices in: upload, live tracking, retry.
  - `POST /maskan/invoices/{id}/document` attaches the original to one invoice.
  - Auto-linking by a confidently read TRN and invoice number fills missing Article 59 particulars, then re-runs the rules and the rating through `pipeline.reverify`, which uses the same outcomes as `ingest` and `reconcile`.
  - New rule `EX-01`: Maskan data compared with the original document. `TI-01` also fails on a document that reads as a quotation, proforma or receipt.
  - `NR-05`: an earlier claim of the invoice gives `FAIL`; only later claims give `UNCERTAIN`, so re-running the rules never fails the first claimant. Invoice numbers are normalised ("GSC 77" = "GSC-77"), and same-application repeats count.
  - `SC-03`: a retention answer on a non-retention claim is `UNCERTAIN`.
  - Compliance and reconciliation agents (advisory, stored as `AgentRun`): `POST /fta/invoices/{id}/compliance`, `POST /fta/applications/{id}/summary`.
  - New endpoints: `GET /fta/documents`, `GET /health/llm`, `GET /rules`. Application detail now includes `document`, `extraction` and `agent_runs`.
  - Request status `CANCELLED`, with re-issue and a fresh time limit. Schema version 3.
  - `scripts/eval_invoices.py`: end-to-end evaluation on the 60-invoice answer key. Extraction self-checks added from its findings: a TRN that isn't 15 digits is never trusted, and line items are trusted only when they add up to the taxable amount.
  - `fixtures/invoices/` plus a generator. The seed date is pinned to 2026-09-24. Tests mock the LLM and each module gets a fresh database.
- **Rating and officer control (Claude for Mwr, 23 Nov, ruleset `2026.11-1`):**
  - Every invoice is rated `STRONG`, `WEAK` or `FAIL` with reasons (`app/assessment.py`). New invoice fields: `rating`, `rating_reasons`, `fix_guidance`, `officer_decision`, `suggested_eligible_vat`.
  - `POST /fta/invoices/{id}/decision`: the officer approves or rejects one invoice. Each decision is stored with the agent's rating and shown as a precedent on later invoices with the same findings.
  - `GET /maskan/applications/{ref}/status`: the applicant's view, with what would make each invoice strong and no supplier tax data.
  - `POST /fta/requests/expire-overdue`: closes supplier requests past the time limit (also runs when the dashboard loads).
  - New rules: `TI-02`, `TI-04`, `TI-05`, `TI-08`, `TI-09` (full vs simplified tax invoice, Article 59), `NR-03`, `NR-06`, `CS-01` to `CS-04` (common-sense checks on values).
  - `app/eligibility.py`: the VATGRH1 June 2026 Appendix 1 catalogue for `NR-02`, including the items added from 1 January 2026, checked line by line.
  - Supplier trust lane (`TRUSTED`, `STANDARD`, `WATCH`) on supplier and application responses.
  - `app/agent.py`: interface for the reasoning agent. Not wired to a model yet.
  - Seed data now has 8 suppliers and 14 invoices covering every rating; tests for all of the above.

### Changed

- Officer application decisions are also checked for sign: a rejection approves AED 0 and an approval needs an amount above 0.
- The application audit trail now includes supplier responses (they were logged against the request and never returned).
- **Nothing is rejected automatically.** A failed rule now gives a `FAIL` rating and status `FLAGGED` for the officer. `AUTO_REJECTED` stays in the enum but is no longer set.
- **Supplier time limit is 5 business days** (was 14 days and never enforced). After it, the invoice is `NO_SUPPLIER_RESPONSE`, rated `WEAK`, and the application can still be decided.
- **Duplicates flag both claims.** The later claim fails `NR-05`; the earlier claim of the same invoice is marked `UNCERTAIN` and rated `WEAK`.
- `TI-03` now checks the FTA registry (mock): the supplier must exist and be active on the invoice date, not only have a well-formed TRN.
- `NR-02` no longer uses a keyword list; ambiguous items (CCTV, intelligent lighting), mixed invoices and unrecognised descriptions go to a person.
- Emirates IDs are stored as a keyed hash (`ID_HASH_KEY`) instead of an unsalted SHA-256.
- Application decisions are refused if the approved amount is more than the VAT claimed.
- README updated to the June 2026 guide.

### For the frontends

- All existing response fields are unchanged; the new ones are additions. Existing status values still apply.
- Local SQLite files from the old schema are rebuilt on start. No action needed.
- Send the new invoice fields on ingest where you have them (`recipient_name`, `recipient_address`, `supplier_address`, `line_items`, `invoice_type`). An invoice without them is rated `WEAK`, not failed.

### Added earlier

- **v0.1 verification body API (FastAPI + SQLModel, SQLite by default):**
  - `POST /maskan/applications` ingests an application and its invoices, runs the rule engine and opens supplier confirmation requests.
  - Rule engine `2026.11-0`: `TI-01`, `TI-03`, `TI-06`, `TI-07`, `NR-01`, `NR-02`, `NR-04`, `NR-05`, `SC-01`–`SC-05`.
  - `/supplier/*` for the EmaraTax portal: list requests, view one, respond (the 4 questions plus the declaration), with reconciliation on response.
  - `/fta/*` for the FTA dashboard: overview, applications, application detail with the audit trail, officer decision, supplier search and detail, rejections, CSV export.
  - Append-only audit events, synthetic seed data, an end-to-end test and GitHub Actions CI.
  - `CONTRIBUTING.md` with the branch and PR workflow.

- `README.md` now sets out the full design of the veri-tax verification body:
  - End-to-end flow: Maskan → verification body → supplier portal (EmaraTax) → reconciliation → FTA dashboard, with sequence and component diagrams.
  - Components: Maskan ingestion, OCR and extraction agents, the versioned rule engine, the compliance agent, the supplier request service, the reconciliation agent, the FTA dashboard and the audit log.
  - The starting rule set: tax invoice validity (`TI-01`–`TI-08`), New Residence refund eligibility (`NR-01`–`NR-07`) and supplier confirmation and reconciliation (`SC-01`–`SC-06`).
  - The supplier confirmation flow: invoice issued, particulars match, consideration received or retention, and the VAT return period declared.
  - FTA dashboard scope: overview metrics, supplier search and detail (applications per supplier, approximate refunds per supplier), rejected suppliers, rejected refunds, application detail, filters and export.
  - Invoice and application status lifecycles, the core data model, the planned repository layout, security and audit principles, the roadmap, open questions and references.
- `CHANGELOG.md` (this file).

## [0.0.0] - initial commit

### Added

- Initial repository with a placeholder `README.md`.
