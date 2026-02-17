import path from "node:path";
import { promises as fs } from "node:fs";
import type { NewsMetadata, StateContext, StateNewsItem, StateNewsSnapshot } from "../../lib/types";
import {
  canonicalStateName,
  fetchGoogleNews,
  fetchWikipediaSummary,
  mergeNewsItems,
} from "../../lib/news";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const LOCATION_CELLS_PATH = path.join(DATA_DIR, "location-cells.json");
const NEWS_SNAPSHOTS_PATH = path.join(DATA_DIR, "state-news-snapshots.json");
const NEWS_METADATA_PATH = path.join(DATA_DIR, "news-metadata.json");

function weekStamp(date: Date): string {
  const firstDay = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const daysSince = Math.floor((date.getTime() - firstDay.getTime()) / 86_400_000);
  const week = Math.ceil((daysSince + firstDay.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function fetchCategorizedNews(state: string): Promise<{
  positive: StateNewsItem[];
  local: StateNewsItem[];
  dispute: StateNewsItem[];
}> {
  const [positivePrimary, positiveFallback, localPrimary, localFallback, disputePrimary, disputeFallback] =
    await Promise.all([
      fetchGoogleNews(
        `${state} Nigeria real estate development OR housing project OR mortgage OR investment OR estate expansion`
      ),
      fetchGoogleNews(`Nigeria real estate investment growth housing project ${state}`),
      fetchGoogleNews(`${state} Nigeria property OR housing OR flood OR infrastructure`),
      fetchGoogleNews(`Nigeria property market housing infrastructure ${state}`),
      fetchGoogleNews(`${state} Nigeria Omonile OR land dispute OR land grabbing OR title fraud`),
      fetchGoogleNews(`Nigeria land dispute title fraud eviction ${state}`),
    ]);

  return {
    positive: mergeNewsItems(20, positivePrimary, positiveFallback),
    local: mergeNewsItems(20, localPrimary, localFallback),
    dispute: mergeNewsItems(20, disputePrimary, disputeFallback),
  };
}

function defaultHighlights(): string[] {
  return [
    "Check flood and drainage exposure before committing to land purchase.",
    "Compare road access for commute, resale value, and rental demand.",
    "Track security and neighborhood activity trends over time.",
  ];
}

function buildNewsMetrics(
  news: { positive: StateNewsItem[]; local: StateNewsItem[]; dispute: StateNewsItem[] },
  previous?: StateNewsSnapshot,
  lastRefresh?: string,
  sourceStamp?: string
): NonNullable<StateContext["news_metrics"]> {
  const positiveCount = news.positive.length;
  const localCount = news.local.length;
  const disputeCount = news.dispute.length;

  const previousPositive = previous?.news_metrics?.positive_count ?? previous?.positive_news.length ?? 0;
  const previousLocal = previous?.news_metrics?.local_count ?? previous?.news.length ?? 0;
  const previousDispute = previous?.news_metrics?.dispute_count ?? previous?.dispute_news.length ?? 0;

  return {
    positive_count: positiveCount,
    local_count: localCount,
    dispute_count: disputeCount,
    positive_delta: positiveCount - previousPositive,
    local_delta: localCount - previousLocal,
    dispute_delta: disputeCount - previousDispute,
    last_refresh: lastRefresh ?? null,
    source_stamp: sourceStamp ?? null,
  };
}

async function main() {
  const now = new Date();
  const refreshedAt = now.toISOString();
  const sourceStamp = weekStamp(now);

  const [cells, previousSnapshots, previousMetadata] = await Promise.all([
    readJson<Array<{ state: string }>>(LOCATION_CELLS_PATH, []),
    readJson<StateNewsSnapshot[]>(NEWS_SNAPSHOTS_PATH, []),
    readJson<NewsMetadata>(NEWS_METADATA_PATH, {
      source_name: "Google News RSS + Wikipedia",
      source_url: "https://news.google.com/rss",
      update_frequency: "weekly",
      last_refresh: "1970-01-01T00:00:00.000Z",
      source_stamp: "bootstrap",
      coverage_notes:
        "State-level categorized news snapshots (good news, local news, dispute signals) with summary and image context.",
      states_processed: 0,
    }),
  ]);

  if (previousMetadata.source_stamp === sourceStamp) {
    console.log(`[news] Source unchanged (${sourceStamp}). Skipping refresh.`);
    return;
  }

  const uniqueStates = [...new Set(cells.map((cell) => canonicalStateName(cell.state)))].sort((left, right) =>
    left.localeCompare(right)
  );

  const previousByState = new globalThis.Map(
    previousSnapshots.map((snapshot) => [canonicalStateName(snapshot.state).toLowerCase(), snapshot])
  );

  const snapshots: StateNewsSnapshot[] = [];

  for (const state of uniqueStates) {
    const [wiki, categorizedNews] = await Promise.all([
      fetchWikipediaSummary(state),
      fetchCategorizedNews(state),
    ]);

    const previous = previousByState.get(state.toLowerCase());

    snapshots.push({
      state,
      image_url: wiki.image_url,
      summary: wiki.summary,
      highlights: defaultHighlights(),
      positive_news: categorizedNews.positive,
      news: categorizedNews.local,
      dispute_news: categorizedNews.dispute,
      news_metrics: buildNewsMetrics(categorizedNews, previous, refreshedAt, sourceStamp),
      last_refresh: refreshedAt,
      source_stamp: sourceStamp,
    });

    console.log(
      `[news] ${state}: +${categorizedNews.positive.length} good, +${categorizedNews.local.length} local, +${categorizedNews.dispute.length} disputes`
    );
  }

  const metadata: NewsMetadata = {
    source_name: "Google News RSS + Wikipedia",
    source_url: "https://news.google.com/rss",
    update_frequency: "weekly",
    last_refresh: refreshedAt,
    source_stamp: sourceStamp,
    coverage_notes:
      "State-level categorized news snapshots (good news, local news, dispute signals) with summary and image context.",
    states_processed: snapshots.length,
  };

  await Promise.all([
    fs.writeFile(NEWS_SNAPSHOTS_PATH, `${JSON.stringify(snapshots, null, 2)}\n`, "utf8"),
    fs.writeFile(NEWS_METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
  ]);

  console.log(`[news] Updated ${snapshots.length} states for source ${sourceStamp}.`);
}

main().catch((error) => {
  console.error("[news] Job failed", error);
  process.exit(1);
});
