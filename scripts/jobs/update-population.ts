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

  if (sameSource(context.versions.population.source_stamp, sourceStamp)) {
    console.log(`[population] Source unchanged (${sourceStamp}). Skipping recompute.`);
    return;
  }

  context.cells = context.cells.map((cell) => {
    const densityIndex = deterministicValue(cell.id, sourceStamp, "population-density", 18, 98);
    const growthPressure = deterministicValue(cell.id, sourceStamp, "population-growth", 12, 95);
    const populationScore = clampScore(0.6 * densityIndex + 0.4 * growthPressure);

    const nextCell = {
      ...cell,
      population_density_index: densityIndex,
      population_score: populationScore,
      last_updated_population: refreshedAt,
      updated_at: refreshedAt,
    };

    return recomputeComposite(nextCell);
  });

  context.metadata = refreshLayerMetadata(context.metadata, "population", refreshedAt);
  context.versions = updateVersionStamp(context.versions, "population", sourceStamp, refreshedAt);

  await saveContext(context);
  console.log(`[population] Updated ${context.cells.length} cells for source ${sourceStamp}.`);
}

main().catch((error) => {
  console.error("[population] Job failed", error);
  process.exit(1);
});
