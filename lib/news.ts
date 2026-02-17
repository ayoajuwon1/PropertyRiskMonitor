import type { StateNewsItem } from "@/lib/types";

export const STATE_ALIAS: Record<string, string> = {
  "abuja federal capital territory": "Abuja",
  "federal capital territory": "Abuja",
  "fct": "Abuja",
  "akwa ibom": "Akwa Ibom",
  "cross river": "Cross River",
  "nassarawa": "Nasarawa",
};

export function decodeText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? decodeText(match[1]) : "";
}

export function canonicalStateName(input: string): string {
  const decoded = decodeURIComponent(input).replace(/[-_]+/g, " ").trim();
  const lowered = decoded.toLowerCase();
  return STATE_ALIAS[lowered] ?? decoded;
}

export function normalizeStateForWiki(input: string): string {
  const canonical = canonicalStateName(input);
  const lowered = canonical.toLowerCase();

  if (lowered === "abuja" || lowered === "abuja federal capital territory") {
    return "Abuja";
  }

  if (lowered.endsWith("state")) {
    return canonical;
  }

  return `${canonical} State`;
}

export function parseRssItems(xml: string, maxItems = 20): StateNewsItem[] {
  const items: StateNewsItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;

  for (const match of xml.matchAll(itemPattern)) {
    const block = match[1] ?? "";
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const published = extractTag(block, "pubDate");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch?.[1] ? decodeText(sourceMatch[1]) : "Google News";

    if (!title || !link) {
      continue;
    }

    const publishedDate = new Date(published || "");
    const publishedIso = Number.isNaN(publishedDate.getTime())
      ? new Date().toISOString()
      : publishedDate.toISOString();

    items.push({
      title,
      link,
      source,
      published_at: publishedIso,
    });

    if (items.length >= maxItems) {
      break;
    }
  }

  return dedupeNewsItems(items).slice(0, maxItems);
}

export function dedupeNewsItems(items: StateNewsItem[]): StateNewsItem[] {
  const deduped = new globalThis.Map<string, StateNewsItem>();
  for (const item of items) {
    const key = `${item.title.toLowerCase().trim()}|${item.link}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()].sort(
    (left, right) => new Date(right.published_at).getTime() - new Date(left.published_at).getTime()
  );
}

export function mergeNewsItems(maxItems: number, ...groups: StateNewsItem[][]): StateNewsItem[] {
  return dedupeNewsItems(groups.flat()).slice(0, maxItems);
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 6500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGoogleNews(query: string): Promise<StateNewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-NG&gl=NG&ceid=NG:en`;

  try {
    const response = await fetchWithTimeout(url, { cache: "no-store" }, 6500);
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    return parseRssItems(xml, 20);
  } catch {
    return [];
  }
}

export async function fetchWikipediaSummary(
  state: string
): Promise<{ image_url: string | null; summary: string | null }> {
  const pageTitle = normalizeStateForWiki(state);
  const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;

  try {
    const response = await fetchWithTimeout(
      wikiUrl,
      {
        headers: {
          "User-Agent": "NPRM/1.0 (Property risk dashboard)",
          Accept: "application/json",
        },
        cache: "no-store",
      },
      6500
    );

    if (!response.ok) {
      return { image_url: null, summary: null };
    }

    const json = (await response.json()) as {
      extract?: string;
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    };

    return {
      image_url: json.originalimage?.source ?? json.thumbnail?.source ?? null,
      summary: json.extract ?? null,
    };
  } catch {
    return { image_url: null, summary: null };
  }
}
