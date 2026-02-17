import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  LayerMetadata,
  LocationCell,
  NewsMetadata,
  SourceVersionStore,
  StateNewsSnapshot,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const LOCATION_CELLS_PATH = path.join(DATA_DIR, "location-cells.json");
const LAYER_METADATA_PATH = path.join(DATA_DIR, "layer-metadata.json");
const SOURCE_VERSION_PATH = path.join(DATA_DIR, "source-versions.json");
const STATE_NEWS_SNAPSHOTS_PATH = path.join(DATA_DIR, "state-news-snapshots.json");
const NEWS_METADATA_PATH = path.join(DATA_DIR, "news-metadata.json");

let locationCache: LocationCell[] | null = null;
let layerMetadataCache: LayerMetadata[] | null = null;
let sourceVersionCache: SourceVersionStore | null = null;
let stateNewsSnapshotCache: StateNewsSnapshot[] | null = null;
let newsMetadataCache: NewsMetadata | null = null;

async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

export async function getLocationCells(): Promise<LocationCell[]> {
  if (!locationCache) {
    locationCache = await readJson<LocationCell[]>(LOCATION_CELLS_PATH);
  }
  return locationCache;
}

export async function getLocationCellById(id: string): Promise<LocationCell | undefined> {
  const cells = await getLocationCells();
  return cells.find((cell) => cell.id === id);
}

export async function getLayerMetadata(): Promise<LayerMetadata[]> {
  if (!layerMetadataCache) {
    layerMetadataCache = await readJson<LayerMetadata[]>(LAYER_METADATA_PATH);
  }
  return layerMetadataCache;
}

export async function getSourceVersions(): Promise<SourceVersionStore> {
  if (!sourceVersionCache) {
    sourceVersionCache = await readJson<SourceVersionStore>(SOURCE_VERSION_PATH);
  }
  return sourceVersionCache;
}

export async function getStateNewsSnapshots(): Promise<StateNewsSnapshot[]> {
  if (!stateNewsSnapshotCache) {
    stateNewsSnapshotCache = await readJson<StateNewsSnapshot[]>(STATE_NEWS_SNAPSHOTS_PATH);
  }
  return stateNewsSnapshotCache;
}

export async function getStateNewsSnapshotByState(state: string): Promise<StateNewsSnapshot | undefined> {
  const snapshots = await getStateNewsSnapshots();
  return snapshots.find((snapshot) => snapshot.state.toLowerCase() === state.toLowerCase());
}

export async function getNewsMetadata(): Promise<NewsMetadata> {
  if (!newsMetadataCache) {
    newsMetadataCache = await readJson<NewsMetadata>(NEWS_METADATA_PATH);
  }
  return newsMetadataCache;
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

export function clearInMemoryCache(): void {
  locationCache = null;
  layerMetadataCache = null;
  sourceVersionCache = null;
  stateNewsSnapshotCache = null;
  newsMetadataCache = null;
}
