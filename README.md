# Space Vision Backend

Data ingestion and KPI API for the Space Vision signage dashboard. The service exposes upload endpoints for the CSV datasets provided in the interview brief, persists them in SQLite through TypeORM, and aggregates attention and entrance metrics that supply every chart rendered in the React frontend.

---

## 1. Running the project

### Local Node.js workflow

1. **Install prerequisites**
   - Node.js 20 or newer (aligned with the `node:20` Docker images used in CI).
   - npm 10 or newer (bundled with Node 20).
   - No external database is required because the repository already contains `space-vision.sqlite`.
2. **Clone and install**
   ```powershell
   npm install
   ```
3. **Optional configuration**
   - Create `.env` when overriding defaults (for example, `CORS_ALLOWED_ORIGINS=http://localhost:8080`).
4. **Start the development server**
   ```powershell
   npm run dev
   ```
   - Next.js listens on `http://localhost:3000`.
   - API routes are available under `/api/*`, so the CSV upload endpoints and the analytics endpoints can be exercised immediately.
5. **Production build**
   ```powershell
   npm run build
   npm run start
   ```
   - This compiles the Next.js App Router bundle and serves it via the same SQLite-backed APIs.

## 2. Architecture & technology rationale

- **Next.js 16 App Router**  
  Provides a file-system API surface (under `src/app/api/**`) without maintaining a separate Express application. The App Router Request/Response objects mirror the frontend runtime, minimizing serialization discrepancies.

- **TypeORM + `better-sqlite3`**  
  TypeORM enables entity-first modelling (`src/entities/*.ts`) and repository helpers, while `better-sqlite3` keeps deployment friction low: no database server process, predictable file-based storage, and deterministic local development.

- **CSV ingestion pipeline** (`src/utils/csvProcessor.ts`)  
  Uses `csv-parse/sync` to validate large files in memory, normalizes data types, and batches inserts within transactions to respect SQLite variable limits. Upload mode (`replace` versus `append`) is enforced before inserts to permit dataset resets.

- **Performance calculators** (`src/utils/performanceCalculator.ts`)  
  Encapsulate KPI calculations (attention rate, entrance rate, percentile-based grading) so both `/api/performance` and `/api/performance/group` rely on a single implementation, ensuring consistent results.

- **Custom logging layer** (`src/lib/logger/*`)  
  Adds structured logs, request tracing, and a TypeORM logger so long-running CSV jobs can be audited. Query logging is opt-in per batch, which is helpful when diagnosing slow inserts.

- **CORS middleware** (`src/middleware.ts`)  
  Ensures the frontend (often running on a different port) can reach the backend. Allowed origins default to common localhost targets but can be overridden via `CORS_ALLOWED_ORIGINS`.

- **Dataset status bookkeeping** (`src/lib/datasetStatus.ts`)  
  Every upload updates `dataset_status`, providing the UI with an immediate view of record counts and last refresh timestamps without scanning the raw tables.

**Data flow summary**

```
CSV upload → process-csv route → csvProcessor → TypeORM entities → SQLite
                               ↘ dataset_status update

/api/performance[/*] → initializeDatabase → repositories → KPI calculators → JSON
```

---

## 3. API surface & data ingestion

| Endpoint                          | Method | Purpose                                                                                                                         |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `/api/process-csv/content-perf`   | POST   | Accepts `multipart/form-data` or JSON (`fileData`) for `content_performance.csv`. Supports `mode=replace` or `mode=append`      |
| `/api/process-csv/player-history` | POST   | Same contract for `player_history.csv`.                                                                                         |
| `/api/dataset-status`             | GET    | Returns record counts and last update timestamps for the `dataset` query parameter (`content-performance` or `player-history`). |
| `/api/performance`                | GET    | Returns per-content KPIs with sorting (`sortBy`, `order`), grade filtering, and pagination (`limit`, `offset`).                 |
| `/api/performance/group`          | GET    | Aggregates KPIs by `content_group` with the same sorting/pagination story.                                                      |

Example upload (JSON fallback):

```bash
curl -X POST http://localhost:3000/api/process-csv/content-perf ^
  -H "Content-Type: application/json" ^
  -d "{ \"fileData\": \"$(Get-Content content_performance.csv | [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_)))\", \"mode\": \"replace\" }"
```

Example analytics request:

```bash
curl "http://localhost:3000/api/performance?sortBy=entrance_rate&grade=S&limit=20"
```

---

## 4. Chart descriptions & insights

- **Attention–Entrance Scatter (`AttentionEntranceScatter.tsx`)**  
  Data source: `/api/performance`. Each point represents a content item; the x-axis captures attention rate (percentage) and the y-axis captures entrance rate (percentage). Color encodes the percentile-based grade computed in `assignPerformanceGrades`. The visualization highlights creatives that capture attention yet do not translate into entrances, guiding follow-up analysis on calls to action.

- **Average Entrance Rate by Group (`EntranceRateByGroup.tsx`)**  
  Data source: `/api/performance/group`. Bars report the mean entrance rate per `content_group`. Grouping by category surfaces demographic cohorts that consistently underperform or overperform, and the descending sort order immediately reveals the extremes to media planners.

- **Performance Leaderboard (`PerformanceLeaderboard.tsx`)**  
  Tabular view backed by `/api/performance`. Users can re-sort by impressions, rates, or grades, creating an interactive ranking experience. After filtering the scatter plot, analysts can move directly into the underlying metrics for the shortlisted creatives.

- **Executive KPI Tiles (`DashboardStats.tsx`)**  
  Summary tiles computed client-side from `/api/performance`: total impressions, average attention, average entrance, and count of S/A-grade ads. These headline metrics align with the typical requirements for leadership briefings and act as guardrails when validating ingestion jobs (for example, a sudden drop in total impressions signals a failed upload).

- **CSV Upload Health Card (`CsvUploadCard.tsx`)**  
  Although not a chart, this component is tightly coupled to the backend: after each upload the card reads `/api/dataset-status`, enabling operators to confirm record counts and last refresh times without opening the database directly.

Each visualization consumes the same KPI payloads, which eliminates discrepancies. When adding new charts, prefer reusing `/api/performance` responses to keep caching straightforward (React Query already reuses those query keys).

---

## Troubleshooting

- **“SQLITE_BUSY” during uploads** – Ensure no other process is locking `space-vision.sqlite`. On Windows, closing any database viewers usually resolves the issue.
- **CORS errors** – Set `CORS_ALLOWED_ORIGINS` to the exact origin of the frontend (`http://localhost:5173`, etc.) and restart the development server.
- **Empty analytics responses** – Both datasets must be loaded because KPIs join `PlayerHistory` impressions with `ContentPerformance` flags. Use the Dataset Status API to confirm row counts.

---
