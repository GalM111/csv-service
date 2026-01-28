# CSV Processing Service

An Express + TypeScript API for importing large customer CSVs into MongoDB. Files are uploaded via Multer, validated row-by-row with Zod, and inserted asynchronously so clients receive a `jobId` immediately and can poll for progress.

## Features
- CSV-only upload endpoint with disk buffering, 10 MB limit, and safe filenames.
- Background importer that counts rows up-front, validates fields, enforces unique emails, and stores detailed error logs.
- Job tracking API that exposes status (`pending | processing | completed | failed`), processed row counts, and timestamps.
- MongoDB models for both `Job` metadata and ingested `Customer` records.
- Health-check endpoint plus centralized error middleware/logging.

## Tech Stack
- Node.js 20+, TypeScript, Express 5
- MongoDB via Mongoose
- Multer for multipart uploads
- csv-parser stream processing + Zod validation
- Morgan + CORS middleware

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment**
   - Copy `.env` (or create one) with:
     ```
     PORT=4000
     MONGO_URI=mongodb://127.0.0.1:27017/csv_import
     ```
   - `PORT` defaults to `3000` if omitted; `MONGO_URI` must point to a reachable MongoDB instance.
3. **Run the service**
   - Development (ts-node-dev): `npm run dev`
   - Production build: `npm run build && npm start`
4. **Optional**: use the provided `sample_customers.csv` to test uploads.

The server starts via `src/server.ts`, which connects to Mongo (`connectDb`) and bootstraps the Express app defined in `src/app.ts`.

## Directory Overview
- `src/routes/jobs.routes.ts` – Multer setup and `/api/jobs` routes.
- `src/controllers/jobs.controller.ts` – Upload handler + CRUD endpoints.
- `src/services/csvJob.service.ts` – Streaming processor, validation, and progress tracking.
- `src/models/{Job,Customer}.ts` – Mongoose schemas.
- `uploads/` – Temporary storage for incoming CSVs (auto-created).

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/jobs/upload` | Upload a CSV (`multipart/form-data`, field name `file`). Returns `{ jobId }` immediately while the file is processed in the background. Rejects non-CSV files and responds `400` if `file` is missing. |
| `GET`  | `/api/jobs/:id` | Fetch a single job’s latest status, counts, errors, `createdAt`, and optional `completedAt`. Validates that `:id` is a Mongo ObjectId. |
| `GET`  | `/api/jobs` | List jobs newest-first for dashboard/polling experiences. |
| `GET`  | `/health` | Lightweight readiness probe returning `{ ok: true }`. |

### Job Document Shape
```jsonc
{
  "_id": "67b0035d2f5c34b2d1370c90",
  "filename": "customers.csv",
  "status": "processing",
  "totalRows": 250,
  "processedRows": 120,
  "successCount": 118,
  "failedCount": 2,
  "errors": [
    {
      "rowNumber": 42,
      "message": "email must be unique",
      "row": { "email": "alex@example.com", "company": "Acme", "...": "..." }
    }
  ],
  "createdAt": "2026-01-28T21:55:31.012Z",
  "completedAt": null
}
```

### Typical Flow
1. Client uploads CSV via `POST /api/jobs/upload`.
2. Service stores the file under `uploads/` and creates a `Job` with `pending` status.
3. Background worker (`runJobInBackground`) parses the file, validates each row, writes `Customer` entries, and periodically saves progress.
4. Client polls `GET /api/jobs/:id` (or lists jobs) until `status` is `completed` or `failed`.

## Validation Rules
- `name` / `company`: required non-empty strings.
- `email`: required, normalized to lowercase, must be a valid format and unique across all customers.
- `phone`: optional string (empty string is ignored).
- Any validation or insert error adds an entry to `job.errors` with the failing row number and message.

## Testing Tips
- Use a REST client (Insomnia, Postman, VS Code Thunder Client) with `multipart/form-data`.
- Monitor terminal logs for `MongoDB connected` and importer progress logs.
- Clean up stale uploads if needed; the service automatically deletes processed files.

## Future Enhancements
- Persist background jobs to a queue (BullMQ, RabbitMQ) for horizontal scaling.
- Stream job progress via WebSockets or Server-Sent Events instead of polling.
- Export failure reports as downloadable CSV/JSON.

