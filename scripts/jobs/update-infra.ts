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

  if (sameSource(context.versions.infrastructure.source_stamp, sourceStamp)) {
    console.log(`[infra] Source unchanged (${sourceStamp}). Skipping recompute.`);
    return;
  }

  context.cells = context.cells.map((cell) => {
    const distance = deterministicValue(cell.id, sourceStamp, "infra-distance", 0.8, 14.5, 2);
    const roadDensityIndex = deterministicValue(cell.id, sourceStamp, "infra-density", 20, 95);
    const infraScore = clampScore(100 - distance * 4 + roadDensityIndex * 0.45);

    const nextCell = {
      ...cell,
      distance_to_major_roads_km: distance,
      infra_score: infraScore,
      last_updated_infra: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(nextCell);
  });

  context.metadata = refreshLayerMetadata(context.metadata, "infrastructure", refreshedAt);
  context.versions = updateVersionStamp(context.versions, "infrastructure", sourceStamp, refreshedAt);

  await saveContext(context);
  console.log(`[infra] Updated ${context.cells.length} cells for source ${sourceStamp}.`);
}

main().catch((error) => {
  console.error("[infra] Job failed", error);
  process.exit(1);
});
