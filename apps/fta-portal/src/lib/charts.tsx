// Server-rendered SVG charts. No client JavaScript: hover is CSS and tooltips are <title> elements.
import type { ReactNode } from "react";
import { monthLabel, money } from "./format";

export const NAVY = "#0f1f3d", GOLD = "#d1ab4d", GREEN = "#1c9b6c", AMBER = "#d6a21f", RED = "#d93a52", GREY = "#b9b19b";

const short = (x: number) => {
  for (const [n, s] of [[1e6, "M"], [1e3, "K"]] as const) {
    if (Math.abs(x) >= n) return `${(x / n).toFixed(1).replace(/\.0$/, "")}${s}`;
  }
  return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
};

export function ChartEmpty({ text }: { text: string }) {
  return <div className="chart-empty">{text}</div>;
}

export function AreaChart({ monthly }: { monthly: { month: string; claimed: number; verified: number; invoices: number }[] }) {
  if (!monthly.length) return <ChartEmpty text="No invoices in this range" />;
  const W = 680, H = 350, L = 56, R = 20, T = 20, B = 44;
  const top = niceMax(Math.max(...monthly.map((m) => Math.max(m.claimed, m.verified))));
  const n = monthly.length;
  const x = (i: number) => L + ((W - L - R) * (i + 0.5)) / n;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const base = y(0);
  const line = (key: "claimed" | "verified") => monthly.map((m, i) => `${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join(" ");
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="VAT claimed and verified by month">
        <defs>
          <linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={GOLD} stopOpacity=".5" /><stop offset="1" stopColor={GOLD} stopOpacity="0" /></linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((k) => {
          const v = (top * k) / 4;
          return (
            <g key={k}>
              <line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text className="ax" x={L - 10} y={y(v) + 4} textAnchor="end">{short(v)}</text>
            </g>
          );
        })}
        {n > 1 && (
          <>
            <path d={`M${x(0).toFixed(1)} ${base.toFixed(1)} ${monthly.map((m, i) => `L${x(i).toFixed(1)} ${y(m.verified).toFixed(1)}`).join(" ")} L${x(n - 1).toFixed(1)} ${base.toFixed(1)}Z`} fill="url(#ga)" />
            <polyline className="ln gold" points={line("verified")} />
            <polyline className="ln navy" points={line("claimed")} />
          </>
        )}
        {monthly.map((m, i) => {
          const cw = (W - L - R) / n;
          return (
            <g key={m.month}>
              <g className="pt">
                <rect className="hit" x={x(i) - cw / 2} y={T} width={cw} height={H - T - B} />
                <line className="guide" x1={x(i)} x2={x(i)} y1={T} y2={base} />
                <circle className="dot gold" cx={x(i)} cy={y(m.verified)} r={5} />
                <circle className="dot navy" cx={x(i)} cy={y(m.claimed)} r={5} />
                <title>{`${monthLabel(m.month)}: VAT claimed ${money(m.claimed)} · VAT verified ${money(m.verified)} · ${m.invoices} invoices`}</title>
              </g>
              <text className="ax" x={x(i)} y={H - 16} textAnchor="middle">{monthLabel(m.month)}</text>
            </g>
          );
        })}
      </svg>
      <ul className="legend inline">
        <li><i style={{ background: NAVY }} />VAT claimed</li>
        <li><i style={{ background: GOLD }} />VAT verified</li>
      </ul>
    </>
  );
}

export function BarChart({ rows, color = NAVY, format, empty = "Nothing to plot yet", h = 220 }: {
  rows: { label: string; value: number }[]; color?: string; format?: (v: number) => string; empty?: string; h?: number;
}) {
  if (!rows.length) return <ChartEmpty text={empty} />;
  const W = 680, L = 44, R = 12, T = 16, B = 40;
  const top = niceMax(Math.max(...rows.map((r) => r.value)));
  const slot = (W - L - R) / rows.length;
  const bw = Math.min(46, slot * 0.58);
  const y = (v: number) => T + (h - T - B) * (1 - v / top);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${h}`} role="img">
      {[0, 1, 2, 3].map((k) => {
        const v = (top * k) / 3;
        return (
          <g key={k}>
            <line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="ax" x={L - 8} y={y(v) + 4} textAnchor="end">{short(v)}</text>
          </g>
        );
      })}
      {rows.map((r, i) => {
        const cx = L + slot * (i + 0.5);
        const bh = r.value ? Math.max(2, y(0) - y(r.value)) : 0;
        return (
          <g key={r.label + i}>
            <g className="bar-g">
              <rect className="bar-hit" x={cx - slot / 2} y={T} width={slot} height={h - T - B} />
              <rect className="col" x={cx - bw / 2} y={y(0) - bh} width={bw} height={bh} rx={Math.min(12, bw / 2)} fill={color} />
              <title>{`${r.label}: ${format ? format(r.value) : short(r.value)}`}</title>
            </g>
            <text className="ax" x={cx} y={h - 16} textAnchor="middle">{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ parts, center = "invoices" }: { parts: [string, number, string][]; center?: string }) {
  const total = parts.reduce((a, p) => a + p[1], 0);
  if (!total) return <ChartEmpty text="Nothing to plot yet" />;
  const R = 74, SW = 24, C = 2 * Math.PI * R;
  const live = parts.filter((p) => p[1] > 0);
  const gap = live.length > 1 ? SW + 10 : 0;
  const starts = live.map((_, i) => live.slice(0, i).reduce((a, p) => a + (C * p[1]) / total, 0));
  return (
    <div className="donut-wrap">
      <svg className="chart donut" viewBox="0 0 220 220" role="img" aria-label="Invoice ratings">
        <circle cx="110" cy="110" r={R} fill="none" stroke="#f1ece0" strokeWidth={SW} />
        {live.map(([label, v, color], i) => {
          const seg = (C * v) / total;
          const draw = Math.max(0.1, seg - gap);
          const off = starts[i] + gap / 2;
          return (
            <g className="seg" key={label}>
              <circle cx="110" cy="110" r={R} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeDasharray={`${draw.toFixed(2)} ${(C - draw).toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)} transform="rotate(-90 110 110)">
                <title>{`${label}: ${v} (${Math.round((v / total) * 100)}%)`}</title>
              </circle>
            </g>
          );
        })}
        <text className="d-n" x="110" y="112" textAnchor="middle">{total}</text>
        <text className="d-s" x="110" y="132" textAnchor="middle">{center}</text>
      </svg>
      <ul className="legend">
        {parts.map(([l, v, c]) => (
          <li key={l}><i style={{ background: c }} /><span>{l}</span><b>{v}</b><small>{Math.round((v / total) * 100)}%</small></li>
        ))}
      </ul>
    </div>
  );
}

export function Funnel({ parts }: { parts: [string, number, string][] }): ReactNode {
  const mx = Math.max(1, ...parts.map((p) => p[1]));
  return (
    <ul className="hbars">
      {parts.map(([l, v, c]) => (
        <li key={l}>
          <span>{l}</span>
          <div className="track"><i style={{ width: `${v ? Math.max((v / mx) * 100, 2) : 0}%`, background: c }} title={`${l}: ${v}`} /></div>
          <b>{v}</b>
        </li>
      ))}
    </ul>
  );
}
