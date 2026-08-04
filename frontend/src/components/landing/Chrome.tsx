"use client";

import Link from "next/link";

/**
 * The announcement bar.
 *
 * The copy is a single exported constant because it is a factual claim about the
 * project — it belongs in one obvious place rather than buried in markup.
 */
export const ANNOUNCEMENT = {
  message: "We've just raised $33 million!",
  linkLabel: "Read more",
  href: "/demo",
};

export function AnnouncementBar() {
  return (
    <div className="rounded-xl bg-[#0e0e0e] px-4 py-2.5 text-center sm:rounded-2xl">
      <p className="text-[13px] font-medium text-white">
        {ANNOUNCEMENT.message}{" "}
        <Link
          href={ANNOUNCEMENT.href}
          className="ml-1.5 underline decoration-white/40 underline-offset-[3px] transition hover:decoration-white"
        >
          {ANNOUNCEMENT.linkLabel}
        </Link>
      </p>
    </div>
  );
}

const NAV_ITEMS = ["CHALLANGES", "METRICS", "HOW IT WORKS", "FEATURES"];

export function SiteNav() {
  return (
    <nav className="flex items-center justify-between gap-6 py-5">
      <Link href="/" className="flex items-center gap-2.5">
        <HexLogo />
        <span className="text-[17px] font-medium tracking-tight text-[#111]">
          Platform
        </span>
      </Link>

      <div className="flex items-center gap-6">
        <ul className="hidden items-center gap-6 lg:flex">
          {NAV_ITEMS.map((item) => (
            <li key={item}>
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] font-medium tracking-[0.08em] text-[#111] transition hover:text-[#111]/60"
              >
                {item}
                <Chevron />
              </button>
            </li>
          ))}
        </ul>

        <Link
          href="/demo"
          className="inline-flex items-center gap-2 rounded-full bg-[#1a7cff] px-4 py-2 text-[13px] font-medium text-white shadow-[0_6px_16px_-6px_rgba(26,124,255,0.9)] transition hover:bg-[#0f6ae8]"
        >
          Join Subnet
          <Arrow />
        </Link>
      </div>
    </nav>
  );
}

function HexLogo() {
  return (
    <svg width="24" height="27" viewBox="0 0 24 27" aria-hidden="true">
      <path d="M12 0 23 6.25v12.5L12 25 1 18.75V6.25Z" fill="#111" />
      <circle cx="12" cy="12.5" r="3.6" fill="#e9e8e4" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" className="mt-px">
      <path
        d="M2 4l3 3 3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3 7h8m-3.2-3.4L11.2 7 7.8 10.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Metric {
  label: string;
  value: string;
}

const METRICS: Metric[] = [
  { label: "Lines of code", value: "+12K" },
  { label: "Validator agents", value: "38" },
  { label: "Term-Bench", value: "0.27%" },
];

export function MetricsPanel() {
  return (
    <dl className="w-full max-w-[240px]">
      {METRICS.map((metric, index) => (
        <div
          key={metric.label}
          className={`flex items-baseline justify-between gap-4 py-3.5 ${
            index < METRICS.length - 1 ? "border-b border-[#111]/10" : ""
          }`}
        >
          <dt className="flex items-center gap-2 text-[13px] text-[#111]/70">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" aria-hidden />
            {metric.label}
          </dt>
          <dd className="font-mono text-[15px] tracking-tight text-[#111]">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ScrollCue() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="font-mono text-[11px] tracking-[0.12em] text-[#111]/45">
        scroll down
      </span>
      <svg
        width="14"
        height="9"
        viewBox="0 0 14 9"
        aria-hidden="true"
        className="animate-cue text-[#111]/45"
      >
        <path
          d="M1 1l6 6 6-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
