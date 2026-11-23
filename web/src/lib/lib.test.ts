import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTemplate, parseBulkCsv } from "./bulkCsv.ts";
import { parseCsv, toCsv } from "./csv.ts";
import { aedCompact, dueLabel, fmtDate, parseUtc } from "./format.ts";
import { isValidPeriod, periodEndsBeforeInvoice, periodOptions } from "./periods.ts";

test("csv round-trips quotes, commas and newlines", () => {
  const rows = [["a", 'say "hi"', "x,y"], ["line\nbreak", "", "3"]];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
  assert.deepEqual(parseCsv("﻿a,b\r\n1,2\r\n\r\n"), [["a", "b"], ["1", "2"]]);
});

test("csv neutralises spreadsheet formulas but keeps negative numbers", () => {
  assert.equal(toCsv([["=SUM(A1)", "-12.5", "@x"]]), "'=SUM(A1),-12.5,'@x\r\n");
});

test("periods: validity, SC-05 mirror and options", () => {
  assert.ok(isValidPeriod("2026-Q2") && isValidPeriod("Apr-2026"));
  assert.ok(!isValidPeriod("2026-Q5") && !isValidPeriod("Abc-2026") && !isValidPeriod("april 2026"));
  assert.equal(periodEndsBeforeInvoice("2026-Q1", "2026-04-10"), true);
  assert.equal(periodEndsBeforeInvoice("2026-Q2", "2026-04-10"), false);
  assert.equal(periodEndsBeforeInvoice("Mar-2026", "2026-04-10"), true);
  assert.deepEqual(periodOptions("quarterly", "2026-04-10", "2026-11-23"), ["2026-Q4", "2026-Q3", "2026-Q2", "2026-Q1", "2025-Q4"]);
  assert.deepEqual(periodOptions("monthly", "2026-01-15", "2026-02-01"), ["Feb-2026", "Jan-2026", "Dec-2025", "Nov-2025", "Oct-2025"]);
});

test("format helpers", () => {
  assert.equal(aedCompact(4_200_000), "AED 4.2M");
  assert.equal(aedCompact(12_900), "AED 12.9K");
  assert.equal(aedCompact(1284), "AED 1,284");
  assert.equal(fmtDate("2026-03-01"), "1 Mar 2026");
  assert.equal(parseUtc("2026-03-01T10:00:00").toISOString(), "2026-03-01T10:00:00.000Z");
  const now = new Date("2026-11-23T00:00:00Z");
  assert.equal(dueLabel("2026-11-26T00:00:00", now), "Due in 3 days");
  assert.equal(dueLabel("2026-11-21T00:00:00", now), "Overdue by 2 days");
});

test("bulk CSV: template parses back, blanks skip, bad rows explain themselves", () => {
  const template = buildTemplate([
    { request_id: 7, invoice_no: "INV-1", invoice_date: "2026-03-01", applicant: "A, B", total: 1050 },
    { request_id: 8, invoice_no: "INV-2", invoice_date: "2026-03-02", applicant: "C", total: 2100 },
  ]);
  const blankRun = parseBulkCsv(template, new Set([7, 8]));
  assert.equal(blankRun.fileError, null);
  assert.ok(blankRun.rows.every((r) => r.skipped && !r.errors.length));

  const header = "request_id,invoice_no,issued,particulars_match,consideration,amount_received,received_date,retention_amount,retention_release_date,vat_return_period";
  const csv = [
    header,
    "7,INV-1,yes,yes,received,1050,2026-03-20,,,2026-Q1",
    "8,INV-2,yes,yes,retention,1900,,200,2027-01-31,Mar-2026",
    "9,INV-3,no,,,,,,,",
    "7,INV-1,yes,no,received,,2026-02-30,,,2026-Q9",
  ].join("\n");
  const { rows } = parseBulkCsv(csv, new Set([7, 8]));
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].answer?.consideration_status, "RECEIVED");
  assert.equal(rows[0].answer?.received_date, "2026-03-20");
  assert.equal(rows[1].answer?.retention_amount, 200);
  assert.equal(rows[1].answer?.vat_return_period, "Mar-2026");
  assert.deepEqual(rows[2].errors, ["not one of your pending requests"]);
  assert.equal(rows[2].answer, null);
  assert.equal(rows[3].answer, null);
  assert.deepEqual(rows[3].errors, [
    "request listed twice",
    "particulars differ: answer this invoice on its own page so you can enter corrections",
    "received_date must be a date (YYYY-MM-DD)",
    "vat_return_period must look like 2026-Q2 or Apr-2026",
  ]);

  assert.match(parseBulkCsv("request_id,issued\n1,yes", new Set([1])).fileError ?? "", /Missing columns/);
});
