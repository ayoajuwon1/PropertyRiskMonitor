import { NextResponse } from "next/server";
import {
  getLayerMetadata,
  getLocationCellById,
  getNewsMetadata,
  getSecurityMetadata,
  getSecurityStateAggregates,
  getSourceVersions,
} from "@/lib/data-store";
import { canonicalStateName } from "@/lib/news";

function keyState(value: string): string {
  return canonicalStateName(value)
    .toLowerCase()
    .replace(/\bstate\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const cell = await getLocationCellById(id);

  if (!cell) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  const [layers, versions, newsMetadata, securityMetadata, securityAggregates] = await Promise.all([
    getLayerMetadata(),
    getSourceVersions(),
    getNewsMetadata(),
    getSecurityMetadata(),
    getSecurityStateAggregates(),
  ]);

  const securityAggregate = securityAggregates.find((entry) => keyState(entry.state) === keyState(cell.state));

  const coreLayers = layers.map((layer) => {
    if (layer.layer_name === "security") {
      return {
        ...layer,
        source_name: securityMetadata.source_name,
        source_url: securityMetadata.source_url,
        update_frequency: "quarterly" as const,
        source_stamp: securityMetadata.publish_source_stamp,
        source_checked_at: securityMetadata.last_ingest_refresh,
        source_mix: securityMetadata.source_mix,
        layer_confidence_score: securityMetadata.national_confidence_score,
        ingest_last_refresh: securityMetadata.last_ingest_refresh,
        publish_last_refresh: securityMetadata.last_publish_refresh,
        coverage_quality:
          securityMetadata.national_confidence_score >= 75
            ? ("high" as const)
            : securityMetadata.national_confidence_score >= 58
              ? ("medium" as const)
              : ("low" as const),
        coverage_notes: securityMetadata.coverage_notes,
      };
    }

    const version = versions[layer.layer_name];
    return {
      ...layer,
      source_stamp: version?.source_stamp,
      source_checked_at: version?.checked_at,
    };
  });
  const layersWithVersion = [
    ...coreLayers,
    {
      layer_name: "news",
      display_name: "News Signals",
      customer_use_case:
        "Tracks state-level good real-estate news, local market updates, and dispute indicators for due diligence.",
      source_name: newsMetadata.source_name,
      source_url: newsMetadata.source_url,
      update_frequency: newsMetadata.update_frequency,
      last_refresh: newsMetadata.last_refresh,
      coverage_notes: newsMetadata.coverage_notes,
      source_stamp: newsMetadata.source_stamp,
      source_checked_at: newsMetadata.last_refresh,
    },
  ];

  return NextResponse.json(
    {
      ...cell,
      security_details: {
        event_count_90d: securityAggregate?.security_event_count_90d ?? cell.security_event_count_90d ?? 0,
        top_threat: securityAggregate?.security_top_threat ?? cell.security_top_threat ?? null,
        top_threats: securityAggregate?.top_threats ?? [],
        confidence_score: securityAggregate?.security_confidence_score ?? cell.security_confidence_score ?? 0,
        last_ingest_refresh: securityMetadata.last_ingest_refresh ?? null,
        last_publish_refresh: securityMetadata.last_publish_refresh ?? null,
        ingest_source_stamp: securityMetadata.ingest_source_stamp ?? null,
        publish_source_stamp: securityMetadata.publish_source_stamp ?? null,
        source_mix: securityMetadata.source_mix ?? [],
      },
      layers: layersWithVersion,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    }
  );
}
