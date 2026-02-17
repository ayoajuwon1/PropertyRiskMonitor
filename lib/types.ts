export type LayerName =
  | "flood"
  | "infrastructure"
  | "nightlight"
  | "rainfall"
  | "population"
  | "security"
  | "news";

export interface LocationCell {
  id: string;
  state: string;
  lga: string | null;
  lat: number;
  lng: number;
  flood_score: number;
  infra_score: number;
  nightlight_score: number;
  rainfall_score: number;
  population_score: number;
  security_score: number;
  composite_risk_score: number;
  distance_to_major_roads_km: number;
  nightlight_trend_delta: number;
  water_index: number;
  elevation_inverse_index: number;
  mean_radiance: number;
  rainfall_anomaly_index: number;
  population_density_index: number;
  security_incident_index: number;
  last_updated_flood: string;
  last_updated_infra: string;
  last_updated_nightlight: string;
  last_updated_rainfall: string;
  last_updated_population: string;
  last_updated_security: string;
  created_at: string;
  updated_at: string;
}

export interface LayerMetadata {
  layer_name: LayerName;
  display_name: string;
  customer_use_case: string;
  source_name: string;
  source_url: string;
  update_frequency: "weekly" | "monthly" | "quarterly";
  last_refresh: string;
  coverage_notes: string;
  source_stamp?: string;
  source_checked_at?: string;
}

export interface SourceVersion {
  source_stamp: string;
  checked_at: string;
}

export interface SourceVersionStore {
  flood: SourceVersion;
  infrastructure: SourceVersion;
  nightlight: SourceVersion;
  rainfall: SourceVersion;
  population: SourceVersion;
  security: SourceVersion;
  news?: SourceVersion;
}

export interface MapDataResponse {
  id: string;
  state: string;
  lga: string | null;
  lat: number;
  lng: number;
  flood_score: number;
  infra_score: number;
  nightlight_score: number;
  rainfall_score: number;
  population_score: number;
  security_score: number;
  composite_risk_score: number;
}

export interface InventoryListing {
  id: string;
  name: string;
  slug: string;
  state: string;
  city: string;
  property_type: "Land Estate" | "Residential" | "Commercial" | "Mixed Use";
  status: "Active" | "Available" | "Prelaunch";
  lat: number;
  lng: number;
  map_url: string;
  tags: string[];
}

export interface StateNewsItem {
  title: string;
  link: string;
  published_at: string;
  source: string;
}

export interface StateContext {
  state: string;
  image_url: string | null;
  summary: string | null;
  highlights: string[];
  positive_news: StateNewsItem[];
  news: StateNewsItem[];
  dispute_news: StateNewsItem[];
  news_metrics?: {
    positive_count: number;
    local_count: number;
    dispute_count: number;
    positive_delta: number;
    local_delta: number;
    dispute_delta: number;
    last_refresh: string | null;
    source_stamp: string | null;
  };
}

export interface StateNewsSnapshot extends StateContext {
  last_refresh: string;
  source_stamp: string;
}

export interface NewsMetadata {
  source_name: string;
  source_url: string;
  update_frequency: "weekly";
  last_refresh: string;
  source_stamp: string;
  coverage_notes: string;
  states_processed: number;
}

export const REQUIRED_DISCLAIMER =
  "This platform provides model-based estimates using publicly available geospatial datasets. It is not an official hazard authority and should not replace professional due diligence.";
