import { NextResponse } from "next/server";

/**
 * Server-side reader for TEE proxy instruction results.
 *
 * The proxy is a third-party host that sends no CORS headers, so the browser cannot
 * poll it directly. This route does it from the server instead.
 *
 * The proxy URL is supplied by the caller because it comes from the on-chain
 * TeeInstructionsSent event — the chain decides which machines handle an instruction,
 * so the URL cannot be pinned in configuration. That does mean this endpoint takes a
 * URL from the client, which is a server-side request forgery risk, so the target is
 * validated below before anything is fetched.
 */

export const dynamic = "force-dynamic";

/**
 * Whether to permit private and loopback targets.
 *
 * Off by default. The official local FCC stack runs the proxy on localhost, so a
 * developer following the simulated-TEE guide needs this on; a public deployment must
 * not have it, or the route becomes a probe for the host's internal network.
 */
const ALLOW_PRIVATE_HOSTS = process.env.FCC_ALLOW_PRIVATE_PROXY === "true";

/** Hostnames that resolve to the host itself or to a private network. */
const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd])/i;

function validateProxyUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("proxy is not a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("proxy must be an http(s) URL");
  }

  if (!ALLOW_PRIVATE_HOSTS && PRIVATE_HOST.test(url.hostname)) {
    throw new Error(
      "proxy resolves to a private address; set FCC_ALLOW_PRIVATE_PROXY=true to allow this in local development",
    );
  }

  return url;
}

/** Instruction ids are 32-byte hashes; anything else is not worth forwarding. */
function validateInstructionId(raw: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("id must be a 0x-prefixed 32-byte hex hash");
  }
  return raw;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const proxyParam = params.get("proxy");
  const idParam = params.get("id");

  if (!proxyParam || !idParam) {
    return NextResponse.json(
      { error: "both proxy and id query parameters are required" },
      { status: 400 },
    );
  }

  let target: URL;
  let instructionId: string;
  try {
    target = validateProxyUrl(proxyParam);
    instructionId = validateInstructionId(idParam);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  // The proxy's result endpoint, per the FCC extension proxy API.
  const resultUrl = new URL(
    `/action/result/${instructionId}`,
    target.origin + target.pathname.replace(/\/+$/, ""),
  );

  try {
    const response = await fetch(resultUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      // A proxy that hangs must not hold this route open.
      signal: AbortSignal.timeout(15_000),
    });

    // Not published yet. Passed through verbatim so the poller can keep waiting
    // rather than treating a normal in-flight state as a failure.
    if (response.status === 404) {
      return NextResponse.json({ pending: true }, { status: 404 });
    }

    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: `proxy returned ${response.status}: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    try {
      return NextResponse.json(JSON.parse(text), { status: 200 });
    } catch {
      return NextResponse.json(
        { error: `proxy returned non-JSON: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `could not reach the TEE proxy at ${target.origin}: ${message}` },
      { status: 502 },
    );
  }
}
