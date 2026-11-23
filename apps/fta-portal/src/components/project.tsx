import { APP_STATUS } from "@/lib/data";
import { nice } from "@/lib/format";
import type { Project } from "@/lib/types";
import { Badge } from "./ui";

const ringColor = (p: number) => (p >= 60 ? "#1c9b6c" : p >= 25 ? "#d6a21f" : "#d93a52");
export const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
export const projectHref = (permit: string) => `/projects/${encodeURIComponent(permit)}`;
export const statusBadge = (s: string) => { const [l, t] = APP_STATUS[s] ?? [nice(s), "neutral" as const]; return <Badge kind={t}>{l}</Badge>; };

export function Ring({ pct }: { pct: number }) {
  return (
    <svg className="ring" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${pct}% eligible`}>
      <circle cx="32" cy="32" r="25" fill="none" stroke="#efe9d8" strokeWidth="7" />
      <circle cx="32" cy="32" r="25" fill="none" stroke={ringColor(pct)} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${((pct / 100) * 157.08).toFixed(1)} 157.08`} transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle" className="ring-n">{pct}%</text>
    </svg>
  );
}

export function RatingCounts({ p }: { p: Project }) {
  const r = p.invoices_by_rating ?? { STRONG: 0, WEAK: 0, FAIL: 0, PENDING: 0 };
  return <span>{r.STRONG ?? 0} strong · {r.WEAK ?? 0} weak · {r.FAIL ?? 0} fail · {r.PENDING ?? 0} pending</span>;
}
