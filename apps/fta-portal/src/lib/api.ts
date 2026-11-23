// Server-side client for the veri-tax API. Auth is mocked with the X-Officer-Id header.
import { cookies } from "next/headers";

export const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

/** The API could not be reached at all (network error or timeout). */
export class ApiDown extends Error {}
/** The API answered with an error status. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function officerId(): Promise<string | null> {
  return (await cookies()).get("officer")?.value ?? null;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const officer = (await officerId()) ?? "";
  try {
    return await fetch(API_URL + path, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Officer-Id": officer, ...init.headers },
    });
  } catch (e) {
    throw new ApiDown(e instanceof Error ? e.message : "API unreachable");
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await call(path);
  if (!res.ok) throw new ApiError(res.status, await detail(res));
  return res.json() as Promise<T>;
}

/** Like apiGet but returns null on 404. */
export async function apiGetOrNull<T>(path: string): Promise<T | null> {
  const res = await call(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, await detail(res));
  return res.json() as Promise<T>;
}

export async function apiPost(path: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await call(path, { method: "POST", body: JSON.stringify(body) });
  return { ok: res.ok, message: res.ok ? "" : await detail(res) };
}

export async function apiRaw(path: string): Promise<Response> {
  return call(path);
}

async function detail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
