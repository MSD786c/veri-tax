import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { todayIso } from "../lib/format.ts";

/** Filter state lives in the URL, so a filtered view can be linked to, bookmarked and exported. */
export function useFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ""])) as Record<K, string>;
  const set = (patch: Partial<Record<K, string>>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch) as [K, string][]) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const active = keys.some((k) => values[k]);
  return { values, set, clear, active };
}

export function FilterBar({ children, onClear, active }: { children: ReactNode; onClear: () => void; active: boolean }) {
  return (
    <div className="filter-bar" role="search">
      {children}
      {active && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}

const PRESETS = [
  ["", "Any time"],
  ["0", "Today"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
] as const;

function daysAgo(days: number): string {
  return todayIso(new Date(Date.now() - days * 86_400_000));
}

/** Date-range control: presets first, a custom range behind them. */
export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const preset = !to ? PRESETS.find(([d]) => d !== "" && from === daysAgo(Number(d)))?.[0] : undefined;
  const mode = !from && !to ? "" : (preset ?? "custom");
  return (
    <div className="date-range">
      <select
        aria-label="Submitted"
        value={mode}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") onChange(from || daysAgo(30), to || todayIso());
          else onChange(v === "" ? "" : daysAgo(Number(v)), "");
        }}
      >
        {PRESETS.map(([v, label]) => (
          <option key={v} value={v}>
            {v === "" ? "Submitted: any time" : `Submitted: ${label.toLowerCase()}`}
          </option>
        ))}
        <option value="custom">Custom range…</option>
      </select>
      {mode === "custom" && (
        <>
          <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
          <span className="muted">to</span>
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
        </>
      )}
    </div>
  );
}

/** Search box that writes to the URL after the user pauses typing, not on every keystroke. */
export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft), 250);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="search" type="search" placeholder={placeholder} aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} />;
}
