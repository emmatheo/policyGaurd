import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { Nav } from "@/components/landing/Nav";
import {
  HowItWorks,
  LiveStatus,
  ProductFlow,
  WhatItIs,
} from "@/components/landing/Sections";

export default function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <WhatItIs />
        <HowItWorks />
        <ProductFlow />
        <LiveStatus />
      </main>
      <Footer />
    </>
  );
}
