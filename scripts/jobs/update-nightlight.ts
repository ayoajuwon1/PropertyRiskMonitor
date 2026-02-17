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

function monthStamp(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const now = new Date();
  const refreshedAt = now.toISOString();
  const sourceStamp = monthStamp(now);
  const context = await loadContext();

  if (sameSource(context.versions.nightlight.source_stamp, sourceStamp)) {
    console.log(`[nightlight] Source unchanged (${sourceStamp}). Skipping recompute.`);
    return;
  }

  context.cells = context.cells.map((cell) => {
    const meanRadiance = deterministicValue(cell.id, sourceStamp, "nightlight-radiance", 1.5, 16, 2);
    const trendDelta = deterministicValue(cell.id, sourceStamp, "nightlight-trend", -8, 12, 2);
    const nextNightlightScore = clampScore(meanRadiance * 4 + Math.max(0, trendDelta) * 3);

    const nextCell = {
      ...cell,
      mean_radiance: meanRadiance,
      nightlight_trend_delta: trendDelta,
      nightlight_score: nextNightlightScore,
      last_updated_nightlight: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(nextCell);
  });

  context.metadata = refreshLayerMetadata(context.metadata, "nightlight", refreshedAt);
  context.versions = updateVersionStamp(context.versions, "nightlight", sourceStamp, refreshedAt);

  await saveContext(context);
  console.log(`[nightlight] Updated ${context.cells.length} cells for source ${sourceStamp}.`);
}

main().catch((error) => {
  console.error("[nightlight] Job failed", error);
  process.exit(1);
});
