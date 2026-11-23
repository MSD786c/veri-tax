# fta-portal

The FTA officer portal for veri-tax, in Next.js (App Router). Every page is a server component rendered from the live API, so search, filters, paging, drawers and the approve/reject forms are plain links and forms that also work with JavaScript switched off.

Pages: dashboard, verifications, applications, invoices, entities, reports, audit trail, settings, check status and verify invoice. Charts come from `GET /fta/analytics`.

```bash
# API (repo root)
uv run uvicorn app.main:app --port 8000

# portal
cd apps/fta-portal
cp .env.example .env.local      # API_URL=http://127.0.0.1:8000
pnpm install
pnpm dev                        # http://localhost:3002
```

Sign in with any work email (`name@fta.gov.ae`). The first two letters become the officer ID sent as `X-Officer-Id`. Auth is mocked, like the API.

`pnpm lint` and `pnpm build` must stay clean.
