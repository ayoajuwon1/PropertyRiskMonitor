export type LayerName =
  | "flood"
  | "infrastructure"
  | "nightlight"
  | "rainfall"
  | "population"
  | "security"
  | "news";

export type SecurityThreatCategory =
  | "kidnapping"
  | "bandit_attack"
  | "terror_attack"
  | "communal_clash"
  | "armed_robbery"
  | "cult_violence"
  | "violent_land_dispute"
  | "other_security_event";

export type SecuritySourceType = "acled" | "news" | "social";

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
  security_confidence_score: number;
  security_event_count_90d: number;
  security_top_threat: SecurityThreatCategory | null;
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
  source_mix?: string[];
  layer_confidence_score?: number;
  coverage_quality?: "high" | "medium" | "low";
  ingest_last_refresh?: string;
  publish_last_refresh?: string;
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

export interface SecurityThreatCount {
  category: SecurityThreatCategory;
  count: number;
}

export interface SecurityEvent {
  id: string;
  event_id_candidate: string;
  headline: string;
  event_date: string;
  state: string;
  lga_or_city: string | null;
  category: SecurityThreatCategory;
  killed_count: number | null;
  kidnapped_count: number | null;
  injured_count: number | null;
  source_name: string;
  source_url: string;
  source_type: SecuritySourceType;
  confidence: number;
  relevance: number;
  is_duplicate_of: string | null;
  source_query: string;
  published_at: string;
  ingestion_stamp: string;
  contribution: number;
}

export interface SecurityStateAggregate {
  state: string;
  window_start: string;
  window_end: string;
  raw_security_pressure: number;
  security_incident_index: number;
  security_score: number;
  security_confidence_score: number;
  security_event_count_90d: number;
  security_top_threat: SecurityThreatCategory | null;
  top_threats: SecurityThreatCount[];
  source_mix: Record<SecuritySourceType, number>;
  average_event_confidence: number;
  average_relevance: number;
  last_ingest_refresh: string;
  ingest_source_stamp: string;
  publish_source_stamp: string;
}

export interface SecurityMetadata {
  source_name: string;
  source_url: string;
  ingest_frequency: "weekly";
  publish_frequency: "quarterly";
  last_ingest_refresh: string;
  last_publish_refresh: string;
  ingest_source_stamp: string;
  publish_source_stamp: string;
  coverage_notes: string;
  source_mix: string[];
  states_processed: number;
  events_processed_90d: number;
  national_confidence_score: number;
}

export interface SecurityLocationDetails {
  event_count_90d: number;
  top_threat: SecurityThreatCategory | null;
  top_threats: SecurityThreatCount[];
  confidence_score: number;
  last_ingest_refresh: string | null;
  last_publish_refresh: string | null;
  ingest_source_stamp: string | null;
  publish_source_stamp: string | null;
  source_mix: string[];
}

export const REQUIRED_DISCLAIMER =
  "This platform provides model-based estimates using publicly available geospatial datasets. It is not an official hazard authority and should not replace professional due diligence.";
