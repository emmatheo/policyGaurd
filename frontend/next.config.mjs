import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the trace root to this app. Next.js otherwise walks up looking for a lockfile
  // and can settle on a stray one in a parent directory, which makes the build warn
  // and trace the wrong tree.
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
