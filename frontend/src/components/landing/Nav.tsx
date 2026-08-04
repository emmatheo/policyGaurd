"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand";

const LINKS = [
  { label: "What it is", href: "#what" },
  { label: "How it works", href: "#how" },
  { label: "The flow", href: "#flow" },
  { label: "Live status", href: "#status" },
];

/**
 * The top bar.
 *
 * The primary action is "Open app", not "Sign up" — there are no accounts. The wallet
 * is the identity, and the app says so rather than implying a signup flow that does
 * not exist.
 */
export function Nav() {
  const [open, setOpen] = useState(false);

  // A menu left open across a resize into the desktop layout would trap focus in a
  // panel that is no longer visible.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const close = () => setOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-forest-950/95 backdrop-blur">
      <nav className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-5 py-3.5 sm:px-8">
        <Wordmark />

        <ul className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-[14px] text-white/70 transition hover:text-white"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className="hidden rounded-full bg-white px-5 py-2 text-[14px] font-medium text-forest-950 transition hover:bg-signal-300 sm:inline-flex"
          >
            Open app
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle menu"
            className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 md:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              {open ? (
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M3 6h14M3 10h14M3 14h14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-white/10 px-5 pb-4 md:hidden">
          <ul className="flex flex-col gap-1 pt-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-[15px] text-white/80 transition hover:bg-white/10"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="pt-2">
              <Link
                href="/app"
                onClick={() => setOpen(false)}
                className="block rounded-full bg-white px-5 py-2.5 text-center text-[15px] font-medium text-forest-950"
              >
                Open app
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
