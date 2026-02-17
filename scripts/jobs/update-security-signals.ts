import path from "node:path";
import { promises as fs } from "node:fs";
import { canonicalStateName, fetchGoogleNews, fetchWithTimeout } from "../../lib/news";
import {
  aggregateSecurityByState,
  buildNationalFallbackQueries,
  buildStateBooleanQueries,
  computeEventContribution,
  dedupeSecurityEvents,
  heuristicExtractSecurityEvent,
  sanitizeGeminiEvent,
  quarterStamp,
  type GeminiEventExtraction,
  type SecurityCandidateItem,
  weekStamp,
} from "../../lib/security-signals";
import type {
  LayerMetadata,
  SecurityEvent,
  SecurityMetadata,
  SecuritySourceType,
  SecurityStateAggregate,
} from "../../lib/types";
import {
  clampScore,
  deterministicValue,
  loadContext,
  recomputeComposite,
  saveContext,
  sameSource,
  updateVersionStamp,
} from "./shared";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const SECURITY_EVENTS_PATH = path.join(DATA_DIR, "security-events-snapshots.json");
const SECURITY_STATE_AGGREGATES_PATH = path.join(DATA_DIR, "security-state-aggregates.json");
const SECURITY_METADATA_PATH = path.join(DATA_DIR, "security-metadata.json");

function normalizeStateLookup(state: string): string {
  return canonicalStateName(state).toLowerCase().replace(/\bstate\b/g, "").replace(/\s+/g, " ").trim();
}

function parseJsonBlock<T>(value: string): T | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

function normalizeHeadline(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeCandidates(items: SecurityCandidateItem[]): SecurityCandidateItem[] {
  const byKey = new globalThis.Map<string, SecurityCandidateItem>();
  for (const item of items) {
    const key = `${normalizeHeadline(item.headline)}|${item.link}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function parseAcledCategory(text: string) {
  const lowered = text.toLowerCase();
  if (/\bboko\s*haram\b|\biswap\b|\bterror\b|\binsurgent\b/.test(lowered)) {
    return "terror_attack";
  }
  if (/\bbandit\b|\bgunmen\b/.test(lowered)) {
    return "bandit_attack";
  }
  if (/\bkidnap|\babduct|\bransom\b/.test(lowered)) {
    return "kidnapping";
  }
  if (/\bcommunal\b|\bclash\b|\bfarmer\b|\bherder\b/.test(lowered)) {
    return "communal_clash";
  }
  if (/\barmed robbery\b|\brobbery\b/.test(lowered)) {
    return "armed_robbery";
  }
  if (/\bcult\b/.test(lowered)) {
    return "cult_violence";
  }
  if (/\bland dispute\b|\bland grabbing\b|\bboundary\b|\btitle fraud\b/.test(lowered)) {
    return "violent_land_dispute";
  }
  return "other_security_event";
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSourceTypeCounts(events: SecurityEvent[]): Record<SecuritySourceType, number> {
  const counts: Record<SecuritySourceType, number> = { acled: 0, news: 0, social: 0 };
  for (const event of events) {
    counts[event.source_type] += 1;
  }
  return counts;
}

function calcNationalConfidence(aggregates: SecurityStateAggregate[]): number {
  if (aggregates.length === 0) {
    return 0;
  }
  return clampScore(
    aggregates.reduce((sum, entry) => sum + entry.security_confidence_score, 0) / Math.max(1, aggregates.length)
  );
}

function ensureSecurityLayerMetadata(
  metadata: LayerMetadata[],
  refreshedAt: string,
  shouldPublish: boolean
): LayerMetadata[] {
  return metadata.map((layer) => {
    if (layer.layer_name !== "security") {
      return layer;
    }

    return {
      ...layer,
      source_name: "ACLED + Google News Boolean + Gemini extraction",
      source_url: "https://acleddata.com/, https://news.google.com/rss",
      update_frequency: "quarterly",
      coverage_notes:
        "Quarterly-published security baseline from a rolling 90-day Nigeria-specific event pipeline with weekly ingestion.",
      last_refresh: shouldPublish ? refreshedAt : layer.last_refresh,
    };
  });
}

function weekStartIso(date: Date): string {
  const cloned = new Date(date);
  const day = cloned.getUTCDay() || 7;
  cloned.setUTCDate(cloned.getUTCDate() - (day - 1));
  cloned.setUTCHours(0, 0, 0, 0);
  return cloned.toISOString();
}

async function fetchAcledCandidates(
  states: string[],
  windowStartIso: string,
  nowIso: string
): Promise<SecurityCandidateItem[]> {
  const key = process.env.ACLED_API_KEY;
  const email = process.env.ACLED_EMAIL;
  if (!key || !email) {
    return [];
  }

  const endpoint = process.env.ACLED_ENDPOINT ?? "https://api.acleddata.com/acled/read";
  const params = new URLSearchParams({
    key,
    email,
    country: "Nigeria",
    event_date_where: "BETWEEN",
    event_date: `${windowStartIso.slice(0, 10)}|${nowIso.slice(0, 10)}`,
    limit: "1000",
  });

  try {
    const response = await fetchWithTimeout(`${endpoint}?${params.toString()}`, { cache: "no-store" }, 10_000);
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      data?: Array<{
        data_id?: string | number;
        event_date?: string;
        admin1?: string;
        admin2?: string;
        event_type?: string;
        sub_event_type?: string;
        notes?: string;
        fatalities?: string | number;
        source?: string;
      }>;
    };

    const stateLookup = new globalThis.Map(states.map((state) => [normalizeStateLookup(state), canonicalStateName(state)]));

    return (payload.data ?? [])
      .map((entry) => {
        const stateKey = normalizeStateLookup(entry.admin1 ?? "");
        const state = stateLookup.get(stateKey);
        if (!state) {
          return null;
        }
        const headline = `${entry.sub_event_type ?? entry.event_type ?? "Security incident"} in ${state}`;
        const details = `${entry.sub_event_type ?? ""} ${entry.notes ?? ""}`;
        const fatalities =
          typeof entry.fatalities === "string" ? Number(entry.fatalities) : typeof entry.fatalities === "number" ? entry.fatalities : 0;
        const category = parseAcledCategory(details);

        const eventUrl = `https://acleddata.com/#/dashboard?event=${entry.data_id ?? ""}`;
        const eventDate = entry.event_date ? new Date(entry.event_date).toISOString() : new Date().toISOString();

        return {
          headline: `${headline} (${category})`,
          link: eventUrl,
          source_name: entry.source ?? "ACLED",
          published_at: eventDate,
          source_type: "acled" as const,
          query: "ACLED structured events",
          query_state: state,
          _fatalities: Number.isFinite(fatalities) ? Math.max(0, Math.round(fatalities)) : 0,
          _city: entry.admin2 ?? null,
          _category: category,
          _event_date: eventDate,
          _event_id: String(entry.data_id ?? ""),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        headline: item.headline,
        link: item.link,
        source_name: item.source_name,
        published_at: item.published_at,
        source_type: item.source_type,
        query: item.query,
        query_state: item.query_state,
      }));
  } catch {
    return [];
  }
}

async function fetchStateCandidates(
  state: string,
  nationalFallbackPool: SecurityCandidateItem[]
): Promise<SecurityCandidateItem[]> {
  const queries = buildStateBooleanQueries(state);
  const fetched = await Promise.all(queries.map((query) => fetchGoogleNews(query)));

  const stateKey = normalizeStateLookup(state);
  const nationalMapped = nationalFallbackPool.filter((item) =>
    normalizeHeadline(item.headline).includes(stateKey)
  );

  const stateCandidates = fetched.flatMap((group, index) =>
    group.map((item) => ({
      headline: item.title,
      link: item.link,
      source_name: item.source,
      published_at: item.published_at,
      source_type: "news" as const,
      query: queries[index],
      query_state: state,
    }))
  );

  return dedupeCandidates([...stateCandidates, ...nationalMapped]);
}

async function fetchNationalFallbackPool(states: string[]): Promise<SecurityCandidateItem[]> {
  const queries = buildNationalFallbackQueries();
  const fetched = await Promise.all(queries.map((query) => fetchGoogleNews(query)));

  const byState = new Set(states.map((state) => normalizeStateLookup(state)));

  return dedupeCandidates(
    fetched.flatMap((group, index) =>
      group
        .map((item) => {
          const normalized = normalizeHeadline(item.title);
          const matchedState = [...byState].find((state) => normalized.includes(state)) ?? null;
          return {
            headline: item.title,
            link: item.link,
            source_name: item.source,
            published_at: item.published_at,
            source_type: "news" as const,
            query: queries[index],
            query_state: matchedState,
          } satisfies SecurityCandidateItem;
        })
        .filter((item) => item.query_state !== null)
    )
  );
}

async function extractStateEventsWithGemini(
  state: string,
  candidates: SecurityCandidateItem[],
  allStates: string[],
  ingestionStamp: string
): Promise<SecurityEvent[] | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || candidates.length === 0) {
    return null;
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const compactItems = candidates.slice(0, 24).map((candidate) => ({
    headline: candidate.headline,
    source_url: candidate.link,
    source_name: candidate.source_name,
    published_at: candidate.published_at,
    query: candidate.query,
  }));

  const prompt = [
    "You are extracting Nigeria security incidents for a property risk model.",
    `Primary state focus: ${canonicalStateName(state)}`,
    `Known states: ${allStates.join(", ")}`,
    "Return ONLY valid JSON with this shape:",
    '{ "events": [{ "event_id_candidate": string, "headline": string, "event_date": string, "state": string, "lga_or_city": string|null, "category": "kidnapping|bandit_attack|terror_attack|communal_clash|armed_robbery|cult_violence|violent_land_dispute|other_security_event", "killed_count": number|null, "kidnapped_count": number|null, "injured_count": number|null, "source_name": string, "source_url": string, "source_type": "news|acled|social", "confidence": number, "relevance": number, "is_duplicate_of": string|null }] }',
    "Rules: confidence and relevance are 0..1. Ignore non-security stories.",
    `Items: ${JSON.stringify(compactItems)}`,
  ].join("\n");

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
        cache: "no-store",
      },
      18_000
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const responseText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
    const parsed = parseJsonBlock<{ events?: GeminiEventExtraction[] }>(responseText);
    if (!parsed?.events || !Array.isArray(parsed.events)) {
      return null;
    }

    const byUrl = new globalThis.Map(candidates.map((candidate) => [candidate.link, candidate]));
    const byHeadline = new globalThis.Map(candidates.map((candidate) => [normalizeHeadline(candidate.headline), candidate]));

    const extracted: SecurityEvent[] = [];
    for (const raw of parsed.events) {
      const candidate =
        (typeof raw.source_url === "string" ? byUrl.get(raw.source_url) : undefined) ??
        (typeof raw.headline === "string" ? byHeadline.get(normalizeHeadline(raw.headline)) : undefined);
      if (!candidate) {
        continue;
      }
      const event = sanitizeGeminiEvent(raw, candidate, allStates, ingestionStamp);
      if (event) {
        extracted.push(event);
      }
    }

    return extracted;
  } catch {
    return null;
  }
}

async function runLegacyDeterministicSecurity() {
  const now = new Date();
  const refreshedAt = now.toISOString();
  const sourceStamp = weekStamp(now);
  const context = await loadContext();

  if (sameSource(context.versions.security.source_stamp, sourceStamp)) {
    console.log(`[security] Source unchanged (${sourceStamp}). Skipping recompute.`);
    return;
  }

  context.cells = context.cells.map((cell) => {
    const incidentPressure = deterministicValue(cell.id, sourceStamp, "security-incidents", 10, 95);
    const neighborhoodResilience = deterministicValue(cell.id, sourceStamp, "security-resilience", 18, 92);
    const securityScore = clampScore(0.72 * incidentPressure + 0.28 * (100 - neighborhoodResilience));

    const nextCell = {
      ...cell,
      security_incident_index: incidentPressure,
      security_score: securityScore,
      security_confidence_score: 54,
      security_event_count_90d: 0,
      security_top_threat: null,
      last_updated_security: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(nextCell);
  });

  context.metadata = context.metadata.map((layer) =>
    layer.layer_name === "security"
      ? {
          ...layer,
          last_refresh: refreshedAt,
        }
      : layer
  );
  context.versions = updateVersionStamp(context.versions, "security", sourceStamp, refreshedAt);

  await saveContext(context);
  console.log(`[security] Legacy mode updated ${context.cells.length} cells for source ${sourceStamp}.`);
}

async function main() {
  const securityIntelEnabled = process.env.SECURITY_INTEL_V2 !== "false";
  if (!securityIntelEnabled) {
    await runLegacyDeterministicSecurity();
    return;
  }

  const now = new Date();
  const refreshedAt = now.toISOString();
  const ingestStamp = weekStamp(now);
  const publishStamp = quarterStamp(now);
  const forcePublish = process.env.FORCE_SECURITY_PUBLISH === "true";
  const context = await loadContext();

  const previousMetadata = await readJson<SecurityMetadata>(SECURITY_METADATA_PATH, {
    source_name: "ACLED + Google News + Gemini extraction",
    source_url: "https://acleddata.com/, https://news.google.com/rss",
    ingest_frequency: "weekly",
    publish_frequency: "quarterly",
    last_ingest_refresh: new Date(0).toISOString(),
    last_publish_refresh: new Date(0).toISOString(),
    ingest_source_stamp: "bootstrap",
    publish_source_stamp: "bootstrap",
    coverage_notes:
      "Quarterly published security baseline from rolling 90-day Nigeria-specific insecurity events.",
    source_mix: [],
    states_processed: 0,
    events_processed_90d: 0,
    national_confidence_score: 0,
  });

  if (
    previousMetadata.ingest_source_stamp === ingestStamp &&
    previousMetadata.publish_source_stamp === publishStamp &&
    !forcePublish
  ) {
    console.log(`[security-signals] Source unchanged (${ingestStamp}/${publishStamp}). Skipping refresh.`);
    return;
  }

  const states = [...new Set(context.cells.map((cell) => canonicalStateName(cell.state)))].sort((left, right) =>
    left.localeCompare(right)
  );
  const windowStart = new Date(now.getTime() - 90 * 86_400_000).toISOString();

  const nationalFallbackPool = await fetchNationalFallbackPool(states);
  const acledCandidates = await fetchAcledCandidates(states, windowStart, refreshedAt);
  const allEvents: SecurityEvent[] = [];

  for (const state of states) {
    const stateCandidates = await fetchStateCandidates(state, nationalFallbackPool);
    const withAcledState = [
      ...stateCandidates,
      ...acledCandidates.filter((candidate) => normalizeStateLookup(candidate.query_state ?? "") === normalizeStateLookup(state)),
    ];
    const dedupedCandidates = dedupeCandidates(withAcledState).slice(0, 30);

    if (dedupedCandidates.length === 0) {
      continue;
    }

    const geminiExtracted = await extractStateEventsWithGemini(state, dedupedCandidates, states, ingestStamp);
    const stateEvents =
      geminiExtracted && geminiExtracted.length > 0
        ? geminiExtracted
        : dedupedCandidates
            .map((candidate) => heuristicExtractSecurityEvent(candidate, states, ingestStamp))
            .filter((event): event is SecurityEvent => Boolean(event));

    allEvents.push(...stateEvents);
    console.log(`[security-signals] ${state}: candidates=${dedupedCandidates.length}, events=${stateEvents.length}`);
  }

  const dedupedEvents = dedupeSecurityEvents(allEvents)
    .map((event) => {
      const contribution = computeEventContribution(event, now);
      return {
        ...event,
        id: `${normalizeStateLookup(event.state)}-${event.event_date.slice(0, 10)}-${Math.abs(
          `${event.headline}|${event.source_url}`.split("").reduce((sum, char) => sum * 31 + char.charCodeAt(0), 0)
        )}`,
        contribution: Number(contribution.toFixed(4)),
      };
    })
    .filter((event) => event.relevance >= 0.35)
    .filter((event) => new Date(event.event_date).getTime() >= new Date(windowStart).getTime());

  const aggregates = aggregateSecurityByState(dedupedEvents, states, now, ingestStamp, publishStamp, refreshedAt);
  const aggregateByState = new globalThis.Map(aggregates.map((entry) => [normalizeStateLookup(entry.state), entry]));

  const shouldPublish = forcePublish || previousMetadata.publish_source_stamp !== publishStamp;

  context.cells = context.cells.map((cell) => {
    const aggregate = aggregateByState.get(normalizeStateLookup(cell.state));
    if (!aggregate) {
      return cell;
    }

    const withWeeklyDetails = {
      ...cell,
      security_confidence_score: aggregate.security_confidence_score,
      security_event_count_90d: aggregate.security_event_count_90d,
      security_top_threat: aggregate.security_top_threat,
    };

    if (!shouldPublish) {
      return withWeeklyDetails;
    }

    const published = {
      ...withWeeklyDetails,
      security_incident_index: aggregate.security_incident_index,
      security_score: aggregate.security_score,
      last_updated_security: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(published);
  });

  context.metadata = ensureSecurityLayerMetadata(context.metadata, refreshedAt, shouldPublish);

  if (shouldPublish) {
    context.versions = updateVersionStamp(context.versions, "security", publishStamp, refreshedAt);
  }

  const sourceTypeCounts = toSourceTypeCounts(dedupedEvents);
  const sourceMix = Object.entries(sourceTypeCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([sourceType]) => sourceType);

  const securityMetadata: SecurityMetadata = {
    source_name: "ACLED + Google News Boolean + Gemini extraction",
    source_url: "https://acleddata.com/, https://news.google.com/rss",
    ingest_frequency: "weekly",
    publish_frequency: "quarterly",
    last_ingest_refresh: refreshedAt,
    last_publish_refresh: shouldPublish ? refreshedAt : previousMetadata.last_publish_refresh,
    ingest_source_stamp: ingestStamp,
    publish_source_stamp: shouldPublish ? publishStamp : previousMetadata.publish_source_stamp,
    coverage_notes:
      "Quarterly-published security baseline from rolling 90-day Nigeria-specific insecurity events, with weekly ingestion updates.",
    source_mix: sourceMix,
    states_processed: states.length,
    events_processed_90d: dedupedEvents.length,
    national_confidence_score: calcNationalConfidence(aggregates),
  };

  await Promise.all([
    saveContext(context),
    fs.writeFile(SECURITY_EVENTS_PATH, `${JSON.stringify(dedupedEvents, null, 2)}\n`, "utf8"),
    fs.writeFile(SECURITY_STATE_AGGREGATES_PATH, `${JSON.stringify(aggregates, null, 2)}\n`, "utf8"),
    fs.writeFile(SECURITY_METADATA_PATH, `${JSON.stringify(securityMetadata, null, 2)}\n`, "utf8"),
  ]);

  console.log(
    `[security-signals] Updated ${states.length} states | events=${dedupedEvents.length} | publish=${shouldPublish ? "yes" : "no"} | ingest=${ingestStamp} publishStamp=${publishStamp}`
  );
}

main().catch((error) => {
  console.error("[security-signals] Job failed", error);
  process.exit(1);
});
