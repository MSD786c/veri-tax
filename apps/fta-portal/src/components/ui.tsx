import Link from "next/link";
import type { ReactNode } from "react";
import { qs } from "@/lib/format";
import type { InvStatus, Tone } from "@/lib/types";

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  shield: "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z",
  doc: "M7 3h8l4 4v14H7z M15 3v4h4 M10 12h6 M10 16h6",
  file: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  building: "M4 21V5l8-2v18 M12 9l8 2v10 M2 21h20 M8 9h1 M8 13h1 M8 17h1 M16 14h1 M16 18h1",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  log: "M9 4h6v3H9z M7 5H5v16h14V5h-2 M9 12h6 M9 16h6",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.3-4.3",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4",
  check: "M5 12.5l4.5 4.5L19 7",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2",
  x: "M6 6l12 12 M18 6L6 18",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  chevron: "M6 9l6 6 6-6",
  chevr: "M9 6l6 6-6 6",
  chevl: "M15 6l-6 6 6 6",
  down: "M12 4v12 M7 11l5 5 5-5 M5 20h14",
  scan: "M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M8 12h8",
  plus: "M12 5v14 M5 12h14",
  logout: "M10 4H5v16h5 M15 8l4 4-4 4 M19 12H9",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  mail: "M3 6h18v12H3z M3 7l9 6 9-6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6",
  lock: "M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3",
  folder: "M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  spark: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M6 18l2.5-2.5 M15.5 8.5 18 6",
  pin: "M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
};

export function Icon({ n, s = 20 }: { n: string; s?: number }) {
  return (
    <svg className="ic" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[n] ?? ICONS.doc} />
    </svg>
  );
}

export function Badge({ kind, children }: { kind: Tone | InvStatus; children: ReactNode }) {
  const k = kind === "pending" ? "neutral" : kind;
  const ic = k === "approved" ? "check" : k === "referred" ? "clock" : k === "rejected" ? "x" : null;
  return <span className={`badge ${k}`}>{ic && <Icon n={ic} s={13} />}{children}</span>;
}

export function RatingBadge({ s }: { s: InvStatus }) {
  const label = { approved: "Strong", referred: "Weak", rejected: "Fail", pending: "Pending" }[s];
  return <Badge kind={s}>{label}</Badge>;
}

export function Pager({ p, pages, current, path }: { p: number; pages: number; current: Record<string, string>; path: string }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      {p > 1 ? <Link className="icon-btn" href={`${path}?${qs(current, { page: p - 1 })}`} aria-label="Previous page"><Icon n="chevl" s={16} /></Link> : <span className="icon-btn" aria-disabled="true" style={{ opacity: 0.35 }}><Icon n="chevl" s={16} /></span>}
      <span>Page {p} of {pages}</span>
      {p < pages ? <Link className="icon-btn" href={`${path}?${qs(current, { page: p + 1 })}`} aria-label="Next page"><Icon n="chevr" s={16} /></Link> : <span className="icon-btn" aria-disabled="true" style={{ opacity: 0.35 }}><Icon n="chevr" s={16} /></span>}
    </nav>
  );
}

export function PageHead({ title, lead, actions }: { title: string; lead: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-h">
      <div><h1>{title}</h1><p className="lead">{lead}</p></div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ title, text, icon = "search", clear }: { title: string; text: string; icon?: string; clear?: string }) {
  return (
    <div className="empty">
      <span className="empty-ic"><Icon n={icon} s={26} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {clear && <Link className="btn soft md" href={clear}><span>Clear filters</span></Link>}
    </div>
  );
}

export function SearchBox({ value, placeholder, name = "q" }: { value: string; placeholder: string; name?: string }) {
  return (
    <label className="search-in"><Icon n="search" s={17} /><input name={name} defaultValue={value} placeholder={placeholder} aria-label={placeholder} /></label>
  );
}

export function Seg({ name, value, options, label }: { name: string; value: string; options: [string, string][]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, l]) => <button key={k} name={name} value={k} className={value === k ? "on" : ""}>{l}</button>)}
    </div>
  );
}

export function Timeline({ items }: { items: { title: string; sub?: string; at: string }[] }) {
  return (
    <ol className="timeline">
      {items.map((i, k) => <li key={k} className="on"><b>{i.title}</b>{i.sub && <span>{i.sub}</span>}<time>{i.at}</time></li>)}
    </ol>
  );
}
