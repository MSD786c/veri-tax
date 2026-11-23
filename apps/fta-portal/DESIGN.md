# Design: FTA officer portal

Source of truth for the look of `apps/fta-portal`. Values are the ones in `src/app/portal.css` (layered on `base.css`). If you change one, change it in both places.

## 1. Who it is for

An FTA officer working a queue of VAT refund claims. The first screen answers three questions: what is waiting, what needs my decision, and what did I finish today. Every number is a link to the list behind it.

## 2. Principles

- **Editorial, not dashboard-y.** Large serif headlines, generous air, one idea per card.
- **Navy for action, grey for weight, cream for paper.** Colour is used to mean something (rating, status), never as decoration.
- **Rounded end to end.** Controls are pills or circles. Cards are soft and large.
- **Server-rendered.** Pages are complete HTML. Search, filters, paging, drawers and decisions are links and forms, so the portal works with JavaScript switched off.
- **Honest data.** Everything shown comes from the API. Nothing is invented for the chart.

## 3. Colour

| Token | Value | Use |
|-------|-------|-----|
| navy | `#0F1F3D` | Text, primary buttons, active navigation, outlines, avatars |
| navy 2 | `#1B3159` | Button and active-nav gradient end |
| slate | `#3A3D44` | Dark cards (applications to review, verify an invoice) |
| paper | `#F5F1E7` | Page background (with a soft gold glow and a faint grain) |
| gold | `#D1AB4D` / `#C9A24A` | Accent: the verify button, numerals on dark, chart verified line |
| mint | `#D7EFDF` | Good: verified, strong, decisions |
| peach | `#F8DCC3` | Needs a decision |
| sky | `#D3E2FB` | Neutral information |
| lilac | `#E6DCF7` | System / rule engine |
| sand | `#F3E5C0` | Weak, attention |
| blush | `#FBD3D3` | Not refundable, fail |
| status | `#1C9B6C` ok, `#D6A21F` warn, `#D93A52` bad | Badges, chart series, rings |

Rule: one accent (gold). Pastels tint whole cards; they are never used for text.

## 4. Typography

- **Display:** Newsreader (variable). Headlines, card titles, big numbers. **Upright only, no italics anywhere** (`font-style: normal !important`, `font-synthesis: none`).
- **Body:** Inter (variable). Labels, tables, forms.
- **Scale:** page title `clamp(2.7rem, 4.1vw, 4.2rem)` at `-0.045em`, line-height `.96`, weight 450. Greeting `clamp(2.4rem, 3.6vw, 3.7rem)`. Card title `1.35rem`. Big task number `4.2rem`. Body `15px`.
- **Numbers:** tabular, lining figures everywhere (`font-variant-numeric`). Currency is `AED 12,345.00`.
- **Wrapping:** headings `text-wrap: balance`, paragraphs `text-wrap: pretty`.
- Small uppercase labels use `+0.09em` tracking and are used sparingly.

## 5. Shape, depth and motion

- **Radius:** cards `28 to 34px`, controls `999px`, drawers `24px` on the open side, text areas `22px`.
- **Shadows:** one light source, tinted navy: `0 30px 44px -36px rgba(15,31,61,.38)` plus a 1px white inner highlight. Dark cards get a deeper `0 34px 50px -34px rgba(15,31,61,.6)`.
- **Grain:** a fixed 4.5% multiply noise overlay over the whole page.
- **Motion:** spring `cubic-bezier(.22, 1.2, .36, 1)` for lifts, `.22, 1, .36, 1` for slides. Entrance is a staggered rise (`riseIn`). Only `transform` and `opacity` animate. `prefers-reduced-motion` turns it all off.
- **Press:** buttons lift 2px on hover and scale `.97` on press.

## 6. Layout

- Sidebar `264px` (collapses to a checkbox drawer at `1000px`), top bar with search, bell and user menu, floating dock of four quick actions.
- Content grows to a `1680px` maximum on very wide screens.
- **Dashboard:** greeting and two actions, then a task row of one large card and two smaller (`1.35fr 1fr 1fr`). Number, caption and footer line up across the three cards. Then the queue beside the verify card, then the analytics block.
- **Lists:** four pastel stat or pipeline cards, one toolbar (search, segmented filters), then the table. Rows are whole-row links. Numeric columns are right-aligned.
- **Drawers:** `520px` from the right on top of a blurred scrim, closed with a link. They hold detail and the decision form.
- **Breakpoints:** `1500px` (large sign-in type), `1000px` (drawer nav, single-column grids), `760px` (dock labels hidden, stacked rows).

## 7. Components

| Component | Notes |
|-----------|-------|
| Primary button | Navy gradient pill, inner highlight, tinted shadow |
| Gold button | Gold gradient pill. One per screen at most (Verify now) |
| Ghost / soft button | White or sand pill, 1px line |
| Badge | Pill with a dot or icon. Approved mint, referred sand, rejected blush, neutral grey. "Referred" and "Awaiting" dots pulse |
| Stat / KPI card | Pastel fill, serif number |
| Rating stamp | Rotated outlined stamp (STRONG, WEAK, FAIL) that animates in |
| Chart | Server-drawn SVG: area (claimed vs verified), round-capped donut, rounded bars, horizontal tracks. Hover is CSS and `<title>` |
| Entity card | Avatar, trust ring (verified share), tier chip, split bar, three amounts, footer |
| Audit item | Timeline dot per source (Maskan, rule engine, supplier, officer), source chip, linked reference, monospace detail line |

## 8. States

| State | Treatment |
|-------|-----------|
| Empty | Icon tile, short title, one-line reason, a "Clear filters" pill |
| Error | Pastel card with a large faint status code, plain explanation, "Try again" and "Back to dashboard". 503 shows how to start the API |
| 404 | Same card, blue |
| Flash message | Navy pill at the bottom, fades after about 4 seconds (CSS only) |
| Form error | Inline red text under the field, never an alert box |
| Loading | None: pages arrive complete. Skeleton screens were removed because they cannot be revealed without JavaScript |

## 9. Accessibility

- Skip-to-content link, `aria-current` on the active nav item, `aria-label` on icon buttons, charts have `role="img"` and `<title>` tooltips.
- Visible focus ring (3px gold). Colour is never the only signal: every status has text.
- Contrast: navy on cream and white on navy or slate pass AA.

## 10. Known limits

- English only and left-to-right (the earlier Arabic prototype was not ported).
- Auth is mocked, like the API.
- Data refreshes on navigation, not live. There is no auto-refresh without JavaScript.
