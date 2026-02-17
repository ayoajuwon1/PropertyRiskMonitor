import { canonicalStateName } from "@/lib/news";
import type {
  SecurityEvent,
  SecuritySourceType,
  SecurityStateAggregate,
  SecurityThreatCategory,
  SecurityThreatCount,
} from "@/lib/types";

export interface SecurityCandidateItem {
  headline: string;
  link: string;
  source_name: string;
  published_at: string;
  source_type: SecuritySourceType;
  query: string;
  query_state: string | null;
}

export interface GeminiEventExtraction {
  event_id_candidate?: string;
  headline?: string;
  event_date?: string;
  state?: string;
  lga_or_city?: string | null;
  category?: SecurityThreatCategory;
  killed_count?: number | null;
  kidnapped_count?: number | null;
  injured_count?: number | null;
  source_name?: string;
  source_url?: string;
  source_type?: SecuritySourceType;
  confidence?: number;
  relevance?: number;
  is_duplicate_of?: string | null;
}

const TYPE_BASE_WEIGHTS: Record<SecurityThreatCategory, number> = {
  kidnapping: 34,
  bandit_attack: 38,
  terror_attack: 42,
  communal_clash: 24,
  armed_robbery: 20,
  cult_violence: 19,
  violent_land_dispute: 16,
  other_security_event: 12,
};

const SOURCE_RELIABILITY_DEFAULTS: Record<SecuritySourceType, number> = {
  acled: 0.95,
  news: 0.74,
  social: 0.58,
};

const HIGH_TRUST_NEWS_DOMAINS = [
  "premiumtimesng.com",
  "punchng.com",
  "vanguardngr.com",
  "guardian.ng",
  "thisdaylive.com",
  "businessday.ng",
  "thecable.ng",
  "channelstv.com",
  "dailytrust.com",
  "leadership.ng",
];

const MEDIUM_TRUST_NEWS_DOMAINS = ["tribuneonlineng.com", "sunnewsonline.com", "nairametrics.com"];

const THREAT_KEYWORD_RULES: Array<{ category: SecurityThreatCategory; match: RegExp }> = [
  {
    category: "kidnapping",
    match: /\bkidnap(?:ped|ping)?\b|\babduct(?:ed|ion)?\b|\bransom\b/i,
  },
  {
    category: "terror_attack",
    match: /\bterror(?:ist|ism)?\b|\bboko\s*haram\b|\biswap\b|\binsurgenc(?:y|ies)\b/i,
  },
  {
    category: "bandit_attack",
    match: /\bbandit(?:s|ry)?\b|\bgunmen\b|\braid(?:ed|ing)?\b/i,
  },
  {
    category: "communal_clash",
    match: /\bcommunal\b|\bclash(?:es)?\b|\bfarmer(?:-|\s)?herder\b|\bethnic violence\b/i,
  },
  {
    category: "armed_robbery",
    match: /\barmed robbery\b|\brobber(?:y|ies)\b|\bhighway robbery\b/i,
  },
  {
    category: "cult_violence",
    match: /\bcult(?:ist)?\b|\bgang clash\b|\bsecret cult\b/i,
  },
  {
    category: "violent_land_dispute",
    match: /\bland dispute\b|\bland grabbing\b|\bboundary conflict\b|\btitle fraud\b/i,
  },
];

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "from",
  "over",
  "under",
  "after",
  "before",
  "nigeria",
  "state",
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeIsoDate(value: string | null | undefined): string {
  const parsed = new Date(value ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function tokenizeHeadline(value: string): string[] {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function headlineSignature(value: string): string {
  const tokens = tokenizeHeadline(value);
  return tokens.slice(0, 8).join(" ");
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) {
    return null;
  }
  return Math.round(value);
}

function extractCount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const numeric = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric);
    }
  }
  return null;
}

function inferDateInText(text: string, fallbackIso: string): string {
  const pattern = /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/;
  const match = text.match(pattern);
  if (!match?.[1]) {
    return fallbackIso;
  }
  const parsed = new Date(match[1]);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackIso;
  }
  return parsed.toISOString();
}

function normalizeStateLookup(state: string): string {
  return canonicalStateName(state).toLowerCase().replace(/\bstate\b/g, "").replace(/\s+/g, " ").trim();
}

function inferStateFromText(text: string, states: string[], fallbackState: string | null): string | null {
  const lowered = text.toLowerCase();
  const stateHit = states.find((state) => {
    const normalized = normalizeStateLookup(state);
    if (normalized === "abuja federal capital territory" || normalized === "federal capital territory") {
      return /\bfct\b|\babuja\b/.test(lowered);
    }
    return lowered.includes(normalized);
  });

  if (stateHit) {
    return canonicalStateName(stateHit);
  }

  return fallbackState ? canonicalStateName(fallbackState) : null;
}

function inferSourceReliability(sourceType: SecuritySourceType, sourceUrl: string): number {
  if (sourceType !== "news") {
    return SOURCE_RELIABILITY_DEFAULTS[sourceType];
  }

  const lowered = sourceUrl.toLowerCase();
  if (HIGH_TRUST_NEWS_DOMAINS.some((domain) => lowered.includes(domain))) {
    return 0.88;
  }
  if (MEDIUM_TRUST_NEWS_DOMAINS.some((domain) => lowered.includes(domain))) {
    return 0.8;
  }
  return SOURCE_RELIABILITY_DEFAULTS.news;
}

export function quarterStamp(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

export function weekStamp(date: Date): string {
  const firstDay = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const daysSince = Math.floor((date.getTime() - firstDay.getTime()) / 86_400_000);
  const week = Math.ceil((daysSince + firstDay.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function buildStateBooleanQueries(state: string): string[] {
  const canonical = canonicalStateName(state);

  return [
    `${canonical} AND (kidnap* OR abduction OR ransom OR bandit* OR gunmen OR "Boko Haram" OR ISWAP OR terror* OR "land dispute" OR "land grabbing" OR "communal clash" OR "armed robbery" OR cult*) AND (Nigeria OR Naija)`,
    `${canonical} AND (insecurity OR attack OR violence OR clash OR robbery) AND Nigeria`,
  ];
}

export function buildNationalFallbackQueries(): string[] {
  return [
    `Nigeria (kidnap* OR abduction OR ransom)`,
    `Nigeria (bandit* OR gunmen OR terror* OR "Boko Haram" OR ISWAP)`,
    `Nigeria ("communal clash" OR "armed robbery" OR cult OR "land dispute" OR "land grabbing")`,
  ];
}

export function inferThreatCategory(text: string): SecurityThreatCategory {
  for (const rule of THREAT_KEYWORD_RULES) {
    if (rule.match.test(text)) {
      return rule.category;
    }
  }
  return "other_security_event";
}

export function heuristicExtractSecurityEvent(
  candidate: SecurityCandidateItem,
  states: string[],
  ingestionStamp: string
): SecurityEvent | null {
  const combinedText = `${candidate.headline} ${candidate.query}`;
  const state = inferStateFromText(combinedText, states, candidate.query_state);
  if (!state) {
    return null;
  }

  const category = inferThreatCategory(combinedText);
  const fallbackDate = safeIsoDate(candidate.published_at);

  const killedCount = extractCount(combinedText, [
    /\b(\d{1,4})\s+(?:people|persons|residents)?\s*(?:killed|dead)\b/i,
    /\bdeath toll(?:\s+of)?\s+(\d{1,4})\b/i,
    /\bkilled\s+(\d{1,4})\b/i,
  ]);
  const kidnappedCount = extractCount(combinedText, [
    /\b(\d{1,4})\s+(?:people|persons|residents)?\s*(?:kidnapped|abducted)\b/i,
    /\babduct(?:ed|ion)\s+of\s+(\d{1,4})\b/i,
    /\bkidnap(?:ped|ping)?\s+(\d{1,4})\b/i,
    /\babduct(?:ed|ion)?\s+(\d{1,4})\b/i,
  ]);
  const injuredCount = extractCount(combinedText, [
    /\b(\d{1,4})\s+(?:people|persons|residents)?\s*(?:injured|wounded)\b/i,
    /\binjured\s+(\d{1,4})\b/i,
  ]);

  const relevance = clamp01(
    0.45 +
      (category === "other_security_event" ? 0 : 0.24) +
      (killedCount || kidnappedCount || injuredCount ? 0.16 : 0)
  );

  return {
    id: "",
    event_id_candidate: `${state}-${Date.parse(fallbackDate)}-${headlineSignature(candidate.headline)}`,
    headline: candidate.headline,
    event_date: inferDateInText(candidate.headline, fallbackDate),
    state: canonicalStateName(state),
    lga_or_city: null,
    category,
    killed_count: killedCount,
    kidnapped_count: kidnappedCount,
    injured_count: injuredCount,
    source_name: candidate.source_name,
    source_url: candidate.link,
    source_type: candidate.source_type,
    confidence: 0.56,
    relevance,
    is_duplicate_of: null,
    source_query: candidate.query,
    published_at: fallbackDate,
    ingestion_stamp: ingestionStamp,
    contribution: 0,
  };
}

export function sanitizeGeminiEvent(
  extraction: GeminiEventExtraction,
  candidate: SecurityCandidateItem,
  states: string[],
  ingestionStamp: string
): SecurityEvent | null {
  const fallback = heuristicExtractSecurityEvent(candidate, states, ingestionStamp);
  if (!fallback) {
    return null;
  }

  const state = extraction.state ? inferStateFromText(extraction.state, states, fallback.state) : fallback.state;
  if (!state) {
    return null;
  }

  const category =
    extraction.category && TYPE_BASE_WEIGHTS[extraction.category]
      ? extraction.category
      : inferThreatCategory(`${extraction.headline ?? fallback.headline} ${candidate.query}`);

  const eventDate = safeIsoDate(extraction.event_date ?? fallback.event_date);
  const confidence = clamp01(typeof extraction.confidence === "number" ? extraction.confidence : fallback.confidence);
  const relevance = clamp01(typeof extraction.relevance === "number" ? extraction.relevance : fallback.relevance);

  return {
    ...fallback,
    event_id_candidate: normalizeSpace(extraction.event_id_candidate ?? fallback.event_id_candidate),
    headline: normalizeSpace(extraction.headline ?? fallback.headline),
    event_date: eventDate,
    state: canonicalStateName(state),
    lga_or_city: extraction.lga_or_city ?? fallback.lga_or_city,
    category,
    killed_count: parsePositiveInt(extraction.killed_count) ?? fallback.killed_count,
    kidnapped_count: parsePositiveInt(extraction.kidnapped_count) ?? fallback.kidnapped_count,
    injured_count: parsePositiveInt(extraction.injured_count) ?? fallback.injured_count,
    source_name: normalizeSpace(extraction.source_name ?? candidate.source_name),
    source_url: normalizeSpace(extraction.source_url ?? candidate.link),
    source_type: extraction.source_type ?? candidate.source_type,
    confidence,
    relevance,
    is_duplicate_of: extraction.is_duplicate_of ?? null,
    published_at: safeIsoDate(candidate.published_at),
    source_query: candidate.query,
    ingestion_stamp: ingestionStamp,
  };
}

function dedupeKey(event: SecurityEvent): string {
  return `${normalizeStateLookup(event.state)}|${event.category}|${event.event_date.slice(0, 10)}|${headlineSignature(
    event.headline
  )}`;
}

export function dedupeSecurityEvents(events: SecurityEvent[]): SecurityEvent[] {
  const byKey = new globalThis.Map<string, SecurityEvent>();

  for (const event of events) {
    const key = dedupeKey(event);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, event);
      continue;
    }

    const currentScore = current.relevance * current.confidence;
    const nextScore = event.relevance * event.confidence;
    if (nextScore > currentScore) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()];
}

function daysSince(dateIso: string, now: Date): number {
  const diffMs = now.getTime() - new Date(dateIso).getTime();
  return diffMs / 86_400_000;
}

function impactWeight(event: SecurityEvent): number {
  const killed = event.killed_count ?? 0;
  const kidnapped = event.kidnapped_count ?? 0;
  const injured = event.injured_count ?? 0;
  return Math.min(55, killed * 1.4 + kidnapped * 1.1 + injured * 0.8);
}

export function computeEventContribution(event: SecurityEvent, now: Date): number {
  const base = TYPE_BASE_WEIGHTS[event.category];
  const reliability = inferSourceReliability(event.source_type, event.source_url);
  const recency = Math.exp(-Math.max(0, daysSince(event.event_date, now)) / 45);
  const confidence = Math.max(0.4, clamp01(event.confidence));
  const relevance = Math.max(0.35, clamp01(event.relevance));
  return (base + impactWeight(event)) * reliability * recency * confidence * relevance;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) {
    return sorted[base];
  }
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function robustNormalize(value: number, p10: number, p90: number): number {
  if (p90 <= p10) {
    return 0;
  }
  return clampScore(((value - p10) / (p90 - p10)) * 100);
}

function scoreTopThreat(threat: SecurityThreatCategory | null): number {
  if (threat === "terror_attack") {
    return 6;
  }
  if (threat === "bandit_attack") {
    return 5;
  }
  if (threat === "kidnapping") {
    return 4;
  }
  if (threat === "communal_clash") {
    return 3;
  }
  if (threat === "armed_robbery" || threat === "cult_violence") {
    return 2;
  }
  if (threat === "violent_land_dispute") {
    return 1;
  }
  return 0;
}

function computeConfidenceScore(
  events: SecurityEvent[],
  sourceMix: Record<SecuritySourceType, number>,
  averageConfidence: number
): number {
  const sourceDiversity = Object.values(sourceMix).filter((count) => count > 0).length;
  return clampScore(35 + Math.min(18, events.length) * 1.9 + averageConfidence * 30 + sourceDiversity * 8);
}

export function aggregateSecurityByState(
  events: SecurityEvent[],
  states: string[],
  now: Date,
  ingestStamp: string,
  publishStamp: string,
  lastIngestRefresh: string
): SecurityStateAggregate[] {
  const windowStart = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const byState = new globalThis.Map<string, SecurityEvent[]>();

  for (const state of states) {
    byState.set(canonicalStateName(state), []);
  }

  for (const event of events) {
    const canonicalState = canonicalStateName(event.state);
    if (!byState.has(canonicalState)) {
      continue;
    }
    if (new Date(event.event_date).getTime() < new Date(windowStart).getTime()) {
      continue;
    }
    byState.get(canonicalState)?.push(event);
  }

  const preliminary = [...byState.entries()].map(([state, stateEvents]) => {
    const topThreatMap = new globalThis.Map<SecurityThreatCategory, number>();
    const sourceMix: Record<SecuritySourceType, number> = {
      acled: 0,
      news: 0,
      social: 0,
    };

    let contributionSum = 0;
    let confidenceSum = 0;
    let relevanceSum = 0;

    for (const event of stateEvents) {
      contributionSum += event.contribution;
      confidenceSum += clamp01(event.confidence);
      relevanceSum += clamp01(event.relevance);
      sourceMix[event.source_type] += 1;
      topThreatMap.set(event.category, (topThreatMap.get(event.category) ?? 0) + 1);
    }

    const topThreats: SecurityThreatCount[] = [...topThreatMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count);

    const averageConfidence = stateEvents.length > 0 ? confidenceSum / stateEvents.length : 0;
    const averageRelevance = stateEvents.length > 0 ? relevanceSum / stateEvents.length : 0;
    const confidenceScore = computeConfidenceScore(stateEvents, sourceMix, averageConfidence);
    const topThreat = topThreats[0]?.category ?? null;

    return {
      state,
      window_start: windowStart,
      window_end: now.toISOString(),
      raw_security_pressure: Number(contributionSum.toFixed(3)),
      security_incident_index: 0,
      security_score: 0,
      security_confidence_score: confidenceScore,
      security_event_count_90d: stateEvents.length,
      security_top_threat: topThreat,
      top_threats: topThreats.slice(0, 3),
      source_mix: sourceMix,
      average_event_confidence: Number(averageConfidence.toFixed(3)),
      average_relevance: Number(averageRelevance.toFixed(3)),
      last_ingest_refresh: lastIngestRefresh,
      ingest_source_stamp: ingestStamp,
      publish_source_stamp: publishStamp,
    } satisfies SecurityStateAggregate;
  });

  const rawValues = preliminary.map((entry) => entry.raw_security_pressure);
  const p10 = quantile(rawValues, 0.1);
  const p90 = quantile(rawValues, 0.9);

  return preliminary.map((entry) => {
    const incidentIndex = robustNormalize(entry.raw_security_pressure, p10, p90);
    const topThreatBoost = scoreTopThreat(entry.security_top_threat);
    const confidencePenalty = entry.security_confidence_score < 55 ? 5 : entry.security_confidence_score < 65 ? 2 : 0;

    return {
      ...entry,
      security_incident_index: incidentIndex,
      security_score: clampScore(incidentIndex + topThreatBoost - confidencePenalty),
    };
  });
}
