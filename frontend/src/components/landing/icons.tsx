/**
 * Line icons for the landing page.
 *
 * Drawn on a 24-unit grid with a consistent 1.6 stroke so they sit together as a set,
 * and inheriting `currentColor` so each one takes the colour of its surface.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

/** A key inside a sealed box — the enclave holding what it will not release. */
export function KeyInEnclaveIcon({ size = 24, className = "" }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="10" cy="12" r="2.4" />
      <path d="M12.4 12H18M16 12v2.4" />
    </svg>
  );
}

/** A dial with a hard stop — the spending limit. */
export function LimitIcon({ size = 24, className = "" }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M12 15l4.2-4.2" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
      <path d="M4 19h16" />
    </svg>
  );
}

/** A document with a tick — the signed transaction. */
export function SignedIcon({ size = 24, className = "" }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 14.5l2 2 4-4.5" />
    </svg>
  );
}

/** A shield with a bar through it — the refusal. */
export function BlockedIcon({ size = 24, className = "" }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3l7 3v6c0 4-3 6.5-7 7-4-.5-7-3-7-7V6Z" />
      <path d="M9 12h6" />
    </svg>
  );
}

/** A chain link — the on-chain record. */
export function ChainIcon({ size = 24, className = "" }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5L11 7.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0L6.5 13a3.54 3.54 0 0 0 5 5l1.5-1.5" />
    </svg>
  );
}

/** A wallet. */
export function WalletIcon({ size = 24, className = "" }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
      <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
      <circle cx="16.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** An arrow, used on buttons and between steps. */
export function ArrowIcon({ size = 15, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M3 8h9m-3.4-3.6L12.2 8 8.6 11.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
