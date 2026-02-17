import path from "node:path";
import { promises as fs } from "node:fs";
import type { LayerMetadata, LocationCell, LayerName, SourceVersionStore } from "../../lib/types";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const LOCATION_CELLS_PATH = path.join(DATA_DIR, "location-cells.json");
const LAYER_METADATA_PATH = path.join(DATA_DIR, "layer-metadata.json");
const SOURCE_VERSIONS_PATH = path.join(DATA_DIR, "source-versions.json");

export interface LayerUpdateContext {
  cells: LocationCell[];
  metadata: LayerMetadata[];
  versions: SourceVersionStore;
}

function parseNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function ensureCellDefaults(cell: Partial<LocationCell>): LocationCell {
  const fallbackTime = new Date().toISOString();
  const createdAt = parseString(cell.created_at, fallbackTime);
  const updatedAt = parseString(cell.updated_at, createdAt);

  return {
    id: parseString(cell.id, "unknown-cell"),
    state: parseString(cell.state, "Unknown"),
    lga: cell.lga ?? null,
    lat: parseNumber(cell.lat),
    lng: parseNumber(cell.lng),
    flood_score: parseNumber(cell.flood_score),
    infra_score: parseNumber(cell.infra_score),
    nightlight_score: parseNumber(cell.nightlight_score),
    rainfall_score: parseNumber(cell.rainfall_score),
    population_score: parseNumber(cell.population_score),
    security_score: parseNumber(cell.security_score),
    composite_risk_score: parseNumber(cell.composite_risk_score),
    distance_to_major_roads_km: parseNumber(cell.distance_to_major_roads_km),
    nightlight_trend_delta: parseNumber(cell.nightlight_trend_delta),
    water_index: parseNumber(cell.water_index),
    elevation_inverse_index: parseNumber(cell.elevation_inverse_index),
    mean_radiance: parseNumber(cell.mean_radiance),
    rainfall_anomaly_index: parseNumber(cell.rainfall_anomaly_index),
    population_density_index: parseNumber(cell.population_density_index),
    security_incident_index: parseNumber(cell.security_incident_index),
    security_confidence_score: parseNumber(cell.security_confidence_score, 0),
    security_event_count_90d: parseNumber(cell.security_event_count_90d, 0),
    security_top_threat:
      typeof cell.security_top_threat === "string" && cell.security_top_threat.length > 0
        ? (cell.security_top_threat as LocationCell["security_top_threat"])
        : null,
    last_updated_flood: parseString(cell.last_updated_flood, updatedAt),
    last_updated_infra: parseString(cell.last_updated_infra, updatedAt),
    last_updated_nightlight: parseString(cell.last_updated_nightlight, updatedAt),
    last_updated_rainfall: parseString(cell.last_updated_rainfall, updatedAt),
    last_updated_population: parseString(cell.last_updated_population, updatedAt),
    last_updated_security: parseString(cell.last_updated_security, updatedAt),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function ensureVersionStore(versions: Partial<SourceVersionStore>): SourceVersionStore {
  const fallback = {
    source_stamp: "bootstrap",
    checked_at: "1970-01-01T00:00:00.000Z",
  };

  return {
    flood: versions.flood ?? fallback,
    infrastructure: versions.infrastructure ?? fallback,
    nightlight: versions.nightlight ?? fallback,
    rainfall: versions.rainfall ?? fallback,
    population: versions.population ?? fallback,
    security: versions.security ?? fallback,
    news: versions.news,
  };
}

export async function loadContext(): Promise<LayerUpdateContext> {
  const [cellsRaw, metadataRaw, versionsRaw] = await Promise.all([
    fs.readFile(LOCATION_CELLS_PATH, "utf8"),
    fs.readFile(LAYER_METADATA_PATH, "utf8"),
    fs.readFile(SOURCE_VERSIONS_PATH, "utf8"),
  ]);

  return {
    cells: (JSON.parse(cellsRaw) as Partial<LocationCell>[]).map(ensureCellDefaults),
    metadata: JSON.parse(metadataRaw) as LayerMetadata[],
    versions: ensureVersionStore(JSON.parse(versionsRaw) as Partial<SourceVersionStore>),
  };
}

export async function saveContext(context: LayerUpdateContext): Promise<void> {
  await Promise.all([
    fs.writeFile(LOCATION_CELLS_PATH, `${JSON.stringify(context.cells, null, 2)}\n`, "utf8"),
    fs.writeFile(LAYER_METADATA_PATH, `${JSON.stringify(context.metadata, null, 2)}\n`, "utf8"),
    fs.writeFile(SOURCE_VERSIONS_PATH, `${JSON.stringify(context.versions, null, 2)}\n`, "utf8"),
  ]);
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function hashSignal(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function deterministicValue(
  cellId: string,
  sourceStamp: string,
  channel: string,
  min: number,
  max: number,
  decimals = 0
): number {
  const signal = hashSignal(`${cellId}:${sourceStamp}:${channel}`);
  const normalized = signal / 2_147_483_647;
  const value = min + (max - min) * normalized;
  if (decimals <= 0) {
    return Math.round(value);
  }
  return Number(value.toFixed(decimals));
}

export function recomputeComposite(cell: LocationCell): LocationCell {
  const floodWeight = Number(process.env.FLOOD_WEIGHT ?? 0.25);
  const infraWeight = Number(process.env.INFRA_WEIGHT ?? 0.1);
  const nightlightWeight = Number(process.env.NIGHTLIGHT_WEIGHT ?? 0.07);
  const rainfallWeight = Number(process.env.RAINFALL_WEIGHT ?? 0.15);
  const populationWeight = Number(process.env.POPULATION_WEIGHT ?? 0.08);
  const securityWeight = Number(process.env.SECURITY_WEIGHT ?? 0.35);

  const totalWeight =
    floodWeight + infraWeight + nightlightWeight + rainfallWeight + populationWeight + securityWeight;
  const safeTotal = totalWeight > 0 ? totalWeight : 1;
  // Better road access reduces risk, so convert access score into a risk-oriented value.
  const infraRiskScore = 100 - cell.infra_score;

  const composite =
    (floodWeight * cell.flood_score +
      infraWeight * infraRiskScore +
      nightlightWeight * cell.nightlight_score +
      rainfallWeight * cell.rainfall_score +
      populationWeight * cell.population_score +
      securityWeight * cell.security_score) /
    safeTotal;

  return {
    ...cell,
    composite_risk_score: clampScore(composite),
  };
}

export function refreshLayerMetadata(metadata: LayerMetadata[], layer: LayerName, refreshedAt: string): LayerMetadata[] {
  return metadata.map((entry) =>
    entry.layer_name === layer
      ? {
          ...entry,
          last_refresh: refreshedAt,
        }
      : entry
  );
}

export function updateVersionStamp(
  versions: SourceVersionStore,
  layer: LayerName,
  sourceStamp: string,
  checkedAt: string
): SourceVersionStore {
  if (layer === "flood") {
    return { ...versions, flood: { source_stamp: sourceStamp, checked_at: checkedAt } };
  }

  if (layer === "infrastructure") {
    return { ...versions, infrastructure: { source_stamp: sourceStamp, checked_at: checkedAt } };
  }

  if (layer === "nightlight") {
    return { ...versions, nightlight: { source_stamp: sourceStamp, checked_at: checkedAt } };
  }

  if (layer === "rainfall") {
    return { ...versions, rainfall: { source_stamp: sourceStamp, checked_at: checkedAt } };
  }

  if (layer === "population") {
    return { ...versions, population: { source_stamp: sourceStamp, checked_at: checkedAt } };
  }

  if (layer === "news") {
    return { ...versions, news: { source_stamp: sourceStamp, checked_at: checkedAt } };
  }

  return { ...versions, security: { source_stamp: sourceStamp, checked_at: checkedAt } };
}

export function sameSource(current: string, incoming: string): boolean {
  return current === incoming;
}
