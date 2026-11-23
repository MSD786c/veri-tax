"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiPost, officerId } from "@/lib/api";

// Server Actions are plain form POSTs, so every decision works with JavaScript switched off.

const flash = (url: string, msg: string) => `${url}${url.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`;
const safeBack = (p: string, fallback: string) => (["/verifications", "/applications"].includes(p) ? p : fallback);

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) redirect(`/login?error=${encodeURIComponent("Enter your work email, for example name@fta.gov.ae")}`);
  const initials = (email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 2) || "AK").toUpperCase();
  (await cookies()).set("officer", initials, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/dashboard");
}

export async function logoutAction() {
  (await cookies()).delete("officer");
  redirect("/login");
}

export async function decideApplicationAction(formData: FormData) {
  if (!(await officerId())) redirect("/login");
  const id = Number(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const amount = Number(formData.get("approved_amount") ?? 0);
  const r = await apiPost(`/fta/applications/${id}/decision`, {
    decision: approve ? "APPROVED" : "REJECTED", approved_amount: approve ? amount : 0, comments: String(formData.get("comments") ?? ""),
  });
  redirect(flash(`/applications?open=${id}`, r.ok ? "Application decided." : `Not saved: ${r.message}`));
}

export async function decideInvoiceAction(formData: FormData) {
  if (!(await officerId())) redirect("/login");
  const id = Number(formData.get("id"));
  const r = await apiPost(`/fta/invoices/${id}/decision`, {
    decision: formData.get("decision") === "approve" ? "APPROVED" : "REJECTED", comment: String(formData.get("comment") ?? ""),
  });
  const back = safeBack(String(formData.get("back_to") ?? ""), "/verifications");
  redirect(flash(`${back}?open=${id}`, r.ok ? "Invoice decision saved." : `Not saved: ${r.message}`));
}
