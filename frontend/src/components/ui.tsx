"use client";

import { useState } from "react";

/** A panel with the app's shared surface treatment. */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/8 bg-ink-900/70 p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] backdrop-blur sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

/** A numbered step in the demo flow, dimmed until its prerequisites are met. */
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
    <Card className={enabled ? "" : "opacity-45"}>
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
            done
              ? "border-mint-500/40 bg-mint-500/15 text-mint-400"
              : "border-white/12 bg-white/5 text-slate-300"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </Card>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
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
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flare-500 disabled:cursor-not-allowed disabled:opacity-45";
  const variants = {
    primary:
      "bg-flare-500 text-white hover:bg-flare-400 active:bg-flare-600 shadow-lg shadow-flare-600/20",
    ghost: "border border-white/12 bg-white/5 text-slate-200 hover:bg-white/10",
    danger: "border border-flare-500/40 bg-flare-500/10 text-flare-400 hover:bg-flare-500/20",
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

/** A labelled text input with an optional trailing unit. */
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
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-slate-400 uppercase">
        {label}
      </span>
      <span className="relative block">
        <input
          id={id}
          {...rest}
          className={`w-full rounded-xl border border-white/12 bg-ink-950/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-flare-500/60 focus:outline-none ${
            unit ? "pr-16" : ""
          }`}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs font-medium text-slate-500">
            {unit}
          </span>
        )}
      </span>
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "bad" | "warn";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-white/12 bg-white/5 text-slate-300",
    good: "border-mint-500/35 bg-mint-500/12 text-mint-400",
    bad: "border-flare-500/40 bg-flare-500/12 text-flare-400",
    warn: "border-amber-glow/35 bg-amber-glow/12 text-amber-glow",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A small live indicator dot. */
export function Dot({ ok }: { ok: boolean | null }) {
  const color =
    ok === null ? "bg-slate-500" : ok ? "bg-mint-500" : "bg-flare-500";
  return (
    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${color}`} />
  );
}

/**
 * A monospace value with a copy button. Signed blobs and XRPL addresses are the sort
 * of thing a viewer will want to paste elsewhere, and they are too long to retype.
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
    <div className="rounded-xl border border-white/8 bg-ink-950/50 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-200"
            >
              explorer
            </a>
          )}
          <button
            type="button"
            onClick={copy}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      <p className="break-hex font-mono text-xs leading-relaxed text-slate-300">{value}</p>
    </div>
  );
}

/** An inline error message. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl border border-flare-500/30 bg-flare-500/10 px-3.5 py-2.5 text-sm text-flare-400">
      {children}
    </p>
  );
}
