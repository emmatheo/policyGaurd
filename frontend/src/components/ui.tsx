"use client";

import { useState } from "react";

/** A panel on the light product surface. */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-mint-200 bg-white p-5 sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * One step of the product flow.
 *
 * A step that is not yet reachable is dimmed and its controls are disabled, so the
 * order is obvious without an explanation.
 */
export function StepCard({
  step,
  title,
  description,
  enabled,
  done,
  children,
}: {
  step: number;
  title: string;
  description: string;
  enabled: boolean;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={enabled ? "" : "opacity-55"}>
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[14px] font-semibold ${
            done
              ? "bg-signal-500 text-forest-950"
              : "bg-mint-100 text-forest-900"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-forest-950">{title}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-700">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </Card>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
  busy?: boolean;
};

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 disabled:cursor-not-allowed disabled:opacity-45";
  const variants = {
    primary: "bg-forest-950 text-white hover:bg-forest-800",
    ghost: "border border-mint-200 bg-white text-forest-950 hover:bg-mint-50",
  } as const;

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  unit,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  unit?: string;
}) {
  const id = rest.id ?? rest.name ?? label.replace(/\s+/g, "-").toLowerCase();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[12px] font-medium tracking-wide text-ink-500 uppercase">
        {label}
      </span>
      <span className="relative block">
        <input
          id={id}
          {...rest}
          className={`w-full rounded-xl border border-mint-200 bg-mint-50 px-3.5 py-2.5 text-[14px] text-forest-950 placeholder:text-ink-400 focus:border-signal-500 focus:bg-white focus:outline-none disabled:opacity-60 ${
            unit ? "pr-16" : ""
          }`}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[12px] font-medium text-ink-400">
            {unit}
          </span>
        )}
      </span>
      {hint && <span className="mt-1.5 block text-[12px] text-ink-500">{hint}</span>}
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "blocked" | "bad";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-mint-100 text-forest-900",
    good: "bg-signal-500 text-forest-950",
    blocked: "bg-block-500 text-forest-950",
    bad: "bg-fail-500 text-white",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A live status dot. */
export function Dot({ ok }: { ok: boolean | null }) {
  const color =
    ok === null ? "bg-ink-400" : ok ? "bg-signal-500 animate-live" : "bg-fail-500";
  return <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}

/**
 * A monospace value with a copy button.
 *
 * Signed blobs and XRPL addresses are exactly what someone wants to paste elsewhere,
 * and far too long to retype.
 */
export function CopyableHex({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; the value stays selectable either way.
    }
  }

  return (
    <div className="rounded-xl border border-mint-200 bg-mint-50 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium tracking-wide text-ink-500 uppercase">
          {label}
        </span>
        <div className="flex items-center gap-3">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-ink-500 underline decoration-dotted underline-offset-2 hover:text-forest-950"
            >
              explorer
            </a>
          )}
          <button
            type="button"
            onClick={copy}
            className="text-[12px] text-ink-500 hover:text-forest-950"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      <p className="break-hex font-mono text-[12px] leading-relaxed text-forest-900">
        {value}
      </p>
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-fail-500/25 bg-fail-500/8 px-3.5 py-2.5 text-[14px] text-fail-500">
      {children}
    </p>
  );
}

/** Shown while an instruction is in flight, with a moving bar so it reads as working. */
export function ProgressNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-mint-200 bg-mint-50">
      <div className="h-0.5 w-full overflow-hidden bg-mint-200">
        <div className="animate-sweep h-full w-1/3 bg-signal-500" />
      </div>
      <p className="px-3.5 py-2.5 font-mono text-[12.5px] text-ink-700">{children}</p>
    </div>
  );
}
