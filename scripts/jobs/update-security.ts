import {
  clampScore,
  deterministicValue,
  loadContext,
  recomputeComposite,
  refreshLayerMetadata,
  sameSource,
  saveContext,
  updateVersionStamp,
} from "./shared";

function weekStamp(date: Date): string {
  const firstDay = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const daysSince = Math.floor((date.getTime() - firstDay.getTime()) / 86_400_000);
  const week = Math.ceil((daysSince + firstDay.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function main() {
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
      last_updated_security: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(nextCell);
  });

  context.metadata = refreshLayerMetadata(context.metadata, "security", refreshedAt);
  context.versions = updateVersionStamp(context.versions, "security", sourceStamp, refreshedAt);

  await saveContext(context);
  console.log(`[security] Updated ${context.cells.length} cells for source ${sourceStamp}.`);
}

main().catch((error) => {
  console.error("[security] Job failed", error);
  process.exit(1);
});
