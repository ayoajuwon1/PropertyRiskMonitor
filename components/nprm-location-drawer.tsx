import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FlaskConical,
  ListChecks,
  MapPinned,
  Newspaper,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { MetricKey } from "@/components/map/nprm-map";
import type {
  InventoryListing,
  LayerMetadata,
  LocationCell,
  MapDataResponse,
  SecurityLocationDetails,
  StateContext,
  StateNewsItem,
} from "@/lib/types";
import { REQUIRED_DISCLAIMER } from "@/lib/types";

interface DetailedLocationResponse extends LocationCell {
  layers: LayerMetadata[];
  security_details?: SecurityLocationDetails;
}

interface DisputeTag {
  tag: string;
  count: number;
  severity: "high" | "medium" | "low";
}

interface LocationDrawerProps {
  selectedLocation: (LocationCell & { layers: LayerMetadata[]; security_details?: SecurityLocationDetails }) | null;
  fallbackLayers: LayerMetadata[];
  stateContext: StateContext | null;
  activeMetrics: MetricKey[];
  onActiveMetricsChange: (metrics: MetricKey[]) => void;
  allCells: MapDataResponse[];
  inventoryListings: InventoryListing[];
  showInventoryOverlay: boolean;
  onToggleInventoryOverlay: () => void;
  className?: string;
  alwaysScrollable?: boolean;
}

type SectionKey = "market" | "tools" | "news" | "actions" | "sources";

const CHECKLIST_KEY_PREFIX = "nprm_checklist_v1:";

const METRIC_LABELS: Record<MetricKey, string> = {
  composite: "Overall risk",
  flood: "Flood exposure",
  infrastructure: "Road access",
  nightlight: "Neighborhood activity",
  rainfall: "Rainfall pressure",
  population: "Population pressure",
  security: "Security pressure",
};

const INVESTOR_PROFILES: Array<{
  id: string;
  label: string;
  metrics: MetricKey[];
  description: string;
}> = [
  {
    id: "low-risk-income",
    label: "Low risk income",
    metrics: ["composite", "infrastructure", "security"],
    description: "Prioritizes stability, road quality, and lower security pressure.",
  },
  {
    id: "growth",
    label: "Growth",
    metrics: ["nightlight", "population", "infrastructure"],
    description: "Prioritizes momentum, occupancy demand, and access expansion.",
  },
  {
    id: "land-banking",
    label: "Land banking",
    metrics: ["flood", "rainfall", "security", "infrastructure"],
    description: "Prioritizes downside protection for longer hold timelines.",
  },
];

const COMPOSITE_WEIGHTS = {
  flood: 0.25,
  infraRisk: 0.1,
  nightlight: 0.07,
  rainfall: 0.15,
  population: 0.08,
  security: 0.35,
};

function formatThreatLabel(value: string | null): string {
  if (!value) {
    return "No dominant threat";
  }
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function hashSignal(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function scoreStrength(score: number): string {
  if (score >= 70) {
    return "Strong";
  }
  if (score >= 50) {
    return "Moderate";
  }
  return "Watch";
}

function cadenceStatus(
  frequency: LayerMetadata["update_frequency"],
  lastRefresh: string
): { label: string; className: string } {
  const elapsedMs = Date.now() - new Date(lastRefresh).getTime();
  const elapsedDays = elapsedMs / 86_400_000;

  const cadenceDays = frequency === "weekly" ? 7 : frequency === "monthly" ? 30 : 91;

  if (elapsedDays <= cadenceDays * 1.1) {
    return {
      label: "On cadence",
      className:
        "border-[var(--ds-green-700)]/40 bg-[var(--ds-green-700)]/15 text-[var(--ds-green-700)]",
    };
  }

  if (elapsedDays <= cadenceDays * 1.35) {
    return {
      label: "Due soon",
      className:
        "border-[var(--ds-amber-800)]/40 bg-[var(--ds-amber-800)]/15 text-[var(--ds-amber-800)]",
    };
  }

  return {
    label: "Needs refresh",
    className: "border-[var(--ds-red-700)]/40 bg-[var(--ds-red-700)]/15 text-[var(--ds-red-700)]",
  };
}

function calculateLayerConfidence(layer: LayerMetadata): number {
  if (typeof layer.layer_confidence_score === "number") {
    return clampScore(layer.layer_confidence_score);
  }

  const cadence = cadenceStatus(layer.update_frequency, layer.last_refresh).label;

  let score = 70;
  if (cadence === "On cadence") {
    score += 18;
  } else if (cadence === "Due soon") {
    score += 5;
  } else {
    score -= 14;
  }

  if (layer.source_stamp) {
    score += 5;
  }

  if (layer.coverage_notes.toLowerCase().includes("proxy")) {
    score -= 4;
  }

  return clampScore(score);
}

function buildDisputeTags(items: StateNewsItem[]): DisputeTag[] {
  const tagRules: Array<{ key: string; match: RegExp; severity: DisputeTag["severity"] }> = [
    {
      key: "Land grabbing",
      match: /land\s*grab|grabbed|encroach|forceful takeover/i,
      severity: "high",
    },
    {
      key: "Title fraud",
      match: /title|c of o|certificate|forger|fraud|fake document/i,
      severity: "high",
    },
    {
      key: "Boundary conflict",
      match: /boundary|demarcation|border|survey dispute/i,
      severity: "medium",
    },
    {
      key: "Omonile pressure",
      match: /omonile|levy|extort|area boy/i,
      severity: "medium",
    },
    {
      key: "Tenancy dispute",
      match: /tenant|evict|rent dispute|occupant/i,
      severity: "low",
    },
  ];

  const counts = new globalThis.Map<string, DisputeTag>();

  for (const item of items) {
    for (const rule of tagRules) {
      if (!rule.match.test(item.title)) {
        continue;
      }

      const current = counts.get(rule.key);
      if (current) {
        counts.set(rule.key, { ...current, count: current.count + 1 });
      } else {
        counts.set(rule.key, {
          tag: rule.key,
          count: 1,
          severity: rule.severity,
        });
      }
    }
  }

  return [...counts.values()].sort((left, right) => right.count - left.count);
}

function formatDelta(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
}

function buildSeasonalitySeries(location: LocationCell): Array<{ month: string; flood: number; rainfall: number }> {
  const seed = hashSignal(location.id) % 12;
  const phase = (seed / 12) * Math.PI * 2;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return months.map((month, index) => {
    const t = (index / 12) * Math.PI * 2;
    const flood = clampScore(location.flood_score + Math.sin(t + phase) * 14 + Math.cos(t * 1.3 + phase) * 6);
    const rainfall = clampScore(location.rainfall_score + Math.cos(t + phase) * 12 + Math.sin(t * 1.1 + phase) * 5);

    return {
      month,
      flood,
      rainfall,
    };
  });
}

function computeNigerianMarketLayerScores(location: LocationCell, disputeTagPressure: number) {
  const titleRegistrySignal = clampScore(
    0.38 * (100 - location.security_score) +
      0.24 * location.infra_score +
      0.22 * (100 - disputeTagPressure) +
      0.16 * (100 - location.flood_score)
  );

  const travelTimeSignal = clampScore(
    0.62 * location.infra_score + 0.23 * location.nightlight_score + 0.15 * (100 - location.population_score)
  );

  const utilityReliability = clampScore(
    0.36 * location.infra_score +
      0.28 * (100 - location.security_score) +
      0.24 * location.nightlight_score +
      0.12 * (100 - location.rainfall_score)
  );

  const permitActivity = clampScore(
    0.42 * location.nightlight_score + 0.33 * location.population_score + 0.25 * location.infra_score
  );

  const transactionPulse = clampScore(
    0.45 * location.nightlight_score + 0.32 * location.population_score + 0.23 * location.infra_score
  );

  const livabilityAmenities = clampScore(
    0.31 * location.infra_score +
      0.22 * location.nightlight_score +
      0.24 * (100 - location.security_score) +
      0.23 * (100 - location.flood_score)
  );

  return {
    titleRegistrySignal,
    travelTimeSignal,
    utilityReliability,
    permitActivity,
    transactionPulse,
    livabilityAmenities,
  };
}

function isMetricSelection(active: MetricKey[], target: MetricKey[]): boolean {
  return active.length === target.length && target.every((metric, index) => active[index] === metric);
}

function ScoreCard({
  title,
  value,
  subtitle,
  details = [],
  badge,
}: {
  title: string;
  value: number;
  subtitle: string;
  details?: string[];
  badge?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">{title}</div>
        {badge ? (
          <span className="inline-flex items-center rounded border border-[var(--ds-gray-alpha-200)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] text-[var(--ds-gray-900)]">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">{value}</div>
      <div className="font-mono text-[11px] text-[var(--ds-gray-900)]">{subtitle}</div>
      {details.length > 0 ? (
        <div className="mt-1 space-y-0.5">
          {details.map((detail) => (
            <div key={detail} className="font-mono text-[10px] text-[var(--ds-gray-900)]">
              {detail}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InsightCard({
  title,
  value,
  subtitle,
  className,
}: {
  title: string;
  value: number;
  subtitle: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3 ${className ?? ""}`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--ds-gray-900)]">{title}</div>
      <div className="mt-1 flex items-baseline justify-between">
        <div className="font-mono text-xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">{value}</div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ds-gray-900)]">
          {scoreStrength(value)}
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-[var(--ds-gray-900)]">{subtitle}</div>
    </div>
  );
}

function NewsList({
  items,
  empty,
  limit = 4,
}: {
  items: StateNewsItem[] | undefined;
  empty: string;
  limit?: number;
}) {
  if (!items?.length) {
    return <p className="font-mono text-xs text-[var(--ds-gray-900)]">{empty}</p>;
  }

  return (
    <div className="space-y-2">
      {items.slice(0, limit).map((item) => (
        <a
          key={item.link}
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-2.5 hover:bg-[var(--ds-gray-alpha-100)]"
        >
          <div className="font-mono text-xs font-medium leading-relaxed text-[var(--ds-gray-1000)]">{item.title}</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--ds-gray-900)]">
            {item.source} | {formatDateTime(item.published_at)}
          </div>
        </a>
      ))}
    </div>
  );
}

function CollapsibleSection({
  title,
  subtitle,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ds-gray-900)]" />
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ds-gray-1000)]">{title}</div>
            <div className="mt-0.5 font-mono text-[11px] text-[var(--ds-gray-900)]">{subtitle}</div>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-[var(--ds-gray-900)]" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ds-gray-900)]" />
        )}
      </button>
      {open ? <div className="border-t border-[var(--ds-gray-alpha-200)] p-4">{children}</div> : null}
    </section>
  );
}

export function NprmLocationDrawer({
  selectedLocation,
  fallbackLayers,
  stateContext,
  activeMetrics,
  onActiveMetricsChange,
  allCells,
  inventoryListings,
  showInventoryOverlay,
  onToggleInventoryOverlay,
  className,
  alwaysScrollable = false,
}: LocationDrawerProps) {
  const layers = selectedLocation?.layers ?? fallbackLayers;
  const landRepublicPropertyUrl =
    process.env.NEXT_PUBLIC_LAND_REPUBLIC_PROPERTY_URL ?? "https://landrepublic.co/properties";
  const inspectionUrl =
    process.env.NEXT_PUBLIC_LAND_REPUBLIC_INSPECTION_URL ?? "https://landrepublic.co/properties";

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    market: true,
    tools: true,
    news: true,
    actions: true,
    sources: false,
  });

  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});
  const [compareLocationId, setCompareLocationId] = useState<string>("");
  const [compareLocation, setCompareLocation] = useState<DetailedLocationResponse | null>(null);
  const [compareContext, setCompareContext] = useState<StateContext | null>(null);

  const compareOptions = useMemo(() => {
    if (!selectedLocation) {
      return [];
    }

    return allCells
      .filter((cell) => cell.id !== selectedLocation.id)
      .sort((left, right) => left.state.localeCompare(right.state));
  }, [allCells, selectedLocation]);

  useEffect(() => {
    if (!selectedLocation) {
      setCompareLocationId("");
      return;
    }

    setOpenSections({
      market: true,
      tools: true,
      news: true,
      actions: true,
      sources: false,
    });

    setCompareLocationId(compareOptions[0]?.id ?? "");
  }, [selectedLocation?.id, compareOptions]);

  useEffect(() => {
    if (!compareLocationId) {
      setCompareLocation(null);
      setCompareContext(null);
      return;
    }

    const loadComparison = async () => {
      try {
        const locationRes = await fetch(`/api/location/${compareLocationId}`);
        if (!locationRes.ok) {
          setCompareLocation(null);
          setCompareContext(null);
          return;
        }

        const locationPayload = (await locationRes.json()) as DetailedLocationResponse;
        setCompareLocation(locationPayload);

        const contextRes = await fetch(`/api/state-context/${encodeURIComponent(locationPayload.state)}`);
        if (contextRes.ok) {
          const contextPayload = (await contextRes.json()) as StateContext;
          setCompareContext(contextPayload);
        } else {
          setCompareContext(null);
        }
      } catch {
        setCompareLocation(null);
        setCompareContext(null);
      }
    };

    loadComparison().catch(() => {
      setCompareLocation(null);
      setCompareContext(null);
    });
  }, [compareLocationId]);

  const checklistStorageKey = selectedLocation ? `${CHECKLIST_KEY_PREFIX}${selectedLocation.id}` : null;

  useEffect(() => {
    if (!checklistStorageKey || typeof window === "undefined") {
      setChecklistState({});
      return;
    }

    try {
      const raw = window.localStorage.getItem(checklistStorageKey);
      setChecklistState(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
    } catch {
      setChecklistState({});
    }
  }, [checklistStorageKey]);

  const decisionSignals = useMemo(() => {
    if (!selectedLocation) {
      return null;
    }

    const acquisitionFit = clampScore(
      0.35 * selectedLocation.infra_score +
        0.25 * selectedLocation.nightlight_score +
        0.2 * selectedLocation.population_score +
        0.2 * (100 - selectedLocation.security_score)
    );

    const rentalDemand = clampScore(
      0.42 * selectedLocation.nightlight_score +
        0.32 * selectedLocation.population_score +
        0.18 * selectedLocation.infra_score +
        0.08 * (100 - selectedLocation.flood_score)
    );

    const resilience = clampScore(
      100 -
        (0.45 * selectedLocation.flood_score +
          0.35 * selectedLocation.rainfall_score +
          0.2 * selectedLocation.security_score)
    );

    return {
      acquisitionFit,
      rentalDemand,
      resilience,
    };
  }, [selectedLocation]);

  const rankContext = useMemo(() => {
    if (!selectedLocation || allCells.length === 0) {
      return null;
    }

    const sorted = [...allCells].sort((left, right) => left.composite_risk_score - right.composite_risk_score);
    const index = sorted.findIndex((entry) => entry.id === selectedLocation.id);

    if (index < 0) {
      return null;
    }

    const rank = index + 1;
    const total = sorted.length;
    const saferThan = Math.round(((total - rank) / Math.max(1, total - 1)) * 100);

    return { rank, total, saferThan };
  }, [selectedLocation, allCells]);

  const latestLocationUpdate = useMemo(() => {
    if (!selectedLocation) {
      return null;
    }

    const timestamps = [
      selectedLocation.last_updated_flood,
      selectedLocation.last_updated_infra,
      selectedLocation.last_updated_nightlight,
      selectedLocation.last_updated_rainfall,
      selectedLocation.last_updated_population,
      selectedLocation.last_updated_security,
    ].map((value) => new Date(value).getTime());

    const latest = Math.max(...timestamps);
    return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
  }, [selectedLocation]);

  const disputeTags = useMemo(
    () => buildDisputeTags(stateContext?.dispute_news ?? []),
    [stateContext?.dispute_news]
  );

  const disputeTagPressure = useMemo(
    () =>
      Math.min(
        100,
        disputeTags.reduce((sum, tag) => {
          const weight = tag.severity === "high" ? 16 : tag.severity === "medium" ? 11 : 7;
          return sum + tag.count * weight;
        }, 0)
      ),
    [disputeTags]
  );

  const nigerianMarketLayers = useMemo(() => {
    if (!selectedLocation) {
      return null;
    }
    return computeNigerianMarketLayerScores(selectedLocation, disputeTagPressure);
  }, [selectedLocation, disputeTagPressure]);

  const securityDetails = selectedLocation?.security_details;
  const securitySourceMixLabel = useMemo(() => {
    if (!securityDetails?.source_mix?.length) {
      return "n/a";
    }
    return securityDetails.source_mix.join(" + ");
  }, [securityDetails?.source_mix]);

  const matchedInventoryListings = useMemo(() => {
    if (!selectedLocation) {
      return inventoryListings;
    }

    const byState = inventoryListings.filter(
      (listing) => listing.state.toLowerCase() === selectedLocation.state.toLowerCase()
    );

    return byState.length > 0 ? byState : inventoryListings;
  }, [inventoryListings, selectedLocation]);

  const layerConfidenceMap = useMemo(
    () =>
      Object.fromEntries(
        layers.map((layer) => [layer.layer_name, calculateLayerConfidence(layer)])
      ) as Record<string, number>,
    [layers]
  );

  const overallConfidence = useMemo(() => {
    if (layers.length === 0) {
      return 0;
    }

    const total = layers.reduce((sum, layer) => sum + calculateLayerConfidence(layer), 0);
    return clampScore(total / layers.length);
  }, [layers]);

  const marketTailwinds = useMemo(() => {
    if (!selectedLocation) {
      return [];
    }

    const items: string[] = [];

    if (selectedLocation.infra_score >= 68) {
      items.push("Road access is above national median, supporting commute reliability and rental demand.");
    }

    if (selectedLocation.nightlight_score >= 62) {
      items.push("Nighttime activity is strong, indicating commercial and residential momentum.");
    }

    if (selectedLocation.population_score >= 58) {
      items.push("Population pressure suggests sustained occupancy demand in active districts.");
    }

    if (items.length === 0) {
      items.push("Signals are mixed. Prioritize title verification and site inspections before commitment.");
    }

    return items.slice(0, 3);
  }, [selectedLocation]);

  const marketWatchouts = useMemo(() => {
    if (!selectedLocation) {
      return [];
    }

    const items: string[] = [];

    if (selectedLocation.flood_score >= 65 || selectedLocation.rainfall_score >= 65) {
      items.push("Climate pressure is elevated. Confirm drainage, elevation, and flood history before purchase.");
    }

    if (selectedLocation.security_score >= 62) {
      items.push("Security pressure is above comfort threshold; validate access control and local incident patterns.");
    }

    if (selectedLocation.infra_score <= 45) {
      items.push("Road access is limited, which can affect liquidity and tenant turnover.");
    }

    if (items.length === 0) {
      items.push("No extreme pressure detected in this cycle, but always validate title and neighborhood context offline.");
    }

    return items.slice(0, 3);
  }, [selectedLocation]);

  const seasonalitySeries = useMemo(
    () => (selectedLocation ? buildSeasonalitySeries(selectedLocation) : []),
    [selectedLocation]
  );

  const scoreExplanation = useMemo(() => {
    if (!selectedLocation) {
      return null;
    }

    const previousEstimate = {
      flood: clampScore(selectedLocation.flood_score - (selectedLocation.rainfall_score - 50) * 0.12),
      infra: clampScore(selectedLocation.infra_score - 2),
      nightlight: clampScore(selectedLocation.nightlight_score - selectedLocation.nightlight_trend_delta),
      rainfall: clampScore(selectedLocation.rainfall_score - 2),
      population: clampScore(selectedLocation.population_score - 1),
      security: clampScore(selectedLocation.security_score - 2),
    };

    const previousComposite = clampScore(
      COMPOSITE_WEIGHTS.flood * previousEstimate.flood +
        COMPOSITE_WEIGHTS.infraRisk * (100 - previousEstimate.infra) +
        COMPOSITE_WEIGHTS.nightlight * previousEstimate.nightlight +
        COMPOSITE_WEIGHTS.rainfall * previousEstimate.rainfall +
        COMPOSITE_WEIGHTS.population * previousEstimate.population +
        COMPOSITE_WEIGHTS.security * previousEstimate.security
    );

    const deltas = [
      {
        label: "Flood pressure",
        delta: selectedLocation.flood_score - previousEstimate.flood,
        weightedImpact: COMPOSITE_WEIGHTS.flood * (selectedLocation.flood_score - previousEstimate.flood),
      },
      {
        label: "Road access risk",
        delta: previousEstimate.infra - selectedLocation.infra_score,
        weightedImpact: COMPOSITE_WEIGHTS.infraRisk * (previousEstimate.infra - selectedLocation.infra_score),
      },
      {
        label: "Neighborhood activity",
        delta: selectedLocation.nightlight_score - previousEstimate.nightlight,
        weightedImpact: COMPOSITE_WEIGHTS.nightlight * (selectedLocation.nightlight_score - previousEstimate.nightlight),
      },
      {
        label: "Rainfall pressure",
        delta: selectedLocation.rainfall_score - previousEstimate.rainfall,
        weightedImpact: COMPOSITE_WEIGHTS.rainfall * (selectedLocation.rainfall_score - previousEstimate.rainfall),
      },
      {
        label: "Population pressure",
        delta: selectedLocation.population_score - previousEstimate.population,
        weightedImpact: COMPOSITE_WEIGHTS.population * (selectedLocation.population_score - previousEstimate.population),
      },
      {
        label: "Security pressure",
        delta: selectedLocation.security_score - previousEstimate.security,
        weightedImpact: COMPOSITE_WEIGHTS.security * (selectedLocation.security_score - previousEstimate.security),
      },
    ]
      .sort((left, right) => Math.abs(right.weightedImpact) - Math.abs(left.weightedImpact))
      .slice(0, 3);

    return {
      previousComposite,
      delta: selectedLocation.composite_risk_score - previousComposite,
      topDrivers: deltas,
      securityImpact: COMPOSITE_WEIGHTS.security * (selectedLocation.security_score - previousEstimate.security),
    };
  }, [selectedLocation]);

  const scenarioProjection = useMemo(() => {
    if (!selectedLocation || !decisionSignals) {
      return null;
    }

    const growthRelief = selectedLocation.nightlight_trend_delta > 0 ? Math.min(8, selectedLocation.nightlight_trend_delta * 0.8) : 0;
    const climateRisk = Math.max(0, selectedLocation.rainfall_score - 58) * 0.18;
    const securityRisk = Math.max(0, selectedLocation.security_score - 60) * COMPOSITE_WEIGHTS.security;

    const waitScore = clampScore(selectedLocation.composite_risk_score + climateRisk + securityRisk - growthRelief);

    let recommendation = "Balanced";
    if (waitScore <= selectedLocation.composite_risk_score - 4) {
      recommendation = "Wait 6 months";
    } else if (waitScore >= selectedLocation.composite_risk_score + 4) {
      recommendation = "Buy now";
    }

    return {
      now: selectedLocation.composite_risk_score,
      wait: waitScore,
      recommendation,
    };
  }, [selectedLocation, decisionSignals]);

  const checklistItems = useMemo(() => {
    if (!selectedLocation) {
      return [] as Array<{ id: string; label: string; critical: boolean }>;
    }

    const items: Array<{ id: string; label: string; critical: boolean }> = [
      {
        id: "title-registry",
        label: "Verify title chain and registry status (C of O / Governor's consent where applicable).",
        critical: selectedLocation.security_score >= 55 || disputeTags.some((tag) => tag.tag === "Title fraud"),
      },
      {
        id: "survey-beacon",
        label: "Confirm survey coordinates, beacon points, and boundary alignment.",
        critical: disputeTags.some((tag) => tag.tag === "Boundary conflict"),
      },
      {
        id: "flood-drainage",
        label: "Inspect flood channels, drainage outflow, and rainy-season access routes.",
        critical: selectedLocation.flood_score >= 60 || selectedLocation.rainfall_score >= 60,
      },
      {
        id: "road-access",
        label: "Check road quality and peak-hour travel reliability to key demand zones.",
        critical: selectedLocation.infra_score <= 50,
      },
      {
        id: "utility-proof",
        label: "Collect utility evidence: power uptime, transformer load, telecom quality.",
        critical: selectedLocation.security_score >= 60,
      },
      {
        id: "community-risks",
        label: "Interview local residents on levies, community security, and eviction history.",
        critical: disputeTags.some((tag) => tag.tag === "Omonile pressure"),
      },
      {
        id: "pricing-comps",
        label: "Validate recent asking prices and rent comps within 3-5 km.",
        critical: selectedLocation.nightlight_score >= 60 || selectedLocation.population_score >= 60,
      },
      {
        id: "legal-review",
        label: "Run legal due diligence before payment milestones or full commitment.",
        critical: true,
      },
    ];

    return items;
  }, [selectedLocation, disputeTags]);

  const checklistProgress = useMemo(() => {
    if (checklistItems.length === 0) {
      return { done: 0, total: 0, percent: 0 };
    }

    const done = checklistItems.filter((item) => checklistState[item.id]).length;
    return {
      done,
      total: checklistItems.length,
      percent: Math.round((done / checklistItems.length) * 100),
    };
  }, [checklistItems, checklistState]);

  const comparisonRows = useMemo(() => {
    if (!selectedLocation || !compareLocation) {
      return [] as Array<{ label: string; left: number; right: number; higherBetter: boolean }>;
    }

    const compareDerived = computeNigerianMarketLayerScores(compareLocation, 0);
    const selectedDerived = nigerianMarketLayers;

    return [
      {
        label: "Overall risk",
        left: selectedLocation.composite_risk_score,
        right: compareLocation.composite_risk_score,
        higherBetter: false,
      },
      {
        label: "Road access",
        left: selectedLocation.infra_score,
        right: compareLocation.infra_score,
        higherBetter: true,
      },
      {
        label: "Neighborhood activity",
        left: selectedLocation.nightlight_score,
        right: compareLocation.nightlight_score,
        higherBetter: true,
      },
      {
        label: "Security pressure",
        left: selectedLocation.security_score,
        right: compareLocation.security_score,
        higherBetter: false,
      },
      {
        label: "Transaction pulse",
        left: selectedDerived?.transactionPulse ?? 0,
        right: compareDerived.transactionPulse,
        higherBetter: true,
      },
    ];
  }, [selectedLocation, compareLocation, nigerianMarketLayers]);

  const handleChecklistToggle = (itemId: string) => {
    if (!checklistStorageKey || typeof window === "undefined") {
      return;
    }

    setChecklistState((current) => {
      const next = {
        ...current,
        [itemId]: !current[itemId],
      };
      window.localStorage.setItem(checklistStorageKey, JSON.stringify(next));
      return next;
    });
  };

  return (
    <aside
      className={`flex h-full w-full flex-col border-t border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] md:w-[450px] md:border-l md:border-t-0 ${
        className ?? ""
      }`}
    >
      <div className="border-b border-[var(--ds-gray-alpha-200)] px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--ds-gray-900)]">Property decision brief</div>
        <h2 className="font-mono text-xl font-semibold text-[var(--ds-gray-1000)]">
          {selectedLocation ? selectedLocation.state : "Select a state"}
        </h2>
        <p className="mt-1 font-mono text-xs text-[var(--ds-gray-900)]">
          {selectedLocation
            ? "Use this brief to compare risk, watch trends, track disputes, and prepare due diligence."
            : "Tap any state to open buyer-friendly risk context and local signals."}
        </p>

        {selectedLocation ? (
          <>
            <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-2.5">
              <div className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Overall risk</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                  {selectedLocation.composite_risk_score}
                </div>
              </div>
              <div className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Safer than</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                  {rankContext ? `${rankContext.saferThan}%` : "-"}
                </div>
              </div>
              <div className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Rank</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                  {rankContext ? `${rankContext.rank}/${rankContext.total}` : "-"}
                </div>
              </div>
            </div>
            <div className="mt-2 inline-flex items-center rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ds-gray-900)]">
              Model confidence {overallConfidence}/100
            </div>
          </>
        ) : null}

        <div className="mt-3 rounded-lg border border-[var(--ds-blue-600)]/35 bg-[var(--ds-blue-900)]/10 p-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ds-gray-1000)]">
            Ready to browse listings?
          </div>
          <a
            href={landRepublicPropertyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded border border-[var(--ds-blue-900)] bg-[var(--ds-blue-900)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-white shadow-sm hover:opacity-90"
          >
            Visit Land Republic property page
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div
        className={`space-y-3 px-4 py-4 ${
          alwaysScrollable ? "min-h-0 flex-1 overflow-y-auto" : "md:min-h-0 md:flex-1 md:overflow-y-auto"
        }`}
      >
        {selectedLocation ? (
          <>
            <div className="overflow-hidden rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)]">
              {stateContext?.image_url ? (
                <img
                  src={stateContext.image_url}
                  alt={`${selectedLocation.state} context`}
                  className="h-28 w-full object-cover sm:h-36"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div className="space-y-3 p-4">
                <div>
                  <div className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ds-gray-900)]">Quick state pulse</div>
                  <p className="mt-1 font-mono text-xs leading-relaxed text-[var(--ds-gray-900)]">
                    {stateContext?.summary
                      ? `${stateContext.summary.slice(0, 195)}${stateContext.summary.length > 195 ? "..." : ""}`
                      : "Use this snapshot to balance flood pressure, access quality, and growth momentum before any property move."}
                  </p>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">
                    Active layers in this view
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {activeMetrics.map((metric) => (
                      <span
                        key={metric}
                        className="inline-flex items-center rounded border border-[var(--ds-gray-alpha-200)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--ds-gray-1000)]"
                      >
                        {METRIC_LABELS[metric]}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">
                  Latest layer refresh: {latestLocationUpdate ? `${formatDateTime(latestLocationUpdate)} WAT` : "-"}
                </div>
              </div>
            </div>

            <CollapsibleSection
              title="Market intelligence"
              subtitle="Actionable investor signals derived from current layer scores."
              icon={Sparkles}
              open={openSections.market}
              onToggle={() =>
                setOpenSections((current) => ({
                  ...current,
                  market: !current.market,
                }))
              }
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ScoreCard
                  title="Flood exposure"
                  value={selectedLocation.flood_score}
                  subtitle={`Updated ${formatDateTime(selectedLocation.last_updated_flood)} WAT`}
                />
                <ScoreCard
                  title="Road access"
                  value={selectedLocation.infra_score}
                  subtitle={`Avg distance to major roads: ${selectedLocation.distance_to_major_roads_km} km`}
                />
                <ScoreCard
                  title="Neighborhood activity"
                  value={selectedLocation.nightlight_score}
                  subtitle={`Night-light trend delta: ${selectedLocation.nightlight_trend_delta}`}
                />
                <ScoreCard
                  title="Rainfall pressure"
                  value={selectedLocation.rainfall_score}
                  subtitle={`Rainfall anomaly index: ${selectedLocation.rainfall_anomaly_index}`}
                />
                <ScoreCard
                  title="Population pressure"
                  value={selectedLocation.population_score}
                  subtitle={`Population density index: ${selectedLocation.population_density_index}`}
                />
                <ScoreCard
                  title="Security pressure"
                  value={selectedLocation.security_score}
                  subtitle={`Incident pressure index: ${selectedLocation.security_incident_index}`}
                  badge={`Confidence ${securityDetails?.confidence_score ?? selectedLocation.security_confidence_score ?? 0}/100`}
                  details={[
                    `90-day events: ${securityDetails?.event_count_90d ?? selectedLocation.security_event_count_90d ?? 0}`,
                    `Top threat: ${formatThreatLabel(securityDetails?.top_threat ?? selectedLocation.security_top_threat ?? null)}`,
                    ...(securityDetails?.top_threats?.length
                      ? [
                          `Top mix: ${securityDetails.top_threats
                            .map((entry) => `${formatThreatLabel(entry.category)} (${entry.count})`)
                            .join(", ")}`,
                        ]
                      : []),
                    `Signal refresh: ${
                      securityDetails?.last_ingest_refresh
                        ? `${formatDateTime(securityDetails.last_ingest_refresh)} WAT`
                        : "n/a"
                    }`,
                  ]}
                />
              </div>

              {decisionSignals ? (
                <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  <InsightCard
                    title="Acquisition fit"
                    value={decisionSignals.acquisitionFit}
                    subtitle="Access, demand, activity, and safety balance."
                  />
                  <InsightCard
                    title="Rental demand"
                    value={decisionSignals.rentalDemand}
                    subtitle="Tenant momentum from activity and population pressure."
                  />
                  <InsightCard
                    title="Build resilience"
                    value={decisionSignals.resilience}
                    subtitle="Inverse flood, rainfall, and security pressure."
                    className="md:col-span-2"
                  />
                </div>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                <div className="rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-green-700)]">Tailwinds</div>
                  <div className="mt-1 space-y-1 font-mono text-xs text-[var(--ds-gray-900)]">
                    {marketTailwinds.map((item) => (
                      <p key={item}>- {item}</p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-red-700)]">Watch-outs</div>
                  <div className="mt-1 space-y-1 font-mono text-xs text-[var(--ds-gray-900)]">
                    {marketWatchouts.map((item) => (
                      <p key={item}>- {item}</p>
                    ))}
                  </div>
                </div>
              </div>

              {nigerianMarketLayers ? (
                <div className="mt-3 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">
                    Nigerian market layers (beta)
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <div>Title/registry signal</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                        {nigerianMarketLayers.titleRegistrySignal}
                      </div>
                    </div>
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <div>Travel-time layer</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                        {nigerianMarketLayers.travelTimeSignal}
                      </div>
                    </div>
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <div>Utility reliability</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                        {nigerianMarketLayers.utilityReliability}
                      </div>
                    </div>
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <div>Permit activity</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                        {nigerianMarketLayers.permitActivity}
                      </div>
                    </div>
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <div>Transaction pulse</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                        {nigerianMarketLayers.transactionPulse}
                      </div>
                    </div>
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <div>Livability amenities</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--ds-gray-1000)]">
                        {nigerianMarketLayers.livabilityAmenities}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </CollapsibleSection>

            <CollapsibleSection
              title="Decision tools"
              subtitle="Compare mode, seasonality, score explainability, profiles, and scenarios."
              icon={FlaskConical}
              open={openSections.tools}
              onToggle={() =>
                setOpenSections((current) => ({
                  ...current,
                  tools: !current.tools,
                }))
              }
            >
              <div className="rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Investor profile presets</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {INVESTOR_PROFILES.map((profile) => {
                    const active = isMetricSelection(activeMetrics, profile.metrics);
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => onActiveMetricsChange(active ? ["composite"] : profile.metrics)}
                        className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${
                          active
                            ? "border-[var(--ds-gray-1000)] bg-[var(--ds-gray-1000)] text-[var(--ds-background-100)]"
                            : "border-[var(--ds-gray-alpha-200)] text-[var(--ds-gray-900)] hover:text-[var(--ds-gray-1000)]"
                        }`}
                      >
                        {profile.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                  {INVESTOR_PROFILES.find((profile) => isMetricSelection(activeMetrics, profile.metrics))?.description ??
                    "Select a profile to auto-set map layers. Tap active profile again to reset."}
                </p>
              </div>

              <div className="mt-3 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Compare mode</div>
                <div className="mt-2">
                  <select
                    value={compareLocationId}
                    onChange={(event) => setCompareLocationId(event.target.value)}
                    className="w-full rounded border border-[var(--ds-gray-alpha-200)] bg-transparent px-2 py-1.5 font-mono text-xs text-[var(--ds-gray-1000)]"
                    style={{
                      fontFamily:
                        "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    }}
                  >
                    {compareOptions.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        className="bg-[var(--ds-background-100)] text-[var(--ds-gray-1000)]"
                        style={{
                          fontFamily:
                            "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        }}
                      >
                        {option.state}
                      </option>
                    ))}
                  </select>
                </div>

                {compareLocation ? (
                  <>
                    <div className="mt-2 overflow-hidden rounded border border-[var(--ds-gray-alpha-200)]">
                      <div className="grid grid-cols-3 border-b border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ds-gray-900)]">
                        <span>Signal</span>
                        <span className="text-center">{selectedLocation.state}</span>
                        <span className="text-center">{compareLocation.state}</span>
                      </div>
                      <div className="divide-y divide-[var(--ds-gray-alpha-200)]">
                        {comparisonRows.map((row) => {
                          const leftWins = row.higherBetter ? row.left >= row.right : row.left <= row.right;

                          return (
                            <div key={row.label} className="grid grid-cols-3 px-2 py-1.5 font-mono text-[11px] text-[var(--ds-gray-900)]">
                              <span>{row.label}</span>
                              <span className={`text-center tabular-nums ${leftWins ? "text-[var(--ds-gray-1000)]" : ""}`}>{row.left}</span>
                              <span className={`text-center tabular-nums ${!leftWins ? "text-[var(--ds-gray-1000)]" : ""}`}>{row.right}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                        <div>{selectedLocation.state} trend delta</div>
                        <div className="mt-0.5">{selectedLocation.nightlight_trend_delta}</div>
                      </div>
                      <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                        <div>{compareLocation.state} trend delta</div>
                        <div className="mt-0.5">{compareLocation.nightlight_trend_delta}</div>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                        <div>{selectedLocation.state} news/disputes</div>
                        <div className="mt-0.5">
                          {stateContext?.news_metrics?.local_count ?? stateContext?.news.length ?? 0}/
                          {stateContext?.news_metrics?.dispute_count ?? stateContext?.dispute_news.length ?? 0}
                        </div>
                      </div>
                      <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                        <div>{compareLocation.state} news/disputes</div>
                        <div className="mt-0.5">
                          {compareContext?.news_metrics?.local_count ?? compareContext?.news.length ?? 0}/
                          {compareContext?.news_metrics?.dispute_count ?? compareContext?.dispute_news.length ?? 0}
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

              <div className="mt-3 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Seasonality view (flood vs rainfall)</div>
                <div className="mt-2 overflow-x-auto">
                  <div className="grid min-w-[520px] grid-cols-12 gap-1.5">
                    {seasonalitySeries.map((point) => (
                      <div key={point.month} className="rounded border border-[var(--ds-gray-alpha-200)] p-1">
                        <div className="flex h-16 items-end justify-center gap-0.5">
                          <div
                            className="w-1.5 rounded-sm bg-sky-400"
                            style={{ height: `${Math.max(5, point.flood * 0.62)}%` }}
                            title={`Flood ${point.flood}`}
                          />
                          <div
                            className="w-1.5 rounded-sm bg-cyan-300"
                            style={{ height: `${Math.max(5, point.rainfall * 0.62)}%` }}
                            title={`Rainfall ${point.rainfall}`}
                          />
                        </div>
                        <div className="mt-1 text-center font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ds-gray-900)]">
                          {point.month}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-1 font-mono text-[10px] text-[var(--ds-gray-900)]">Blue: flood | Cyan: rainfall</div>
              </div>

              {scoreExplanation ? (
                <div className="mt-3 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Explain score (cycle delta estimate)</div>
                  <div className="mt-1 flex items-end gap-2 font-mono text-[var(--ds-gray-1000)]">
                    <span className="text-2xl font-semibold tabular-nums">{formatDelta(scoreExplanation.delta)}</span>
                    <span className="text-xs text-[var(--ds-gray-900)]">
                      vs prev cycle ({scoreExplanation.previousComposite})
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {scoreExplanation.topDrivers.map((driver) => (
                      <div
                        key={driver.label}
                        className="flex items-center justify-between gap-2 font-mono text-[11px] text-[var(--ds-gray-900)]"
                      >
                        <span>{driver.label}</span>
                        <span className="tabular-nums text-[var(--ds-gray-1000)]">{formatDelta(Number(driver.weightedImpact.toFixed(1)))}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-[var(--ds-gray-alpha-200)] pt-2">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <span>Security weighted contribution</span>
                      <span className="tabular-nums text-[var(--ds-gray-1000)]">
                        {formatDelta(Number(scoreExplanation.securityImpact.toFixed(1)))}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {scenarioProjection ? (
                <div className="mt-3 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">Scenario outlook (buy now vs wait 6 months)</div>
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      Buy now risk: <span className="font-semibold text-[var(--ds-gray-1000)]">{scenarioProjection.now}</span>
                    </div>
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      Wait 6m risk: <span className="font-semibold text-[var(--ds-gray-1000)]">{scenarioProjection.wait}</span>
                    </div>
                    <div className="rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      Suggestion: <span className="font-semibold text-[var(--ds-gray-1000)]">{scenarioProjection.recommendation}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </CollapsibleSection>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-4 font-mono text-sm text-[var(--ds-gray-900)]">
            No state selected yet.
          </div>
        )}

        <CollapsibleSection
          title="News signals"
          subtitle="Current local context from good news, local updates, and disputes."
          icon={Newspaper}
          open={openSections.news}
          onToggle={() =>
            setOpenSections((current) => ({
              ...current,
              news: !current.news,
            }))
          }
        >
          <div className="mb-3 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ds-gray-900)]">
            News refresh: {stateContext?.news_metrics?.last_refresh ? `${formatDateTime(stateContext.news_metrics.last_refresh)} WAT` : "n/a"}{" "}
            | Cycle: {stateContext?.news_metrics?.source_stamp ?? "n/a"}
          </div>
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ds-gray-900)]">
              <TrendingUp className="h-3.5 w-3.5" />
              Good real-estate news {selectedLocation ? `(${selectedLocation.state})` : ""}
            </div>
            <NewsList
              items={stateContext?.positive_news}
              empty="Select a state to load positive real-estate developments and investment momentum updates."
              limit={4}
            />
          </div>

          <div className="mb-4 border-t border-[var(--ds-gray-alpha-200)] pt-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ds-gray-900)]">
              <Newspaper className="h-3.5 w-3.5" />
              Recent local news {selectedLocation ? `(${selectedLocation.state})` : ""}
            </div>
            <NewsList
              items={stateContext?.news}
              empty="Select a state to load related housing, infrastructure, and market news."
              limit={3}
            />
          </div>

          <div className="border-t border-[var(--ds-gray-alpha-200)] pt-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ds-gray-900)]">
              <Scale className="h-3.5 w-3.5" />
              Recent dispute signals {selectedLocation ? `(${selectedLocation.state})` : ""}
            </div>
            <NewsList
              items={stateContext?.dispute_news}
              empty="Select a state to load recent Omonile-related and land-dispute stories."
              limit={3}
            />

            {disputeTags.length > 0 ? (
              <div className="mt-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--ds-gray-900)]">Dispute intelligence tags</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {disputeTags.map((tag) => (
                    <span
                      key={tag.tag}
                      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
                        tag.severity === "high"
                          ? "border-[var(--ds-red-700)]/50 bg-[var(--ds-red-700)]/12 text-[var(--ds-red-700)]"
                          : tag.severity === "medium"
                            ? "border-[var(--ds-amber-800)]/50 bg-[var(--ds-amber-800)]/12 text-[var(--ds-amber-800)]"
                            : "border-[var(--ds-green-700)]/50 bg-[var(--ds-green-700)]/12 text-[var(--ds-green-700)]"
                      }`}
                    >
                      {tag.tag} ({tag.count})
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Due diligence and actions"
          subtitle="Checklist, inspection request, and inventory overlay."
          icon={ListChecks}
          open={openSections.actions}
          onToggle={() =>
            setOpenSections((current) => ({
              ...current,
              actions: !current.actions,
            }))
          }
        >
          <div className="grid grid-cols-1 gap-2">
            <a
              href={`${inspectionUrl}?state=${encodeURIComponent(selectedLocation?.state ?? "Nigeria")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded border border-[var(--ds-blue-900)] bg-[var(--ds-blue-900)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-white"
            >
              Request inspection
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="mt-3 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">
                  Land Republic inventory overlay
                </div>
                <div className="font-mono text-[11px] text-[var(--ds-gray-900)]">Show matching listings directly on the map.</div>
              </div>
              <button
                type="button"
                onClick={onToggleInventoryOverlay}
                className="rounded border border-[var(--ds-blue-900)] bg-[var(--ds-blue-900)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white"
              >
                {showInventoryOverlay ? "Overlay on" : "Overlay off"}
              </button>
            </div>

            {matchedInventoryListings.length > 0 ? (
              <div className="mt-2 grid grid-cols-1 gap-1.5">
                {matchedInventoryListings.map((listing) => (
                  <a
                    key={listing.id}
                    href={listing.map_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-[var(--ds-gray-alpha-200)] p-2 hover:bg-[var(--ds-gray-alpha-100)]"
                  >
                    <div className="font-mono text-[11px] text-[var(--ds-gray-1000)]">{listing.name}</div>
                    <div className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ds-gray-900)]">
                      <MapPinned className="h-3 w-3" />
                      {listing.property_type} | {listing.city}, {listing.state}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ds-gray-900)]">
                      Status: {listing.status}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-2 font-mono text-xs text-[var(--ds-gray-900)]">Select a state to load matching listings.</div>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">
                Due diligence checklist
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ds-gray-900)]">
                {checklistProgress.done}/{checklistProgress.total} ({checklistProgress.percent}%)
              </div>
            </div>

            <div className="mt-2 space-y-1.5">
              {checklistItems.map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-2 rounded border border-[var(--ds-gray-alpha-200)] p-2 font-mono text-[11px] text-[var(--ds-gray-900)]"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checklistState[item.id])}
                    onChange={() => handleChecklistToggle(item.id)}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <span>
                    {item.label}
                    {item.critical ? (
                      <span className="ml-1 inline-flex rounded border border-[var(--ds-red-700)]/45 px-1 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--ds-red-700)]">
                        critical
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>

            {checklistProgress.percent === 100 ? (
              <div className="mt-2 inline-flex items-center gap-1 rounded border border-[var(--ds-green-700)]/45 bg-[var(--ds-green-700)]/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ds-green-700)]">
                <CheckCircle2 className="h-3 w-3" />
                Due diligence complete
              </div>
            ) : null}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Layer freshness and sources"
          subtitle="Cadence health, source cycles, confidence, and official references."
          icon={ShieldAlert}
          open={openSections.sources}
          onToggle={() =>
            setOpenSections((current) => ({
              ...current,
              sources: !current.sources,
            }))
          }
        >
          <div className="space-y-2">
            {layers.map((layer) => {
              const freshness = cadenceStatus(layer.update_frequency, layer.last_refresh);
              const confidence = layerConfidenceMap[layer.layer_name] ?? calculateLayerConfidence(layer);

              return (
                <div
                  key={layer.layer_name}
                  className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-sm font-semibold text-[var(--ds-gray-1000)]">{layer.display_name}</div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${freshness.className}`}
                      >
                        {freshness.label}
                      </span>
                      <span className="inline-flex items-center rounded border border-[var(--ds-gray-alpha-200)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ds-gray-900)]">
                        Confidence {confidence}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-[var(--ds-gray-900)]">{layer.customer_use_case}</div>
                  <div className="mt-2 font-mono text-xs text-[var(--ds-gray-900)]">{layer.source_name}</div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--ds-gray-900)]">
                    Frequency: {layer.update_frequency} | Last refresh: {formatDateTime(layer.last_refresh)} WAT
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--ds-gray-900)]">Source cycle: {layer.source_stamp ?? "n/a"}</div>
                  {layer.layer_name === "security" ? (
                    <div className="mt-1 space-y-0.5 font-mono text-[11px] text-[var(--ds-gray-900)]">
                      <div>Source mix: {layer.source_mix?.join(" + ") || securitySourceMixLabel}</div>
                      <div>
                        Ingest refresh: {layer.ingest_last_refresh ? `${formatDateTime(layer.ingest_last_refresh)} WAT` : "n/a"}
                      </div>
                      <div>
                        Publish refresh: {layer.publish_last_refresh ? `${formatDateTime(layer.publish_last_refresh)} WAT` : "n/a"}
                      </div>
                    </div>
                  ) : null}
                  <a
                    href={layer.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--ds-blue-600)] underline-offset-2 hover:underline"
                  >
                    Source reference <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>

        <div className="rounded border border-[var(--ds-orange-600)]/40 bg-[var(--ds-orange-600)]/10 p-3 font-mono text-xs text-[var(--ds-gray-1000)]">
          {REQUIRED_DISCLAIMER}
        </div>
      </div>
    </aside>
  );
}
