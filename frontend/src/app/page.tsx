import Link from "next/link";

import {
  AnnouncementBar,
  MetricsPanel,
  ScrollCue,
  SiteNav,
} from "@/components/landing/Chrome";
import { Connectors } from "@/components/landing/Connectors";
import { DotText } from "@/components/landing/DotText";
import { Footer } from "@/components/landing/Footer";
import { ParticleHuman } from "@/components/landing/ParticleHuman";

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#dededc] px-3 py-3 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1180px] overflow-hidden rounded-[20px] bg-[#f4f3f1] px-5 pb-10 shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:px-8">
        <div className="pt-4">
          <AnnouncementBar />
        </div>

        <SiteNav />

        {/* The hero. Everything inside is layered over the figure, which sits in the
            middle and bleeds behind the headline and the metrics. */}
        <section className="relative mt-6 min-h-[620px] lg:min-h-[660px]">
          {/* Figure — behind the text, spanning the hero. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-full w-full max-w-[760px]">
              <ParticleHuman className="h-full w-full" />
            </div>
          </div>

          {/* Corner connector runs, decorative and desktop only. */}
          <Connectors className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" />

          {/* Foreground content. */}
          <div className="relative grid h-full grid-cols-1 items-center gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
            <div className="max-w-[430px]">
              {/* Sized so the matrix renders at its natural width rather than being
                  scaled down into the column, which would shrink the dot grid and
                  lose the LED-panel character. */}
              <h1 className="flex flex-col gap-5">
                <DotText text="TEST. VERIFY." fontSize={46} gridStep={5.6} tracking={7} />
                <DotText
                  text="TRUST."
                  fontSize={46}
                  gridStep={5.6}
                  tracking={7}
                  color="#1a7cff"
                />
              </h1>

              <p className="mt-7 max-w-[300px] text-[13.5px] leading-[1.65] text-[#111]/70">
                A decentralized network that rewards developers for building superior AI
                agents. Transparent evaluation and token incentives drive innovation in
                artificial intelligence.
              </p>
            </div>

            <div className="flex justify-start lg:justify-end">
              <MetricsPanel />
            </div>
          </div>
        </section>

        {/* Call to action. */}
        <div className="relative mt-2 flex flex-col items-center gap-8">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 rounded-xl bg-[#1a7cff] px-6 py-3.5 text-[14px] font-medium text-white shadow-[0_10px_24px_-10px_rgba(26,124,255,0.95)] transition hover:bg-[#0f6ae8]"
          >
            Start Project
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M3 7h8m-3.2-3.4L11.2 7 7.8 10.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>

          <ScrollCue />
        </div>

        <Footer />
      </div>
    </div>
  );
}
