# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once code is released.

## [Unreleased]

### Added

- **veri-tax portal (`web/`, React + TypeScript + Vite)**, served by FastAPI at `/portal`:
  - Supplier portal (EmaraTax): confirmation queue with due dates, the four questions plus the declaration per invoice (corrections kept field by field, retention split check, SC-05 period warning), bulk confirm, and CSV template download and upload with row-by-row checks.
  - FTA dashboard: overview, applications with URL-held filters and CSV export, application detail with rule evidence, submitted-vs-confirmed comparison, recommended outcome, officer decision and audit trail, supplier search and detail, rejections.
  - Maskan simulator for submitting test applications.
  - Mock sign-in for the demo suppliers and officer, light and dark themes, phone layouts.
- API additions for the portal:
  - `GET /meta/rules`: the rule catalog (title, description, implemented) for every `TI-*`, `NR-*` and `SC-*` rule.
  - `POST /supplier/requests/bulk-respond`: several responses in one call, saved all-or-nothing.
  - `/fta/overview` adds new applications (today, 7 and 30 days), invoices by status, approved refunds, pending requests and average response time.
  - `/fta/applications` and the CSV export filter by search text, supplier, failed rule, submission dates and VAT amount; each row lists its failed rules.
  - `/fta/rejections` filters by rule, status, supplier and emirate and includes the application reference.
  - `/fta/suppliers/{trn}` lists each invoice with its application, failed rules and declared VAT period.
- CI builds and tests the portal.

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

### Changed

- Officer decisions are checked: a rejection approves AED 0, an approval needs an amount above 0, and no decision may approve more than the VAT claimed.
- The application audit trail now includes supplier responses.

## [0.0.0] - initial commit

### Added

- Initial repository with a placeholder `README.md`.
