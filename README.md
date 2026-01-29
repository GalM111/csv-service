# CSV Processing Service

An Express + TypeScript API for importing customer CSVs into MongoDB. Uploads arrive through Multer, are validated row-by-row with Zod, and are processed by an in-memory FIFO queue so clients receive a `jobId` immediately while a single worker handles imports and streams progress via SSE.

## Features
- CSV-only upload endpoint with disk buffering, 10 MB limit, and sanitized filenames.
- In-memory FIFO job queue + dedicated worker to guarantee sequential processing and controlled concurrency.
- Streaming CSV importer that counts rows, validates/normalizes fields, enforces unique emails, and records each failed row with full data.
- Job tracking REST endpoints plus `/api/jobs/:id/stream` SSE feed reporting status (`pending | processing | completed | failed`), row counts, timestamps, and errors.
- Downloadable CSV error report (`rowNumber,name,email,phone,company,error`) per job.
- MongoDB models for `Job` metadata and ingested `Customer` records.
- Health-check endpoint and centralized error middleware/logging.

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
   ```env
   PORT=4000
   MONGO_URI=mongodb://127.0.0.1:27017/csv_import
   ```
   `PORT` defaults to `3000` if omitted.
3. **Run the service**
   - Development: `npm run dev`
   - Production: `npm run build && npm start`
4. **Test** using the provided `sample_customers.csv`.

`src/server.ts` connects to Mongo, starts the queue worker, and boots the Express app defined in `src/app.ts`.

## Directory Overview
- `src/routes/jobs.routes.ts` – Multer config + `/api/jobs` routes (upload, list, SSE, error report).
- `src/controllers/jobs.controller.ts` – Upload handler, SSE streaming, job CRUD, CSV error downloads.
- `src/services/jobs.service.ts` – Job lifecycle management, Mongo updates, SSE broadcasting, error report builder.
- `src/services/csv.service.ts` – Streaming parser, validation, and per-row persistence.
- `src/queue/` – In-memory queue class and singleton worker wiring.
- `src/services/sse.service.ts` – SSE client registry + helpers.
- `src/models/{Job,Customer}.ts` – Mongoose schemas.
- `uploads/` – Temp file storage (auto-created).

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/jobs/upload` | Upload CSV via `multipart/form-data` (`file`). Returns `{ jobId }` immediately; rejects missing or non-CSV files. |
| `GET`  | `/api/jobs/:id` | Fetch a job’s latest status, counts, errors, timestamps. Validates `:id`. |
| `GET`  | `/api/jobs/:id/stream` | Server-Sent Events stream emitting `progress` updates and a final `done` event. |
| `GET`  | `/api/jobs/:id/error-report` | Download CSV of failed rows with columns `rowNumber,name,email,phone,company,error`. |
| `GET`  | `/api/jobs` | List jobs newest-first. |
| `GET`  | `/health` | Returns `{ ok: true }`. |

### Job Document Snapshot
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
      "row": { "name": "Alex", "email": "alex@example.com", "company": "Acme", "phone": "" }
    }
  ],
  "startedAt": "2026-01-29T18:12:31.012Z",
  "completedAt": null,
  "createdAt": "2026-01-29T18:10:02.447Z"
}
```

### Typical Flow
1. Client uploads CSV via `POST /api/jobs/upload`.
2. Service stores the file under `uploads/`, creates a `Job` with `pending` status, and enqueues `{ jobId, filePath }`.
3. The singleton worker dequeues jobs sequentially, parses rows, inserts customers, updates Mongo progress, and broadcasts SSE events.
4. Clients can:
   - Listen to `/api/jobs/:id/stream` for live updates.
   - Poll `/api/jobs/:id` or list jobs.
   - Download `/api/jobs/:id/error-report` once processing reaches a terminal state.

## Validation Rules
- `name` / `company`: required non-empty strings.
- `email`: required, lowercase normalized, valid format, unique across customers.
- `phone`: optional string (empty treated as absent).
- Any validation or insert failure records `rowNumber`, `message`, and the normalized row.

## Testing Tips
- Use a REST client (Insomnia/Postman/etc.) with `multipart/form-data`.
- Watch server logs for Mongo connection + queue activity.
- Purge large `uploads/` folders if storage becomes an issue; processed files are removed automatically.

## Future Enhancements
- Persist the queue in Redis/BullMQ for crash recovery and horizontal scaling.
- Support retrying failed jobs or reprocessing selected rows.
- Add authentication/RBAC for multi-tenant deployments.
