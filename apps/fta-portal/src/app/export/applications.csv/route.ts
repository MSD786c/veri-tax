import { apiRaw, officerId } from "@/lib/api";

export async function GET() {
  if (!(await officerId())) return new Response("Sign in first", { status: 401 });
  const r = await apiRaw("/fta/export/applications.csv");
  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=applications.csv" },
  });
}
