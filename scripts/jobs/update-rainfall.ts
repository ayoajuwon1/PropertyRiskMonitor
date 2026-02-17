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

  if (sameSource(context.versions.rainfall.source_stamp, sourceStamp)) {
    console.log(`[rainfall] Source unchanged (${sourceStamp}). Skipping recompute.`);
    return;
  }

  context.cells = context.cells.map((cell) => {
    const rainfallAnomaly = deterministicValue(cell.id, sourceStamp, "rainfall-anomaly", 12, 92);
    const seasonalVolatility = deterministicValue(cell.id, sourceStamp, "rainfall-volatility", 10, 90);
    const rainfallScore = clampScore(0.65 * rainfallAnomaly + 0.35 * seasonalVolatility);

    const nextCell = {
      ...cell,
      rainfall_anomaly_index: rainfallAnomaly,
      rainfall_score: rainfallScore,
      last_updated_rainfall: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(nextCell);
  });

  context.metadata = refreshLayerMetadata(context.metadata, "rainfall", refreshedAt);
  context.versions = updateVersionStamp(context.versions, "rainfall", sourceStamp, refreshedAt);

  await saveContext(context);
  console.log(`[rainfall] Updated ${context.cells.length} cells for source ${sourceStamp}.`);
}

main().catch((error) => {
  console.error("[rainfall] Job failed", error);
  process.exit(1);
});
