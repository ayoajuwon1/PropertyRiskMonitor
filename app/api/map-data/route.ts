import { NextResponse } from "next/server";
import { getLocationCells } from "@/lib/data-store";
import type { MapDataResponse } from "@/lib/types";

export async function GET() {
  const cells = await getLocationCells();
  const payload: MapDataResponse[] = cells.map((cell) => ({
    id: cell.id,
    state: cell.state,
    lga: cell.lga,
    lat: cell.lat,
    lng: cell.lng,
    flood_score: cell.flood_score,
    infra_score: cell.infra_score,
    nightlight_score: cell.nightlight_score,
    rainfall_score: cell.rainfall_score,
    population_score: cell.population_score,
    security_score: cell.security_score,
    composite_risk_score: cell.composite_risk_score,
  }));

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}
