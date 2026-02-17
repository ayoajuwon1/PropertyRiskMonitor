"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NprmHeader } from "@/components/nprm-header";
import { NprmLocationDrawer } from "@/components/nprm-location-drawer";
import { NprmMap, type MetricKey } from "@/components/map/nprm-map";
import type { InventoryListing, LayerMetadata, LocationCell, MapDataResponse, StateContext } from "@/lib/types";
import { REQUIRED_DISCLAIMER } from "@/lib/types";
import landRepublicInventoryData from "@/data/land-republic-inventory.json";

interface SelectedLocationResponse extends LocationCell {
  layers: LayerMetadata[];
}

type MobileBriefState = "collapsed" | "peek" | "expanded";

export function NprmApp() {
  const [cells, setCells] = useState<MapDataResponse[]>([]);
  const [layers, setLayers] = useState<LayerMetadata[]>([]);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocationResponse | null>(null);
  const [stateContext, setStateContext] = useState<StateContext | null>(null);
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(["composite"]);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showInventoryOverlay, setShowInventoryOverlay] = useState(true);
  const [mobileBriefState, setMobileBriefState] = useState<MobileBriefState>("collapsed");
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [mapDataRes, layersRes] = await Promise.all([fetch("/api/map-data"), fetch("/api/layers")]);
        const [mapDataJson, layersJson] = await Promise.all([mapDataRes.json(), layersRes.json()]);

        setCells(mapDataJson as MapDataResponse[]);
        setLayers(layersJson as LayerMetadata[]);
      } catch (error) {
        console.error("Failed to bootstrap NPRM data", error);
      } finally {
        setIsBootstrapping(false);
      }
    };

    bootstrap().catch((error) => {
      console.error(error);
      setIsBootstrapping(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedCellId) {
      setSelectedLocation(null);
      setStateContext(null);
      return;
    }

    const hydrateLocation = async () => {
      try {
        const response = await fetch(`/api/location/${selectedCellId}`);
        if (!response.ok) {
          setSelectedLocation(null);
          return;
        }
        const payload = (await response.json()) as SelectedLocationResponse;
        setSelectedLocation(payload);
      } catch (error) {
        console.error("Failed to load selected location", error);
      }
    };

    hydrateLocation().catch((error) => {
      console.error(error);
    });
  }, [selectedCellId]);

  useEffect(() => {
    const stateName = selectedLocation?.state;
    if (!stateName) {
      setStateContext(null);
      return;
    }

    const loadStateContext = async () => {
      try {
        const response = await fetch(`/api/state-context/${encodeURIComponent(stateName)}`);
        if (!response.ok) {
          setStateContext(null);
          return;
        }
        const payload = (await response.json()) as StateContext;
        setStateContext(payload);
      } catch (error) {
        console.error("Failed to load state context", error);
      }
    };

    loadStateContext().catch((error) => {
      console.error(error);
    });
  }, [selectedLocation?.state]);

  useEffect(() => {
    if (!selectedCellId || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia("(max-width: 767px)").matches) {
      setMobileBriefState((current) => (current === "expanded" ? "expanded" : "peek"));
    }
  }, [selectedCellId]);

  const selectedCell = useMemo(
    () => cells.find((cell) => cell.id === selectedCellId) ?? null,
    [cells, selectedCellId]
  );

  const inventoryListings = useMemo(
    () => landRepublicInventoryData as InventoryListing[],
    []
  );

  const latestRefresh = useMemo(() => {
    if (layers.length === 0) {
      return null;
    }

    return layers.reduce((latest, layer) => {
      const current = new Date(layer.last_refresh).getTime();
      const previous = latest ? new Date(latest).getTime() : 0;
      return current > previous ? layer.last_refresh : latest;
    }, layers[0].last_refresh);
  }, [layers]);

  const mobileBriefTransformClass =
    mobileBriefState === "expanded"
      ? "translate-y-0"
      : mobileBriefState === "peek"
        ? "translate-y-[calc(100%-12rem)]"
        : "translate-y-[calc(100%-3.75rem)]";

  const mobileBriefPrompt =
    mobileBriefState === "collapsed"
      ? "Tap to preview"
      : mobileBriefState === "peek"
        ? "Tap again for full brief"
        : "Tap to collapse";

  const handleMobileBriefTap = () => {
    setMobileBriefState((current) => {
      if (current === "collapsed") {
        return "peek";
      }
      if (current === "peek") {
        return "expanded";
      }
      return "collapsed";
    });
  };

  return (
    <main className="relative flex min-h-screen flex-col md:h-screen">
      <NprmHeader locationCount={cells.length} lastRefresh={latestRefresh} />

      <div className="relative flex flex-1 md:overflow-hidden">
        <section className="relative min-h-[16rem] flex-1 bg-black md:h-auto md:min-h-0">
          {isBootstrapping ? (
            <div className="flex h-full items-center justify-center font-mono text-sm text-[var(--ds-gray-900)]">
              Loading Nigeria property risk insights...
            </div>
          ) : (
            <NprmMap
              cells={cells}
              selectedCell={selectedCell}
              activeMetrics={activeMetrics}
              showHeatmap={showHeatmap}
              inventoryListings={inventoryListings}
              showInventoryOverlay={showInventoryOverlay}
              onSelectCell={setSelectedCellId}
              onActiveMetricsChange={setActiveMetrics}
              onToggleHeatmap={() => setShowHeatmap((value) => !value)}
              onToggleInventoryOverlay={() => setShowInventoryOverlay((value) => !value)}
            />
          )}
        </section>

        <div className="hidden md:block">
          <NprmLocationDrawer
            selectedLocation={selectedLocation}
            fallbackLayers={layers}
            stateContext={stateContext}
            activeMetrics={activeMetrics}
            onActiveMetricsChange={setActiveMetrics}
            allCells={cells}
            inventoryListings={inventoryListings}
            showInventoryOverlay={showInventoryOverlay}
            onToggleInventoryOverlay={() => setShowInventoryOverlay((value) => !value)}
            className="h-full"
          />
        </div>
      </div>

      <footer className="hidden border-t border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-4 py-2 font-mono text-[11px] text-[var(--ds-gray-900)] md:block">
        <div>{REQUIRED_DISCLAIMER}</div>
        <div className="mt-1 uppercase tracking-[0.14em] text-[10px] text-[var(--ds-gray-900)]">
          Developed by Land Republic
        </div>
      </footer>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden">
        <div
          className={`pointer-events-auto w-full overflow-hidden rounded-t-xl border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/95 shadow-2xl backdrop-blur transition-transform duration-300 ${mobileBriefTransformClass}`}
        >
          <button
            type="button"
            onClick={handleMobileBriefTap}
            className="w-full border-b border-[var(--ds-gray-alpha-200)] px-4 pb-2 pt-2 text-left"
          >
            <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-[var(--ds-gray-alpha-400)]" />
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ds-gray-1000)]">
              <span>{selectedLocation ? `${selectedLocation.state} brief` : "Property brief"}</span>
              {mobileBriefState === "expanded" ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className={`h-4 w-4 ${mobileBriefState === "collapsed" ? "animate-bounce" : ""}`} />
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">
              {mobileBriefPrompt}
              {selectedLocation ? ` | Risk ${selectedLocation.composite_risk_score}/100` : ""}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ds-gray-900)]">
              Developed by Land Republic
            </div>
          </button>

          <div className="h-[min(76vh,calc(100vh-8rem))] bg-[var(--ds-background-100)]">
            <NprmLocationDrawer
              selectedLocation={selectedLocation}
              fallbackLayers={layers}
              stateContext={stateContext}
              activeMetrics={activeMetrics}
              onActiveMetricsChange={setActiveMetrics}
              allCells={cells}
              inventoryListings={inventoryListings}
              showInventoryOverlay={showInventoryOverlay}
              onToggleInventoryOverlay={() => setShowInventoryOverlay((value) => !value)}
              className="h-full border-0"
              alwaysScrollable
            />
          </div>
        </div>
      </div>
    </main>
  );
}
