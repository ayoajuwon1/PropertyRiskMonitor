"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MapView, {
  Layer,
  NavigationControl,
  Popup,
  ScaleControl,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import {
  Radar,
  Waves,
  Route,
  MoonStar,
  CloudRain,
  Users,
  Shield,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import type { InventoryListing, MapDataResponse } from "@/lib/types";

export type MetricKey =
  | "composite"
  | "flood"
  | "infrastructure"
  | "nightlight"
  | "rainfall"
  | "population"
  | "security";

interface NprmMapProps {
  cells: MapDataResponse[];
  selectedCell: MapDataResponse | null;
  activeMetrics: MetricKey[];
  showHeatmap: boolean;
  inventoryListings: InventoryListing[];
  showInventoryOverlay: boolean;
  onSelectCell: (id: string) => void;
  onActiveMetricsChange: (metrics: MetricKey[]) => void;
  onToggleHeatmap: () => void;
  onToggleInventoryOverlay: () => void;
}

type StateProperties = {
  shapeName: string;
  shapeID: string;
  id?: string;
  state?: string;
  flood_score?: number;
  infra_score?: number;
  nightlight_score?: number;
  rainfall_score?: number;
  population_score?: number;
  security_score?: number;
  composite_risk_score?: number;
  selected_score?: number;
  dominant_metric?: string;
} & Exclude<GeoJsonProperties, null>;

interface MetricMeta {
  key: MetricKey;
  label: string;
  icon: LucideIcon;
}

interface MetricPreset {
  key: "balanced" | "climate" | "growth" | "safety";
  label: string;
  metrics: MetricKey[];
}

const DEFAULT_VIEW = {
  longitude: 8.6753,
  latitude: 9.082,
  zoom: 5.3,
};

const METRICS: MetricMeta[] = [
  { key: "composite", label: "Overall risk", icon: Radar },
  { key: "flood", label: "Flood exposure", icon: Waves },
  { key: "infrastructure", label: "Road access", icon: Route },
  { key: "nightlight", label: "Neighborhood activity", icon: MoonStar },
  { key: "rainfall", label: "Rainfall pressure", icon: CloudRain },
  { key: "population", label: "Population pressure", icon: Users },
  { key: "security", label: "Security pressure", icon: Shield },
];

const METRIC_PRESETS: MetricPreset[] = [
  { key: "balanced", label: "Balanced", metrics: ["composite"] },
  { key: "climate", label: "Climate", metrics: ["flood", "rainfall"] },
  {
    key: "growth",
    label: "Growth",
    metrics: ["infrastructure", "nightlight", "population"],
  },
  { key: "safety", label: "Safety", metrics: ["security", "flood", "infrastructure"] },
];

const METRIC_TO_PROPERTY: Record<MetricKey, keyof MapDataResponse> = {
  composite: "composite_risk_score",
  flood: "flood_score",
  infrastructure: "infra_score",
  nightlight: "nightlight_score",
  rainfall: "rainfall_score",
  population: "population_score",
  security: "security_score",
};

const METRIC_COLOR_STOPS: Record<MetricKey, [number, string][]> = {
  composite: [
    [0, "#0b132b"],
    [20, "#1c2541"],
    [40, "#3a506b"],
    [60, "#5bc0be"],
    [80, "#f59e0b"],
    [100, "#dc2626"],
  ],
  flood: [
    [0, "#0c4a6e"],
    [20, "#0369a1"],
    [40, "#0284c7"],
    [60, "#0ea5e9"],
    [80, "#38bdf8"],
    [100, "#7dd3fc"],
  ],
  infrastructure: [
    [0, "#052e16"],
    [20, "#14532d"],
    [40, "#166534"],
    [60, "#16a34a"],
    [80, "#22c55e"],
    [100, "#4ade80"],
  ],
  nightlight: [
    [0, "#422006"],
    [20, "#713f12"],
    [40, "#a16207"],
    [60, "#ca8a04"],
    [80, "#eab308"],
    [100, "#fde047"],
  ],
  rainfall: [
    [0, "#082f49"],
    [20, "#0e7490"],
    [40, "#0891b2"],
    [60, "#06b6d4"],
    [80, "#22d3ee"],
    [100, "#67e8f9"],
  ],
  population: [
    [0, "#4c0519"],
    [20, "#9f1239"],
    [40, "#be123c"],
    [60, "#e11d48"],
    [80, "#fb7185"],
    [100, "#fecdd3"],
  ],
  security: [
    [0, "#14532d"],
    [20, "#16a34a"],
    [40, "#65a30d"],
    [60, "#ca8a04"],
    [80, "#ea580c"],
    [100, "#b91c1c"],
  ],
};

const darkMapStyleUrl =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK_URL ??
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const lightMapStyleUrl =
  process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT_URL ??
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

function getMetricLabel(metric: MetricKey): string {
  const config = METRICS.find((item) => item.key === metric);
  return config?.label ?? "Score";
}

function getMetricScaleLabels(metric: MetricKey): { low: string; high: string } {
  if (metric === "composite") {
    return { low: "Lower risk", high: "Higher risk" };
  }
  if (metric === "infrastructure") {
    return { low: "Lower access", high: "Higher access" };
  }
  if (metric === "nightlight") {
    return { low: "Lower activity", high: "Higher activity" };
  }
  if (metric === "flood") {
    return { low: "Lower exposure", high: "Higher exposure" };
  }
  return { low: "Lower pressure", high: "Higher pressure" };
}

function getRiskBand(score: number): string {
  if (score >= 70) {
    return "High";
  }
  if (score >= 40) {
    return "Moderate";
  }
  return "Low";
}

function metricHeatColors(metric: MetricKey): string[] {
  const stops = METRIC_COLOR_STOPS[metric];
  return [
    "rgba(2,6,23,0)",
    `${stops[1][1]}55`,
    `${stops[2][1]}77`,
    `${stops[4][1]}aa`,
    `${stops[5][1]}dd`,
  ];
}

export function NprmMap({
  cells,
  selectedCell,
  activeMetrics,
  showHeatmap,
  inventoryListings,
  showInventoryOverlay,
  onSelectCell,
  onActiveMetricsChange,
  onToggleHeatmap,
  onToggleInventoryOverlay,
}: NprmMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [statesGeoJson, setStatesGeoJson] = useState<FeatureCollection<Geometry, StateProperties> | null>(null);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [mapStyleUrl, setMapStyleUrl] = useState(darkMapStyleUrl);

  useEffect(() => {
    const loadStates = async () => {
      const response = await fetch("/data/nigeria-adm1.geojson");
      const geojson = (await response.json()) as FeatureCollection<Geometry, StateProperties>;
      setStatesGeoJson(geojson);
    };

    loadStates().catch((error) => {
      console.error("Failed to load Nigeria state boundaries", error);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyMapStyle = () => {
      setMapStyleUrl(mediaQuery.matches ? darkMapStyleUrl : lightMapStyleUrl);
    };

    applyMapStyle();
    mediaQuery.addEventListener("change", applyMapStyle);
    return () => mediaQuery.removeEventListener("change", applyMapStyle);
  }, []);

  useEffect(() => {
    if (!selectedCell || !mapRef.current) {
      return;
    }

    mapRef.current.easeTo({
      center: [selectedCell.lng, selectedCell.lat],
      zoom: 6.2,
      duration: 700,
    });
  }, [selectedCell]);

  const selectedMetricProperties = useMemo(
    () => activeMetrics.map((metric) => METRIC_TO_PROPERTY[metric]),
    [activeMetrics]
  );

  const enrichedStateGeoJson = useMemo(() => {
    if (!statesGeoJson) {
      return null;
    }

    const byState = new globalThis.Map(cells.map((cell) => [cell.state.toLowerCase(), cell]));

    return {
      ...statesGeoJson,
      features: statesGeoJson.features.map((feature) => {
        const cell = byState.get((feature.properties?.shapeName ?? "").toLowerCase());
        const dominant = activeMetrics.reduce<{ metric: MetricKey; value: number } | null>((best, metric) => {
          if (!cell) {
            return best;
          }
          const property = METRIC_TO_PROPERTY[metric];
          const value = cell[property] as number;
          if (!best || value > best.value) {
            return { metric, value };
          }
          return best;
        }, null);

        const selectedScore = cell
          ? Math.round(
              selectedMetricProperties.reduce((sum, property) => sum + (cell[property] as number), 0) /
                Math.max(1, selectedMetricProperties.length)
            )
          : 0;

        return {
          ...feature,
          properties: {
            ...feature.properties,
            id: cell?.id ?? feature.properties?.shapeID,
            state: cell?.state ?? feature.properties?.shapeName,
            flood_score: cell?.flood_score,
            infra_score: cell?.infra_score,
            nightlight_score: cell?.nightlight_score,
            rainfall_score: cell?.rainfall_score,
            population_score: cell?.population_score,
            security_score: cell?.security_score,
            composite_risk_score: cell?.composite_risk_score,
            selected_score: selectedScore,
            dominant_metric: dominant?.metric ?? "composite",
          },
        };
      }),
    } as FeatureCollection<Geometry, StateProperties>;
  }, [statesGeoJson, cells, activeMetrics, selectedMetricProperties]);

  const pointsGeoJson = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: cells.map((cell) => {
        const dominant = activeMetrics.reduce<{ metric: MetricKey; value: number }>((best, metric) => {
          const property = METRIC_TO_PROPERTY[metric];
          const value = cell[property] as number;
          if (value > best.value) {
            return { metric, value };
          }
          return best;
        }, {
          metric: activeMetrics[0] ?? "composite",
          value: -1,
        });

        const selectedScore = Math.round(
          selectedMetricProperties.reduce((sum, property) => sum + (cell[property] as number), 0) /
            Math.max(1, selectedMetricProperties.length)
        );

        return {
          type: "Feature",
          properties: {
            id: cell.id,
            state: cell.state,
            flood_score: cell.flood_score,
            infra_score: cell.infra_score,
            nightlight_score: cell.nightlight_score,
            rainfall_score: cell.rainfall_score,
            population_score: cell.population_score,
            security_score: cell.security_score,
            composite_risk_score: cell.composite_risk_score,
            selected_score: selectedScore,
            dominant_metric: dominant.metric,
          },
          geometry: {
            type: "Point",
            coordinates: [cell.lng, cell.lat],
          },
        };
      }),
    }),
    [cells, activeMetrics, selectedMetricProperties]
  );

  const singleMetric = activeMetrics.length === 1 ? activeMetrics[0] : null;
  const legendGradient = useMemo(() => {
    if (!singleMetric) {
      return null;
    }
    const stops = METRIC_COLOR_STOPS[singleMetric];
    return `linear-gradient(90deg, ${stops.map(([value, color]) => `${color} ${value}%`).join(", ")})`;
  }, [singleMetric]);
  const legendScale = singleMetric ? getMetricScaleLabels(singleMetric) : null;
  const popupScore = useMemo(() => {
    if (!selectedCell) {
      return 0;
    }
    return Math.round(
      activeMetrics.reduce((sum, metric) => sum + (selectedCell[METRIC_TO_PROPERTY[metric]] as number), 0) /
        Math.max(1, activeMetrics.length)
    );
  }, [selectedCell, activeMetrics]);

  const popupSignals = useMemo(() => {
    if (!selectedCell) {
      return [];
    }

    return activeMetrics
      .map((metric) => ({
        metric,
        label: getMetricLabel(metric),
        value: selectedCell[METRIC_TO_PROPERTY[metric]] as number,
      }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 3);
  }, [selectedCell, activeMetrics]);

  const stateFillColorExpression = useMemo(() => {
    if (singleMetric) {
      const stops = METRIC_COLOR_STOPS[singleMetric];
      const expression: (number | string | unknown[])[] = [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "selected_score"], 0],
      ];

      for (const [value, color] of stops) {
        expression.push(value, color);
      }

      return expression;
    }

    return [
      "case",
      ["==", ["get", "dominant_metric"], "flood"],
      "#38bdf8",
      ["==", ["get", "dominant_metric"], "infrastructure"],
      "#22c55e",
      ["==", ["get", "dominant_metric"], "nightlight"],
      "#facc15",
      ["==", ["get", "dominant_metric"], "rainfall"],
      "#22d3ee",
      ["==", ["get", "dominant_metric"], "population"],
      "#fb7185",
      ["==", ["get", "dominant_metric"], "security"],
      "#f97316",
      "#5bc0be",
    ];
  }, [singleMetric]);

  const stateFillLayer: LayerProps = useMemo(
    () => ({
      id: "state-fill",
      type: "fill",
      paint: {
        "fill-color": stateFillColorExpression as never,
        "fill-opacity": singleMetric
          ? 0.72
          : (["interpolate", ["linear"], ["coalesce", ["get", "selected_score"], 0], 0, 0.32, 100, 0.86] as never),
      },
    }),
    [stateFillColorExpression, singleMetric]
  );

  const stateOutlineLayer: LayerProps = {
    id: "state-outline",
    type: "line",
    paint: {
      "line-color": "#d4d4d8",
      "line-width": 0.8,
      "line-opacity": 0.5,
    },
  };

  const centroidCircleLayer: LayerProps = {
    id: "state-centroids",
    type: "circle",
    paint: {
      "circle-color": "#f8fafc",
      "circle-radius": 3,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#0f172a",
      "circle-opacity": 0.85,
    },
  };

  const heatLayer: LayerProps = useMemo(() => {
    const heatColors = singleMetric ? metricHeatColors(singleMetric) : [
      "rgba(2,6,23,0)",
      "rgba(8,145,178,0.35)",
      "rgba(16,185,129,0.45)",
      "rgba(245,158,11,0.6)",
      "rgba(239,68,68,0.75)",
    ];

    return {
      id: "state-heat",
      type: "heatmap",
      maxzoom: 8,
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "selected_score"], 0],
          0,
          0,
          100,
          1,
        ],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 8, 2],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 18, 8, 44],
        "heatmap-opacity": 0.58,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          heatColors[0],
          0.25,
          heatColors[1],
          0.5,
          heatColors[2],
          0.75,
          heatColors[3],
          1,
          heatColors[4],
        ],
      },
    };
  }, [singleMetric]);

  const inventoryGeoJson = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: inventoryListings.map((listing) => ({
        type: "Feature",
        properties: {
          id: listing.id,
          name: listing.name,
          property_type: listing.property_type,
          state: listing.state,
        },
        geometry: {
          type: "Point",
          coordinates: [listing.lng, listing.lat],
        },
      })),
    }),
    [inventoryListings]
  );

  const inventoryCircleLayer: LayerProps = {
    id: "inventory-points",
    type: "circle",
    paint: {
      "circle-color": "#3b82f6",
      "circle-radius": 4.8,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#f8fafc",
      "circle-opacity": 0.95,
    },
  };

  const onMapClick = (event: MapLayerMouseEvent) => {
    const selectedFeature = event.features?.find((feature) => feature.layer.id === "state-fill");
    const id = selectedFeature?.properties?.id as string | undefined;
    if (id) {
      onSelectCell(id);
    }
  };

  const toggleMetric = (metric: MetricKey) => {
    const exists = activeMetrics.includes(metric);
    if (exists && activeMetrics.length === 1) {
      return;
    }

    if (exists) {
      onActiveMetricsChange(activeMetrics.filter((item) => item !== metric));
      return;
    }

    const nextMetrics = [...activeMetrics, metric];
    const orderedMetrics = METRICS.map((item) => item.key).filter((item) => nextMetrics.includes(item));
    onActiveMetricsChange(orderedMetrics);
  };

  const applyPreset = (presetMetrics: MetricKey[]) => {
    onActiveMetricsChange(presetMetrics);
  };

  const isPresetActive = (presetMetrics: MetricKey[]) =>
    presetMetrics.length === activeMetrics.length &&
    presetMetrics.every((metric, index) => activeMetrics[index] === metric);

  const legendContent = (
    <>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--ds-gray-900)]">Layer contrast guide</div>
      {singleMetric && legendGradient ? (
        <div className="mt-2 space-y-1.5">
          <div className="font-mono text-xs text-[var(--ds-gray-900)]">{getMetricLabel(singleMetric)}</div>
          <div className="h-2.5 w-full rounded" style={{ background: legendGradient }} />
          <div className="flex justify-between font-mono text-[10px] text-[var(--ds-gray-900)]">
            <span>{legendScale?.low ?? "Lower"}</span>
            <span>{legendScale?.high ?? "Higher"}</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <div className="font-mono text-xs text-[var(--ds-gray-900)]">
            Multi-layer blend uses dominant signal per state plus intensity by average score.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeMetrics.map((metric) => (
              <span
                key={metric}
                className="rounded border border-[var(--ds-gray-alpha-200)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--ds-gray-1000)]"
              >
                {getMetricLabel(metric)}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const controlsContent = (
    <>
      <div className="mb-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-[var(--ds-gray-900)]">Active layers</div>
      <p className="mb-2 font-mono text-[10px] text-[var(--ds-gray-900)]">
        Select one or multiple layers to compare state-level property risk signals.
      </p>
      <div className="mb-2.5 flex flex-wrap gap-1">
        {METRIC_PRESETS.map((preset) => {
          const active = isPresetActive(preset.metrics);
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset.metrics)}
              className={`rounded border px-1.5 py-0.5 font-mono uppercase ${
                active
                  ? "border-[var(--ds-gray-1000)] bg-[var(--ds-gray-1000)] text-[var(--ds-background-100)]"
                  : "border-[var(--ds-gray-alpha-200)] bg-transparent text-[var(--ds-gray-900)] hover:text-[var(--ds-gray-1000)]"
              }`}
              style={{ fontSize: "9px", letterSpacing: "0.03em" }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div
        className="grid grid-cols-2 gap-1.5"
        style={{ fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
      >
        {METRICS.map((metric) => {
          const Icon = metric.icon;
          const isActive = activeMetrics.includes(metric.key);

          return (
            <button
              key={metric.key}
              type="button"
              onClick={() => toggleMetric(metric.key)}
              className={`flex h-7 items-center justify-center gap-1 rounded border px-1 font-mono leading-tight ${
                isActive
                  ? "border-[var(--ds-gray-1000)] bg-[var(--ds-gray-1000)] text-[var(--ds-background-100)]"
                  : "border-[var(--ds-gray-alpha-200)] bg-transparent text-[var(--ds-gray-900)] hover:text-[var(--ds-gray-1000)]"
              }`}
              style={{
                fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: "9px",
                letterSpacing: "0.005em",
              }}
            >
              <Icon className="h-2.5 w-2.5" /> <span>{metric.label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleHeatmap}
        className="mt-3 h-7 w-full rounded border border-[var(--ds-gray-alpha-200)] bg-transparent px-1 font-mono leading-tight text-[var(--ds-gray-900)] hover:text-[var(--ds-gray-1000)]"
        style={{
          fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "9px",
          letterSpacing: "0.005em",
        }}
      >
        {showHeatmap ? "Hide" : "Show"} heat overlay
      </button>
      <button
        type="button"
        onClick={onToggleInventoryOverlay}
        className="mt-1.5 h-7 w-full rounded border border-[var(--ds-blue-900)] bg-[var(--ds-blue-900)] px-1 font-mono leading-tight text-white hover:opacity-90"
        style={{
          fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "9px",
          letterSpacing: "0.005em",
        }}
      >
        {showInventoryOverlay ? "Hide" : "Show"} Land Republic inventory overlay
      </button>

      <div className="mt-3 border-t border-[var(--ds-gray-alpha-200)] pt-3">{legendContent}</div>
    </>
  );

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-3 top-3 z-20 md:hidden">
        <button
          type="button"
          onClick={() => setMobileControlsOpen((current) => !current)}
          className="inline-flex items-center gap-2 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/95 px-2.5 py-2 font-mono text-[10px] uppercase tracking-wide text-[var(--ds-gray-1000)] shadow-lg backdrop-blur"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Layers ({activeMetrics.length})
        </button>
      </div>

      {mobileControlsOpen && (
        <>
          <button
            type="button"
            onClick={() => setMobileControlsOpen(false)}
            aria-label="Close controls"
            className="absolute inset-0 z-20 bg-black/35 md:hidden"
          />
          <div className="absolute inset-x-3 top-14 z-30 max-h-[calc(100%-5rem)] overflow-y-auto rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/95 p-3 shadow-xl backdrop-blur md:hidden">
            <div className="mb-2 flex items-center justify-between border-b border-[var(--ds-gray-alpha-200)] pb-2">
              <div className="font-mono text-[12px] uppercase tracking-[0.06em] text-[var(--ds-gray-900)]">Map controls</div>
              <button
                type="button"
                onClick={() => setMobileControlsOpen(false)}
                className="rounded border border-[var(--ds-gray-alpha-200)] p-1 text-[var(--ds-gray-900)]"
                aria-label="Close panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {controlsContent}
          </div>
        </>
      )}

      <div className="absolute left-4 top-4 z-10 hidden max-h-[calc(100%-2rem)] w-[330px] overflow-y-auto rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/95 p-3 shadow-xl backdrop-blur md:block">
        {controlsContent}
      </div>

      <MapView
        ref={mapRef}
        initialViewState={DEFAULT_VIEW}
        mapStyle={mapStyleUrl}
        minZoom={4}
        maxZoom={10}
        interactiveLayerIds={["state-fill"]}
        onClick={onMapClick}
        onMouseEnter={() => {
          if (mapRef.current) {
            mapRef.current.getCanvas().style.cursor = "pointer";
          }
        }}
        onMouseLeave={() => {
          if (mapRef.current) {
            mapRef.current.getCanvas().style.cursor = "";
          }
        }}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-right" />

        {enrichedStateGeoJson && (
          <Source id="states" type="geojson" data={enrichedStateGeoJson}>
            <Layer {...stateFillLayer} />
            <Layer {...stateOutlineLayer} />
          </Source>
        )}

        <Source id="state-points" type="geojson" data={pointsGeoJson}>
          {showHeatmap && <Layer {...heatLayer} />}
          <Layer {...centroidCircleLayer} />
        </Source>

        {showInventoryOverlay && inventoryListings.length > 0 ? (
          <Source id="inventory-points-src" type="geojson" data={inventoryGeoJson}>
            <Layer {...inventoryCircleLayer} />
          </Source>
        ) : null}

        {selectedCell && (
          <Popup
            closeButton={false}
            closeOnClick={false}
            longitude={selectedCell.lng}
            latitude={selectedCell.lat}
            anchor="bottom"
          >
            <div className="min-w-[240px] p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--ds-gray-900)]">Selected state</div>
              <div className="font-mono text-sm font-semibold text-[var(--ds-gray-1000)]">{selectedCell.state}</div>
              <div className="mt-2 font-mono text-xs text-[var(--ds-gray-900)]">
                {activeMetrics.length === 1
                  ? getMetricLabel(activeMetrics[0])
                  : `${activeMetrics.length} layers blended`}
              </div>
              <div className="font-mono text-lg font-bold text-[var(--ds-gray-1000)]">
                {popupScore}
                <span className="ml-1 font-mono text-xs font-normal text-[var(--ds-gray-900)]">/ 100</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--ds-gray-900)]">
                Risk band: {getRiskBand(popupScore)}
              </div>
              <div className="mt-2 border-t border-[var(--ds-gray-alpha-200)] pt-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--ds-gray-900)]">
                  Strongest signals
                </div>
                <div className="mt-1 space-y-1">
                  {popupSignals.map((signal) => (
                    <div key={signal.metric} className="flex items-center justify-between gap-2 font-mono text-xs text-[var(--ds-gray-1000)]">
                      <span>{signal.label}</span>
                      <span className="tabular-nums">{signal.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 font-mono text-[10px] text-[var(--ds-gray-900)]">Tap state for full brief</div>
              </div>
            </div>
          </Popup>
        )}
      </MapView>
    </div>
  );
}
