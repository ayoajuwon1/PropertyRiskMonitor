import { NextResponse } from "next/server";
import { getNewsMetadata, getStateNewsSnapshots } from "@/lib/data-store";
import { canonicalStateName } from "@/lib/news";
import type { StateContext } from "@/lib/types";

interface Params {
  params: Promise<{ state: string }>;
}

function keyState(value: string): string {
  return canonicalStateName(value)
    .toLowerCase()
    .replace(/\bstate\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(_request: Request, { params }: Params) {
  const { state } = await params;
  const requestedState = canonicalStateName(decodeURIComponent(state).replace(/[-_]+/g, " ").trim());

  const [snapshots, metadata] = await Promise.all([getStateNewsSnapshots(), getNewsMetadata()]);

  const requestedKey = keyState(requestedState);
  const snapshot = snapshots.find((entry) => keyState(entry.state) === requestedKey);

  const payload: StateContext = snapshot
    ? {
        state: snapshot.state,
        image_url: snapshot.image_url,
        summary: snapshot.summary,
        highlights: snapshot.highlights,
        positive_news: snapshot.positive_news,
        news: snapshot.news,
        dispute_news: snapshot.dispute_news,
        news_metrics: snapshot.news_metrics,
      }
    : {
        state: requestedState,
        image_url: null,
        summary: null,
        highlights: [
          "Check flood and drainage exposure before committing to land purchase.",
          "Compare road access for commute, resale value, and rental demand.",
          "Track security and neighborhood activity trends over time.",
        ],
        positive_news: [],
        news: [],
        dispute_news: [],
        news_metrics: {
          positive_count: 0,
          local_count: 0,
          dispute_count: 0,
          positive_delta: 0,
          local_delta: 0,
          dispute_delta: 0,
          last_refresh: metadata.last_refresh,
          source_stamp: metadata.source_stamp,
        },
      };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
    },
  });
}
