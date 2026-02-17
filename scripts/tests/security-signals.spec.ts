import assert from "node:assert/strict";
import {
  aggregateSecurityByState,
  buildStateBooleanQueries,
  computeEventContribution,
  dedupeSecurityEvents,
  heuristicExtractSecurityEvent,
  sanitizeGeminiEvent,
  weekStamp,
  type SecurityCandidateItem,
} from "../../lib/security-signals";

function run() {
  const queries = buildStateBooleanQueries("Kaduna");
  assert.equal(queries.length, 2);
  assert.ok(queries[0].includes("kidnap*"));
  assert.ok(queries[0].includes("Boko Haram"));

  const candidate: SecurityCandidateItem = {
    headline: "Gunmen kidnapped 18 residents in Kaduna community",
    link: "https://example.com/story-1",
    source_name: "Example News",
    published_at: "2026-02-10T10:00:00.000Z",
    source_type: "news",
    query: "Kaduna insecurity query",
    query_state: "Kaduna",
  };

  const heuristic = heuristicExtractSecurityEvent(candidate, ["Kaduna", "Kano"], weekStamp(new Date("2026-02-17T00:00:00.000Z")));
  assert.ok(heuristic);
  assert.equal(heuristic?.state, "Kaduna");
  assert.equal(heuristic?.category, "kidnapping");
  assert.equal(heuristic?.kidnapped_count, 18);

  const sanitized = sanitizeGeminiEvent(
    {
      headline: "Bandits abduct 20 in Kaduna",
      source_url: "https://example.com/story-1",
      category: "bandit_attack",
      confidence: 0.84,
      relevance: 0.9,
      kidnapped_count: 20,
      state: "Kaduna",
    },
    candidate,
    ["Kaduna", "Kano"],
    weekStamp(new Date("2026-02-17T00:00:00.000Z"))
  );
  assert.ok(sanitized);
  assert.equal(sanitized?.category, "bandit_attack");
  assert.equal(sanitized?.kidnapped_count, 20);

  const duplicate = sanitized ? { ...sanitized, headline: "Bandits abduct 20 in Kaduna", confidence: 0.5 } : null;
  const deduped = dedupeSecurityEvents([sanitized, duplicate].filter((item): item is NonNullable<typeof sanitized> => Boolean(item)));
  assert.equal(deduped.length, 1);

  const now = new Date("2026-02-17T00:00:00.000Z");
  const contribution = computeEventContribution(deduped[0], now);
  assert.ok(contribution > 0);

  const aggregates = aggregateSecurityByState(
    deduped.map((event) => ({ ...event, id: "event-1", contribution })),
    ["Kaduna", "Kano"],
    now,
    "2026-W08",
    "2026-Q1",
    now.toISOString()
  );
  assert.equal(aggregates.length, 2);
  const kaduna = aggregates.find((entry) => entry.state === "Kaduna");
  const kano = aggregates.find((entry) => entry.state === "Kano");
  assert.ok(kaduna);
  assert.ok(kano);
  assert.ok((kaduna?.security_score ?? 0) >= (kano?.security_score ?? 0));

  console.log("security-signals.spec.ts passed");
}

run();
