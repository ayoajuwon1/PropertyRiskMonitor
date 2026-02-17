# Nigeria Property Risk Monitor (NPRM)

NPRM is a public, model-based geospatial platform that helps buyers, renters, and real-estate teams compare property risk signals across Nigeria.

This platform is a decision-support model, not an official hazard authority.

## Current Layer Set

- Flood Exposure (JRC + SRTM, quarterly source stamp)
- Road Access (OpenStreetMap roads, weekly source stamp)
- Neighborhood Activity (NASA VIIRS night lights, monthly source stamp)
- Rainfall Pressure (CHIRPS-style anomaly proxy, monthly source stamp)
- Population Pressure (WorldPop-style density proxy, quarterly source stamp)
- Security Pressure (ACLED-style incident pressure proxy, weekly source stamp)
- News Signals (Google News RSS + Wikipedia context, weekly source stamp)

## Why updates stay consistent

- Every job is deterministic for a given `source_stamp`.
- Scores are recomputed from source stamp + location id (not cumulative drift from previous values).
- If source stamp is unchanged, the job skips processing.

## Stack

- Next.js App Router
- React + Tailwind CSS
- MapLibre via `react-map-gl`
- JSON artifact store (starter phase)
- GitHub Actions nightly refresh runner

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create local env:

```bash
cp .env.example .env.local
```

3. Run app:

```bash
npm run dev
```

4. Open:

- `http://localhost:3000`

## API (read-only)

- `GET /api/map-data`
- `GET /api/location/:id`
- `GET /api/layers`
- `GET /api/state-context/:state`

## Jobs

- `npm run job:flood`
- `npm run job:infra`
- `npm run job:nightlight`
- `npm run job:rainfall`
- `npm run job:population`
- `npm run job:security`
- `npm run job:news`
- `npm run job:core`
- `npm run job:all`

## Automation

- `refresh-layers-nightly.yml`: runs core layer jobs nightly and commits only when source stamps change.
- `refresh-news-weekly.yml`: runs news ingestion weekly and commits only when the source week changes.

## Disclaimer (required UI text)

"This platform provides model-based estimates using publicly available geospatial datasets. It is not an official hazard authority and should not replace professional due diligence."
