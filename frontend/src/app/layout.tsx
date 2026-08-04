import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";

import "./globals.css";

/**
 * Roboto, self-hosted by next/font at build time — no runtime request to Google, so
 * the page keeps working offline and behind a strict CSP.
 *
 * Weight 900 is included because the dot-matrix headline samples the heaviest cut it
 * can get; a lighter weight leaves gaps in the grid.
 */
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-roboto",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PolicyGuard XRPL",
  description:
    "A keyless, policy-controlled XRPL account. Keys are generated inside a Flare Confidential Compute TEE and only sign payments that satisfy an on-chain policy.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
