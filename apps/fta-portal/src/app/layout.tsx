import type { Metadata } from "next";
import "./base.css";
import "./portal.css";

export const metadata: Metadata = {
  title: "Federal Tax Authority · Verification Portal",
  description: "FTA officer portal for VAT refund verification (prototype, not an official FTA service)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
