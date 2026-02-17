import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  LayerMetadata,
  LocationCell,
  NewsMetadata,
  SecurityEvent,
  SecurityMetadata,
  SecurityStateAggregate,
  SourceVersionStore,
  StateNewsSnapshot,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const LOCATION_CELLS_PATH = path.join(DATA_DIR, "location-cells.json");
const LAYER_METADATA_PATH = path.join(DATA_DIR, "layer-metadata.json");
const SOURCE_VERSION_PATH = path.join(DATA_DIR, "source-versions.json");
const STATE_NEWS_SNAPSHOTS_PATH = path.join(DATA_DIR, "state-news-snapshots.json");
const NEWS_METADATA_PATH = path.join(DATA_DIR, "news-metadata.json");
const SECURITY_EVENTS_SNAPSHOTS_PATH = path.join(DATA_DIR, "security-events-snapshots.json");
const SECURITY_STATE_AGGREGATES_PATH = path.join(DATA_DIR, "security-state-aggregates.json");
const SECURITY_METADATA_PATH = path.join(DATA_DIR, "security-metadata.json");

let locationCache: LocationCell[] | null = null;
let layerMetadataCache: LayerMetadata[] | null = null;
let sourceVersionCache: SourceVersionStore | null = null;
let stateNewsSnapshotCache: StateNewsSnapshot[] | null = null;
let newsMetadataCache: NewsMetadata | null = null;
let securityEventsCache: SecurityEvent[] | null = null;
let securityStateAggregateCache: SecurityStateAggregate[] | null = null;
let securityMetadataCache: SecurityMetadata | null = null;

function parseNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeLocationCell(cell: Partial<LocationCell>): LocationCell {
  const fallbackTime = new Date().toISOString();
  const createdAt = parseString(cell.created_at, fallbackTime);
  const updatedAt = parseString(cell.updated_at, createdAt);

  return {
    id: parseString(cell.id, "unknown-cell"),
    state: parseString(cell.state, "Unknown"),
    lga: cell.lga ?? null,
    lat: parseNumber(cell.lat, 0),
    lng: parseNumber(cell.lng, 0),
    flood_score: parseNumber(cell.flood_score, 0),
    infra_score: parseNumber(cell.infra_score, 0),
    nightlight_score: parseNumber(cell.nightlight_score, 0),
    rainfall_score: parseNumber(cell.rainfall_score, 0),
    population_score: parseNumber(cell.population_score, 0),
    security_score: parseNumber(cell.security_score, 0),
    composite_risk_score: parseNumber(cell.composite_risk_score, 0),
    distance_to_major_roads_km: parseNumber(cell.distance_to_major_roads_km, 0),
    nightlight_trend_delta: parseNumber(cell.nightlight_trend_delta, 0),
    water_index: parseNumber(cell.water_index, 0),
    elevation_inverse_index: parseNumber(cell.elevation_inverse_index, 0),
    mean_radiance: parseNumber(cell.mean_radiance, 0),
    rainfall_anomaly_index: parseNumber(cell.rainfall_anomaly_index, 0),
    population_density_index: parseNumber(cell.population_density_index, 0),
    security_incident_index: parseNumber(cell.security_incident_index, 0),
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

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

export async function getLocationCells(): Promise<LocationCell[]> {
  if (!locationCache) {
    const raw = await readJson<Array<Partial<LocationCell>>>(LOCATION_CELLS_PATH, []);
    locationCache = raw.map((cell) => normalizeLocationCell(cell));
  }
  return locationCache;
}

export async function getLocationCellById(id: string): Promise<LocationCell | undefined> {
  const cells = await getLocationCells();
  return cells.find((cell) => cell.id === id);
}

export async function getLayerMetadata(): Promise<LayerMetadata[]> {
  if (!layerMetadataCache) {
    layerMetadataCache = await readJson<LayerMetadata[]>(LAYER_METADATA_PATH, []);
  }
  return layerMetadataCache;
}

export async function getSourceVersions(): Promise<SourceVersionStore> {
  if (!sourceVersionCache) {
    sourceVersionCache = await readJson<SourceVersionStore>(SOURCE_VERSION_PATH, {
      flood: { source_stamp: "bootstrap", checked_at: new Date(0).toISOString() },
      infrastructure: { source_stamp: "bootstrap", checked_at: new Date(0).toISOString() },
      nightlight: { source_stamp: "bootstrap", checked_at: new Date(0).toISOString() },
      rainfall: { source_stamp: "bootstrap", checked_at: new Date(0).toISOString() },
      population: { source_stamp: "bootstrap", checked_at: new Date(0).toISOString() },
      security: { source_stamp: "bootstrap", checked_at: new Date(0).toISOString() },
      news: { source_stamp: "bootstrap", checked_at: new Date(0).toISOString() },
    });
  }
  return sourceVersionCache;
}

export async function getStateNewsSnapshots(): Promise<StateNewsSnapshot[]> {
  if (!stateNewsSnapshotCache) {
    stateNewsSnapshotCache = await readJson<StateNewsSnapshot[]>(STATE_NEWS_SNAPSHOTS_PATH, []);
  }
  return stateNewsSnapshotCache;
}

export async function getStateNewsSnapshotByState(state: string): Promise<StateNewsSnapshot | undefined> {
  const snapshots = await getStateNewsSnapshots();
  return snapshots.find((snapshot) => snapshot.state.toLowerCase() === state.toLowerCase());
}

export async function getNewsMetadata(): Promise<NewsMetadata> {
  if (!newsMetadataCache) {
    newsMetadataCache = await readJson<NewsMetadata>(NEWS_METADATA_PATH, {
      source_name: "Google News RSS + Wikipedia",
      source_url: "https://news.google.com/rss",
      update_frequency: "weekly",
      last_refresh: new Date(0).toISOString(),
      source_stamp: "bootstrap",
      coverage_notes: "No news metadata has been generated yet.",
      states_processed: 0,
    });
  }
  return newsMetadataCache;
}

export async function getSecurityEventsSnapshots(): Promise<SecurityEvent[]> {
  if (!securityEventsCache) {
    securityEventsCache = await readJson<SecurityEvent[]>(SECURITY_EVENTS_SNAPSHOTS_PATH, []);
  }
  return securityEventsCache;
}

export async function getSecurityStateAggregates(): Promise<SecurityStateAggregate[]> {
  if (!securityStateAggregateCache) {
    securityStateAggregateCache = await readJson<SecurityStateAggregate[]>(SECURITY_STATE_AGGREGATES_PATH, []);
  }
  return securityStateAggregateCache;
}

export async function getSecurityStateAggregateByState(state: string): Promise<SecurityStateAggregate | undefined> {
  const aggregates = await getSecurityStateAggregates();
  return aggregates.find((entry) => entry.state.toLowerCase() === state.toLowerCase());
}

export async function getSecurityMetadata(): Promise<SecurityMetadata> {
  if (!securityMetadataCache) {
    securityMetadataCache = await readJson<SecurityMetadata>(SECURITY_METADATA_PATH, {
      source_name: "ACLED + Google News + Gemini/Heuristic Extraction",
      source_url: "https://acleddata.com/, https://news.google.com/rss",
      ingest_frequency: "weekly",
      publish_frequency: "quarterly",
      last_ingest_refresh: new Date(0).toISOString(),
      last_publish_refresh: new Date(0).toISOString(),
      ingest_source_stamp: "bootstrap",
      publish_source_stamp: "bootstrap",
      coverage_notes: "No security metadata has been generated yet.",
      source_mix: [],
      states_processed: 0,
      events_processed_90d: 0,
      national_confidence_score: 0,
    });
  }
  return securityMetadataCache;
}

export async function persistLocationCells(cells: LocationCell[]): Promise<void> {
  locationCache = cells;
  await fs.writeFile(LOCATION_CELLS_PATH, `${JSON.stringify(cells, null, 2)}\n`, "utf8");
}

export async function persistLayerMetadata(metadata: LayerMetadata[]): Promise<void> {
  layerMetadataCache = metadata;
  await fs.writeFile(LAYER_METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export async function persistSourceVersions(versions: SourceVersionStore): Promise<void> {
  sourceVersionCache = versions;
  await fs.writeFile(SOURCE_VERSION_PATH, `${JSON.stringify(versions, null, 2)}\n`, "utf8");
}

export async function persistStateNewsSnapshots(snapshots: StateNewsSnapshot[]): Promise<void> {
  stateNewsSnapshotCache = snapshots;
  await fs.writeFile(STATE_NEWS_SNAPSHOTS_PATH, `${JSON.stringify(snapshots, null, 2)}\n`, "utf8");
}

export async function persistNewsMetadata(metadata: NewsMetadata): Promise<void> {
  newsMetadataCache = metadata;
  await fs.writeFile(NEWS_METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export async function persistSecurityEventsSnapshots(events: SecurityEvent[]): Promise<void> {
  securityEventsCache = events;
  await fs.writeFile(SECURITY_EVENTS_SNAPSHOTS_PATH, `${JSON.stringify(events, null, 2)}\n`, "utf8");
}

export async function persistSecurityStateAggregates(aggregates: SecurityStateAggregate[]): Promise<void> {
  securityStateAggregateCache = aggregates;
  await fs.writeFile(SECURITY_STATE_AGGREGATES_PATH, `${JSON.stringify(aggregates, null, 2)}\n`, "utf8");
}

export async function persistSecurityMetadata(metadata: SecurityMetadata): Promise<void> {
  securityMetadataCache = metadata;
  await fs.writeFile(SECURITY_METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function clearInMemoryCache(): void {
  locationCache = null;
  layerMetadataCache = null;
  sourceVersionCache = null;
  stateNewsSnapshotCache = null;
  newsMetadataCache = null;
  securityEventsCache = null;
  securityStateAggregateCache = null;
  securityMetadataCache = null;
}
