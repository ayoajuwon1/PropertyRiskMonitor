import { NextResponse } from "next/server";
import { getSecurityEventsSnapshots, getSecurityMetadata } from "@/lib/data-store";
import { canonicalStateName } from "@/lib/news";
import type { SecurityThreatCategory } from "@/lib/types";

function keyState(value: string): string {
  return canonicalStateName(value)
    .toLowerCase()
    .replace(/\bstate\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  const category = searchParams.get("category") as SecurityThreatCategory | null;
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? "60")));

  const [events, metadata] = await Promise.all([getSecurityEventsSnapshots(), getSecurityMetadata()]);

  const filtered = events
    .filter((event) => {
      if (state && keyState(event.state) !== keyState(state)) {
        return false;
      }
      if (category && event.category !== category) {
        return false;
      }
      return true;
    })
    .sort((left, right) => new Date(right.event_date).getTime() - new Date(left.event_date).getTime())
    .slice(0, limit);

  return NextResponse.json(
    {
      metadata: {
        ingest_source_stamp: metadata.ingest_source_stamp,
        publish_source_stamp: metadata.publish_source_stamp,
        last_ingest_refresh: metadata.last_ingest_refresh,
        last_publish_refresh: metadata.last_publish_refresh,
      },
      count: filtered.length,
      items: filtered,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
      },
    }
  );
}
