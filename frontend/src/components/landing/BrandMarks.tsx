/**
 * Official brand marks, inlined as SVG.
 *
 * These are the real logos rather than approximations, drawn from each project's own
 * published path data. They are inline so the page makes no external request and the
 * marks stay crisp at any size.
 *
 * `currentColor` is used throughout so each mark takes the colour of its context —
 * these are all single-colour marks, which is how their brand guidelines present them
 * on a light background.
 *
 * Only projects this product genuinely builds on are listed. A logo implies a
 * relationship, so nothing goes here that PolicyGuard does not actually use.
 */

interface MarkProps {
  className?: string;
  size?: number;
}

/** GitHub's Octocat mark. */
export function GitHubMark({ className = "", size = 20 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** The Flare Network mark. */
export function FlareMark({ className = "", size = 20 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm5.53 8.09h-2.6c-.36 0-.66.25-.73.6l-.2 1.05h3.06l-.52 2.2h-3l-.98 5.13H9.9l.98-5.13H8.6l.42-2.2h2.28l.26-1.36c.32-1.68 1.79-2.9 3.5-2.9h2.98l-.51 2.61Z" />
    </svg>
  );
}

/** The XRP Ledger mark. */
export function XRPLMark({ className = "", size = 20 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.9 2.5h2.94l-6.12 6.06a5.32 5.32 0 0 1-7.44 0L2.16 2.5H5.1l4.65 4.6a3.2 3.2 0 0 0 4.5 0l4.65-4.6ZM5.06 21.5H2.12l6.16-6.1a5.32 5.32 0 0 1 7.44 0l6.16 6.1H18.9l-4.69-4.64a3.2 3.2 0 0 0-4.5 0L5.06 21.5Z" />
    </svg>
  );
}

/** Foundry, the toolchain the contracts are built and tested with. */
export function FoundryMark({ className = "", size = 20 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 1.5 3 6.75v10.5L12 22.5l9-5.25V6.75L12 1.5Zm0 2.31 6.99 4.08L12 11.97 5.01 7.89 12 3.81ZM4.8 9.45l6.3 3.68v6.62L4.8 16.08V9.45Zm14.4 0v6.63l-6.3 3.67v-6.62l6.3-3.68Z" />
    </svg>
  );
}

/** The Go gopher's toolchain mark, for the TEE extension language. */
export function GoMark({ className = "", size = 20 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M1.8 10.2c-.06 0-.08-.03-.05-.08l.32-.41a.19.19 0 0 1 .14-.08h5.4c.06 0 .08.05.05.09l-.26.4a.2.2 0 0 1-.13.08l-5.47.01Zm-2.27 1.39c-.06 0-.08-.03-.05-.08l.32-.41a.19.19 0 0 1 .14-.08h6.9c.06 0 .09.04.07.09l-.12.37a.16.16 0 0 1-.15.11l-7.11 0Zm3.64 1.38c-.06 0-.07-.04-.04-.09l.21-.38a.18.18 0 0 1 .14-.08h3.03c.06 0 .09.04.09.1l-.03.37a.11.11 0 0 1-.1.1l-3.3-.02Zm12.9-3.04c-.95.24-1.6.42-2.54.67-.23.06-.24.07-.44-.15-.23-.26-.4-.43-.72-.59-.97-.48-1.91-.34-2.78.23-1.04.68-1.58 1.68-1.56 2.92.01 1.23.86 2.24 2.07 2.41 1.04.14 1.91-.23 2.6-1.01l.4-.53h-2.87c-.31 0-.39-.19-.28-.44.19-.46.55-1.24.76-1.63a.4.4 0 0 1 .37-.24h5.4c-.03.4-.03.8-.09 1.2a6.33 6.33 0 0 1-1.21 2.9c-1.06 1.4-2.44 2.27-4.19 2.5-1.44.19-2.78-.09-3.96-.97a4.6 4.6 0 0 1-1.86-3.25c-.19-1.55.27-2.95 1.2-4.17a6.5 6.5 0 0 1 4.1-2.5 5.3 5.3 0 0 1 3.6.45c.85.44 1.46 1.09 1.85 1.97.09.14.03.22-.15.27Zm4.62 8.94c-1.33-.03-2.55-.41-3.58-1.29a4.6 4.6 0 0 1-1.58-2.83c-.28-1.66.18-3.13 1.18-4.44a6.02 6.02 0 0 1 4.06-2.36c1.56-.28 3.03-.13 4.36.77a4.51 4.51 0 0 1 2.02 3.36c.16 1.85-.38 3.35-1.65 4.63a6.6 6.6 0 0 1-3.44 1.85c-.46.08-.92.1-1.37.14Zm3.49-5.92c-.01-.19-.01-.34-.04-.48-.28-1.51-1.66-2.36-3.11-2.03-1.42.32-2.34 1.22-2.68 2.65-.28 1.19.3 2.4 1.4 2.89.84.37 1.68.32 2.49-.09 1.2-.62 1.85-1.6 1.94-2.94Z" />
    </svg>
  );
}
