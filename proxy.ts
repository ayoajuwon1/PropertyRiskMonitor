import { NextRequest, NextResponse } from "next/server";

const ALLOWED_PATH_PREFIXES = ["/api/map-data", "/api/location", "/api/layers", "/api/state-context"];
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;

const requestCounters = new Map<string, { count: number; resetAt: number }>();

function isAllowedApiPath(pathname: string): boolean {
  return ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getClientIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(clientId: string): { limited: boolean; retryAfter?: number } {
  const now = Date.now();
  const existing = requestCounters.get(clientId);

  if (!existing || now > existing.resetAt) {
    requestCounters.set(clientId, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false };
  }

  existing.count += 1;

  if (existing.count > MAX_REQUESTS_PER_WINDOW) {
    return {
      limited: true,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  return { limited: false };
}

function withCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const allowedOrigin = process.env.NPRM_ALLOWED_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const origin = request.headers.get("origin");

  if (!origin || origin === allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Vary", "Origin");
  }

  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("X-Content-Type-Options", "nosniff");

  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isAllowedApiPath(pathname)) {
    const response = NextResponse.json({ error: "Not found" }, { status: 404 });
    return withCorsHeaders(response, request);
  }

  if (request.method === "OPTIONS") {
    return withCorsHeaders(new NextResponse(null, { status: 204 }), request);
  }

  if (request.method !== "GET") {
    const response = NextResponse.json({ error: "Method not allowed" }, { status: 405 });
    return withCorsHeaders(response, request);
  }

  const rateLimitStatus = isRateLimited(getClientIdentifier(request));
  if (rateLimitStatus.limited) {
    const response = NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    if (rateLimitStatus.retryAfter) {
      response.headers.set("Retry-After", String(rateLimitStatus.retryAfter));
    }
    return withCorsHeaders(response, request);
  }

  return withCorsHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: "/api/:path*",
};
