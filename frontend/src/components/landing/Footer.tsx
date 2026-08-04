import {
  FlareMark,
  FoundryMark,
  GitHubMark,
  GoMark,
  XRPLMark,
} from "./BrandMarks";

export const REPO_URL = "https://github.com/emmatheo/policyGaurd";

const BUILT_WITH = [
  { name: "Flare Network", Mark: FlareMark, href: "https://dev.flare.network/fcc/overview" },
  { name: "XRP Ledger", Mark: XRPLMark, href: "https://xrpl.org" },
  { name: "Go", Mark: GoMark, href: "https://go.dev" },
  { name: "Foundry", Mark: FoundryMark, href: "https://getfoundry.sh" },
];

/**
 * The footer: what the project is built on, and where the source lives.
 *
 * Each mark links to the project it represents, which is what keeps a logo row honest
 * — it credits the dependency rather than implying an endorsement.
 */
export function Footer() {
  return (
    <footer className="mt-14 border-t border-[#111]/10 pt-8">
      <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-medium tracking-[0.1em] text-[#111]/40 uppercase">
            Built with
          </p>
          <ul className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
            {BUILT_WITH.map(({ name, Mark, href }) => (
              <li key={name}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13px] text-[#111]/55 transition hover:text-[#111]"
                >
                  <Mark size={17} />
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-[#111]/12 px-4 py-2 text-[13px] font-medium text-[#111] transition hover:bg-[#111]/5 sm:self-auto"
        >
          <GitHubMark size={16} />
          View source
        </a>
      </div>

      <p className="mt-8 text-[12px] text-[#111]/35">
        PolicyGuard XRPL — a keyless, policy-controlled XRPL account built on Flare
        Confidential Compute.
      </p>
    </footer>
  );
}
