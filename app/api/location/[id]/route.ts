import { NextResponse } from "next/server";
import { getLayerMetadata, getLocationCellById, getNewsMetadata, getSourceVersions } from "@/lib/data-store";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const cell = await getLocationCellById(id);

  if (!cell) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  const [layers, versions, newsMetadata] = await Promise.all([
    getLayerMetadata(),
    getSourceVersions(),
    getNewsMetadata(),
  ]);

  const coreLayers = layers.map((layer) => {
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
      layers: layersWithVersion,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    }
  );
}
