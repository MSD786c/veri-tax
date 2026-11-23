import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useRules } from "../lib/rules.tsx";
import type { Tone } from "../lib/status.ts";
import type { RuleOutcome } from "../api/types.ts";
import { statusInfo } from "../lib/status.ts";

const ICON_PATHS: Record<Tone, ReactNode> = {
  good: <path d="M3.5 8.5l3 3 6-7" />,
  warning: (
    <>
      <path d="M8 3.5v5.5" />
      <path d="M8 12v.5" />
    </>
  ),
  serious: (
    <>
      <path d="M8 3.5v5.5" />
      <path d="M8 12v.5" />
    </>
  ),
  critical: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  info: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 5.5V8l1.8 1.2" />
    </>
  ),
  neutral: <path d="M4.5 8h7" />,
};

export function ToneIcon({ tone }: { tone: Tone }) {
  return (
    <svg className={`tone-icon tone-${tone}`} viewBox="0 0 16 16" aria-hidden="true">
      {ICON_PATHS[tone]}
    </svg>
  );
}

export function Chip({ tone, label, hint }: { tone: Tone; label: string; hint?: string }) {
  return (
    <span className={`chip chip-${tone}`} title={hint}>
      <ToneIcon tone={tone} />
      {label}
    </span>
  );
}

/** A rule ID with its catalog title on hover; tinted by outcome when one is given. */
export function RuleChip({ id, outcome }: { id: string; outcome?: RuleOutcome }) {
  const { rule } = useRules();
  const info = rule(id);
  const tone = outcome ? statusInfo.rule(outcome).tone : "neutral";
  return (
    <span className={`rule-chip chip-${tone}`} title={info ? `${info.title}: ${info.description}` : id}>
      {outcome && <ToneIcon tone={tone} />}
      {id}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, back, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      {back && (
        <Link className="back-link" to={back.to}>
          ← {back.label}
        </Link>
      )}
      <div className="page-header-row">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className = "", flush = false }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`card ${flush ? "card-flush" : ""} ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">
        {tone && <ToneIcon tone={tone} />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Field({ label, hint, error, children, htmlFor }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={`field ${error ? "field-error" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export function Banner({ tone, title, children }: { tone: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "critical" ? "alert" : "status"}>
      <ToneIcon tone={tone} />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: Error | undefined | null }) {
  if (!error) return null;
  return (
    <Banner tone="critical" title="Something went wrong">
      {error.message}
    </Banner>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

/** Horizontally scrollable table wrapper; dims while a refetch is in flight. */
export function TableWrap({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return <div className={`table-wrap ${busy ? "is-busy" : ""}`}>{children}</div>;
}
