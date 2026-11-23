import { ApiDown, apiRaw, officerId } from "@/lib/api";

// Types a browser can show safely inline. Anything else is downloaded, so an uploaded file never runs on the portal's origin.
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Streams an original document from the API with the officer header, like the CSV exports. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await officerId())) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response("Document not found", { status: 404 });
  let res: Response;
  try {
    res = await apiRaw(`/fta/documents/${id}/file`);
  } catch (e) {
    return new Response(e instanceof ApiDown ? "Can't reach the verification body" : "Could not fetch the document", { status: 503 });
  }
  if (!res.ok || !res.body) return new Response(res.status === 404 ? "Document not found" : `The verification body answered ${res.status}`, { status: res.status === 404 ? 404 : 502 });
  const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  const raw = /filename\*?=(?:utf-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `document-${id}`;
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* plain name */ }
  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `${INLINE.has(type) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  const len = res.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  return new Response(res.body, { headers });
}
