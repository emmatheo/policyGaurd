import Link from "next/link";

/**
 * The PolicyGuard mark: a shield built from a hexagon, echoing the step frames used
 * through the site, with a keyhole cut out of it — the product is a lock whose key
 * does not exist outside the enclave.
 */
export function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 2 28 8v10.5c0 6-5 10-12 11.5C9 28.5 4 24.5 4 18.5V8Z"
        fill="currentColor"
      />
      <circle cx="16" cy="14" r="3.6" className="fill-signal-400" />
      <rect x="14.6" y="15.5" width="2.8" height="6.5" rx="1.4" className="fill-signal-400" />
    </svg>
  );
}

export function Wordmark({
  className = "",
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`}>
      <Logo size={26} className={tone === "light" ? "text-white" : "text-forest-900"} />
      <span
        className={`text-[17px] font-medium tracking-tight ${
          tone === "light" ? "text-white" : "text-forest-900"
        }`}
      >
        PolicyGuard
      </span>
    </Link>
  );
}
