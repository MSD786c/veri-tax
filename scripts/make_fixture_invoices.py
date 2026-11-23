"""Render synthetic invoice files from app.seed into fixtures/invoices/ for the upload link.

Every seeded invoice gets a PNG whose TRN, number, date and amounts match the seed exactly (EX-01 passes).
Extras: a Quotation (no matching invoice) and a 2-page PDF of DRE-530 (totals on page 2).
Run: uv run python scripts/make_fixture_invoices.py
"""
import sys
from datetime import timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.seed import COMPLETION, SUPPLIERS, fixtures  # noqa: E402

OUT = ROOT / "fixtures" / "invoices"
W, H, M = 1240, 1754, 80  # A4 at 150 dpi
F = {s: ImageFont.load_default(size=s) for s in (26, 30, 34, 56)}  # Pillow >= 10.1, no OS fonts


def aed(x: float) -> str:
    return f"AED {x:,.2f}"


class Page:
    def __init__(self):
        self.img = Image.new("RGB", (W, H), "white")
        self.d = ImageDraw.Draw(self.img)
        self.y = M

    def text(self, s, size=30, x=M, gap=12, fill="black"):
        self.d.text((x, self.y), s, font=F[size], fill=fill)
        self.y += size + gap

    def rule(self, gap=24):
        self.d.line((M, self.y, W - M, self.y), fill="#444", width=3)
        self.y += gap

    def row(self, label, value, size=34):
        self.d.text((M, self.y), label, font=F[size], fill="black")
        self.d.text((W - M, self.y), value, font=F[size], fill="black", anchor="ra")
        self.y += size + 16


def header(p: Page, title: str, trn: str, no: str, inv_date, recipient: str, plot: str, page_note: str = ""):
    p.text(SUPPLIERS[trn][0], 34, gap=8)
    p.text(SUPPLIERS[trn][1], 26, gap=8, fill="#333")  # same address the seed sends
    p.text(f"TRN: {trn}", 30, gap=30)
    p.d.text((W - M, M), title, font=F[56], fill="black", anchor="ra")
    if page_note:
        p.d.text((W - M, M + 70), page_note, font=F[26], fill="#555", anchor="ra")
    p.rule()
    p.row(f"{title} No:", no, 30)
    p.row(f"{title} Date:", inv_date.isoformat(), 30)
    p.y += 10
    p.text("Bill To:", 30, gap=6)
    p.text(recipient, 34, gap=6)
    p.text(f"Plot No: {plot}", 30, gap=30)
    p.rule()


def body(p: Page, desc: str, taxable: float, simplified: bool = False):
    """Article 59(1) line table: description, quantity, unit price, VAT rate, VAT and net amount."""
    if simplified:  # Article 59(2): description only, no line pricing
        p.text("Description", 30, gap=10, fill="#333")
        p.text(desc, 34, gap=40)
        p.row("Taxable Amount", aed(taxable))
        return
    p.text("Description  |  Qty  |  Unit price  |  VAT rate  |  VAT  |  Net amount", 26, gap=10, fill="#333")
    p.text(desc, 34, gap=6)
    p.text(f"1  |  {aed(taxable)}  |  5%  |  {aed(round(taxable * 0.05, 2))}  |  {aed(taxable)}", 30, gap=40)
    p.row("Taxable Amount", aed(taxable))


def totals(p: Page, taxable: float, vat: float, total: float):
    p.row("VAT Rate", "5%")
    p.row("VAT Amount", aed(vat))
    p.rule()
    p.row("Total (incl. VAT)", aed(total), 34)
    p.text("Currency: AED", 26, gap=40, fill="#333")
    p.text("Payment due within 30 days. Bank: Emirates NBD, IBAN AE07 0331 2345 6789 0123 456", 26, fill="#333")


def invoice_pages(title, trn, no, inv_date, recipient, plot, desc, taxable, vat, total, split=False):
    p1 = Page()
    header(p1, title, trn, no, inv_date, recipient, plot, "Page 1 of 2" if split else "")
    body(p1, desc, taxable, title.startswith("Simplified"))
    if not split:
        totals(p1, taxable, vat, total)
        return [p1.img]
    p1.text("Continued on page 2", 26, gap=0, fill="#555")
    p2 = Page()
    p2.text(f"{SUPPLIERS[trn][0]}  |  TRN: {trn}", 30)
    p2.d.text((W - M, M), "Page 2 of 2", font=F[26], fill="#555", anchor="ra")
    p2.text(f"{title} No: {no}  |  Date: {inv_date.isoformat()}", 30, gap=30)
    p2.rule()
    p2.row("Taxable Amount", aed(taxable))
    totals(p2, taxable, vat, total)
    return [p1.img, p2.img]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for app in fixtures():
        for inv in app.invoices:
            title = "Simplified Tax Invoice" if inv.invoice_type == "SIMPLIFIED" else "Tax Invoice"
            args = (title, inv.supplier_trn, inv.invoice_no, inv.invoice_date, inv.recipient_name,
                    inv.plot_no, inv.description, inv.taxable_amount, inv.vat_amount, inv.total)
            # ponytail: maskan_ref in the name because ANB-1001 is seeded twice (NR-05 duplicate case)
            path = OUT / f"{app.maskan_ref}_{inv.invoice_no}.png"
            invoice_pages(*args)[0].save(path)
            made.append(path)
            if inv.invoice_no == "DRE-530":
                pdf = OUT / f"{app.maskan_ref}_{inv.invoice_no}_2page.pdf"
                pages = invoice_pages(*args, split=True)
                pages[0].save(pdf, save_all=True, append_images=pages[1:], resolution=150)
                made.append(pdf)
    trn = "100333333300003"
    q = OUT / "QUOTATION_DRE-Q-2026-118.png"
    invoice_pages("Quotation", trn, "DRE-Q-2026-118", COMPLETION - timedelta(days=140), "Khalid Al Shamsi",
                  "SHJ-7-301", "Proposed outdoor lighting package (estimate only)", 12000.0, 600.0, 12600.0)[0].save(q)
    made.append(q)
    for path in made:
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
