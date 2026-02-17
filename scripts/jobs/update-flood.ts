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

function quarterStamp(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

async function main() {
  const now = new Date();
  const refreshedAt = now.toISOString();
  const sourceStamp = quarterStamp(now);
  const context = await loadContext();

  if (sameSource(context.versions.flood.source_stamp, sourceStamp)) {
    console.log(`[flood] Source unchanged (${sourceStamp}). Skipping recompute.`);
    return;
  }

  context.cells = context.cells.map((cell) => {
    const waterIndex = deterministicValue(cell.id, sourceStamp, "flood-water", 20, 92);
    const elevationInverse = deterministicValue(cell.id, sourceStamp, "flood-elevation", 15, 95);
    const floodScore = clampScore(0.62 * waterIndex + 0.38 * elevationInverse);

    const nextCell = {
      ...cell,
      water_index: waterIndex,
      elevation_inverse_index: elevationInverse,
      flood_score: floodScore,
      last_updated_flood: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(nextCell);
  });

  context.metadata = refreshLayerMetadata(context.metadata, "flood", refreshedAt);
  context.versions = updateVersionStamp(context.versions, "flood", sourceStamp, refreshedAt);

  await saveContext(context);
  console.log(`[flood] Updated ${context.cells.length} cells for source ${sourceStamp}.`);
}

main().catch((error) => {
  console.error("[flood] Job failed", error);
  process.exit(1);
});
