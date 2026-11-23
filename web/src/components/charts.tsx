// Small, dependency-free charts for the FTA overview. Specs follow the portal's dataviz rules:
// one hue for ranked bars (thin, 4px rounded data-end, square at the baseline), a tall segmented
// bar for one whole split into status parts (legend + icons, so colour never works alone), and a
// per-mark tooltip on hover and keyboard focus that repeats values also printed as text.
import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Tone } from "../lib/status.ts";
import { ToneIcon } from "./ui.tsx";

interface TipState {
  x: number;
  y: number;
  value: string;
  label: string;
}

function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const at = (e: MouseEvent | FocusEvent, value: string, label: string) => {
    if ("clientX" in e) setTip({ x: e.clientX, y: e.clientY, value, label });
    else {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, value, label });
    }
  };
  const node = tip && (
    <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }} role="presentation">
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  );
  return { at, hide: () => setTip(null), node };
}

export interface BarRow {
  key: string;
  label: ReactNode;
  /** Plain-text name for the tooltip and accessible label. */
  name: string;
  sub?: ReactNode;
  value: number;
  to?: string;
}

export function BarList({ rows, format = String, empty = "No data yet" }: {
  rows: BarRow[];
  format?: (n: number) => string;
  empty?: string;
}) {
  const { at, hide, node } = useTooltip();
  const max = Math.max(0, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!rows.length || max === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="bar-list" onMouseLeave={hide}>
      {rows.map((r) => {
        const share = total ? Math.round((r.value / total) * 100) : 0;
        const tipLabel = `${r.name} · ${share}% of total`;
        const body = (
          <>
            <span className="bar-name">
              {r.label}
              {r.sub && <span className="bar-sub">{r.sub}</span>}
            </span>
            <span className="bar-track" aria-hidden="true">
              {r.value > 0 && <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />}
            </span>
            <span className="bar-value">{format(r.value)}</span>
          </>
        );
        const handlers = {
          onMouseMove: (e: MouseEvent) => at(e, format(r.value), tipLabel),
          onFocus: (e: FocusEvent) => at(e, format(r.value), tipLabel),
          onBlur: hide,
          "aria-label": `${r.name}: ${format(r.value)}`,
        };
        return r.to ? (
          <Link key={r.key} to={r.to} className="bar-row bar-row-link" {...handlers}>
            {body}
          </Link>
        ) : (
          <div key={r.key} className="bar-row" tabIndex={0} {...handlers}>
            {body}
          </div>
        );
      })}
      {node}
    </div>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

/** One whole split into <= 6 status parts. Shares print inside a block only when they fit. */
export function SegmentedBar({ parts, unit }: { parts: Segment[]; unit: string }) {
  const { at, hide, node } = useTooltip();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="muted">No {unit} yet</p>;
  const gaps = (shown.length - 1) * 2;
  return (
    <div className="segmented">
      <div
        ref={ref}
        className="segmented-bar"
        role="img"
        aria-label={shown.map((p) => `${p.label}: ${p.value} ${unit}`).join(", ")}
        onMouseLeave={hide}
      >
        {shown.map((p) => {
          const share = p.value / total;
          const px = share * Math.max(0, width - gaps);
          const text = `${Math.round(share * 100)}%`;
          const fits = px >= text.length * 8 + 14;
          const tip = `${p.value} ${unit} · ${text}`;
          return (
            <span
              key={p.key}
              className={`segment fill-${p.tone}`}
              style={{ flexGrow: p.value }}
              tabIndex={0}
              aria-label={`${p.label}: ${p.value} ${unit}, ${text}`}
              onMouseMove={(e) => at(e, tip, p.label)}
              onFocus={(e) => at(e, tip, p.label)}
              onBlur={hide}
            >
              {fits && text}
            </span>
          );
        })}
      </div>
      <ul className="legend">
        {shown.map((p) => (
          <li key={p.key}>
            <span className={`swatch fill-${p.tone}`} aria-hidden="true" />
            <ToneIcon tone={p.tone} />
            <span>{p.label}</span>
            <span className="legend-value">{p.value}</span>
          </li>
        ))}
      </ul>
      {node}
    </div>
  );
}

/** A single ratio against its whole: fill on a lighter track of the same hue. */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const v = value === null ? 0 : Math.min(1, Math.max(0, value));
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <span className="meter-fill" style={{ width: `${v * 100}%` }} />
    </div>
  );
}
