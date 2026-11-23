# Fixture invoices

Synthetic files to upload through the upload link (`/u/<token>`). All names, TRNs and addresses are fake.
They come from `app/seed.py`, so seed the DB first (`uv run python -m app.seed`).

Regenerate: `uv run python scripts/make_fixture_invoices.py`

| File | What it tests |
|---|---|
| `MSK-2026-000N_<invoice no>.png` | One per seeded invoice. TRN, number, date, amounts, plot and description match the seed, so it should auto-link and EX-01 should pass |
| `MSK-2026-0002_GSC-80.png` | Prints VAT 2,500 on 40,000 (the seed's wrong-VAT case), so it matches Maskan but TI-07 (VAT arithmetic) should fail |
| `MSK-2026-0001_ANB-1001.png`, `MSK-2026-0003_ANB-1001.png` | Same supplier and invoice number on two applications (the NR-05 duplicate case). The only differences are the plot and the recipient |
| `MSK-2026-0003_DRE-530_2page.pdf` | 2-page PDF: header on page 1, totals on page 2 (tests PDF conversion and reading more than one page) |
| `QUOTATION_DRE-Q-2026-118.png` | Titled "Quotation", with a number that matches no seeded invoice. Should be classed as QUOTATION and stay unlinked |

Invoice dates come from the fixed `COMPLETION` date in `app/seed.py` (2026-09-24). If that date changes, run the script again.
