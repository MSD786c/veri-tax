import { officerId } from "@/lib/api";
import { loadAll } from "@/lib/data";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET() {
  if (!(await officerId())) return new Response("Sign in first", { status: 401 });
  const { invoices } = await loadAll();
  const head = ["id", "application", "invoice_no", "supplier_trn", "supplier", "invoice_date", "taxable_amount", "vat_amount", "eligible_vat", "rating", "status"];
  const rows = invoices.map((i) => [i.id, i.app.maskan_ref, i.invoice_no, i.supplier_trn, i.supplier_name, i.invoice_date, i.taxable_amount, i.vat_amount, i.eligible_vat_amount, i.rating ?? "", i.status_ui]);
  return new Response("﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=invoices.csv" },
  });
}
