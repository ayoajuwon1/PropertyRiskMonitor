import { NextResponse } from "next/server";
import { getLayerMetadata, getNewsMetadata, getSecurityMetadata, getSourceVersions } from "@/lib/data-store";

export async function GET() {
  const [layers, versions, newsMetadata, securityMetadata] = await Promise.all([
    getLayerMetadata(),
    getSourceVersions(),
    getNewsMetadata(),
    getSecurityMetadata(),
  ]);

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

  const payload = [
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

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
