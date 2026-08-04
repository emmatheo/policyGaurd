import Link from "next/link";

import { Logo } from "@/components/brand";
import { FlareMark, GitHubMark, GoMark, XRPLMark } from "./BrandMarks";

export const REPO_URL = "https://github.com/emmatheo/policyGaurd";

const BUILT_WITH = [
  { name: "Flare", Mark: FlareMark, href: "https://dev.flare.network/fcc/overview" },
  { name: "XRP Ledger", Mark: XRPLMark, href: "https://xrpl.org" },
  { name: "Go", Mark: GoMark, href: "https://go.dev" },
];

export function Footer() {
  return (
    <footer className="bg-forest-950 pt-14 pb-10">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <div className="flex flex-col gap-10 border-t border-white/10 pt-10 sm:flex-row sm:justify-between">
          <div className="max-w-[300px]">
            <div className="flex items-center gap-2.5">
              <Logo size={24} className="text-white" />
              <span className="text-[16px] font-medium text-white">PolicyGuard</span>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-white/45">
              A keyless XRPL account governed by a rule you publish, enforced by an
              enclave that holds the only key.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-14 gap-y-8">
            <nav>
              <p className="text-[12px] font-medium tracking-[0.08em] text-white/35 uppercase">
                Product
              </p>
              <ul className="mt-3 space-y-2">
                {[
                  { label: "What it is", href: "#what" },
                  { label: "How it works", href: "#how" },
                  { label: "Open app", href: "/app" },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-[14px] text-white/60 transition hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div>
              <p className="text-[12px] font-medium tracking-[0.08em] text-white/35 uppercase">
                Built with
              </p>
              <ul className="mt-3 space-y-2">
                {BUILT_WITH.map(({ name, Mark, href }) => (
                  <li key={name}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[14px] text-white/60 transition hover:text-white"
                    >
                      <Mark size={15} />
                      {name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-white/35">
            Running on Flare Coston2 testnet. Not for use with real funds.
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[13px] text-white/50 transition hover:text-white"
          >
            <GitHubMark size={15} />
            View source
          </a>
        </div>
      </div>
    </footer>
  );
}
