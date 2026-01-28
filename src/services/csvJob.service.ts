import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { z } from "zod";
import type { HydratedDocument } from "mongoose";
import { Job } from "../models/Job";
import type { JobDoc, JobError } from "../models/Job";
import { Customer } from "../models/Customer";
import { broadcast, broadcastAndClose } from "./sse.service";

type JobDocument = Omit<HydratedDocument<JobDoc>, "errors"> & { errors: JobError[] };

// CSV row validation (matches assignment rules)
const rowSchema = z.object({
    name: z.string().trim().min(1, "name is required"),
    email: z.string().trim().email("invalid email"),
    phone: z.string().trim().optional().or(z.literal("")),
    company: z.string().trim().min(1, "company is required"),
});

function normalizeRow(raw: any) {
    return {
        name: String(raw?.name ?? "").trim(),
        email: String(raw?.email ?? "").trim().toLowerCase(),
        phone: String(raw?.phone ?? "").trim(),
        company: String(raw?.company ?? "").trim(),
    };
}

async function countDataRows(filePath: string): Promise<number> {
    // Accurate count based on CSV parsing (handles quoted newlines, etc.)
    return new Promise((resolve, reject) => {
        let count = 0;
        fs.createReadStream(filePath)
            .pipe(csv())
            .on("data", () => count++)
            .on("end", () => resolve(count))
            .on("error", reject);
    });
}

function progressPayload(jobId: string, job: JobDocument) {
    return {
        jobId,
        filename: job.filename,
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        successCount: job.successCount,
        failedCount: job.failedCount,
        errorCount: job.errors.length,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
    };
}

// Update progress every N rows so we don’t spam Mongo with writes
const PROGRESS_FLUSH_EVERY = 50;

export async function processCsvJob(jobId: string, filePath: string) {
    const job = (await Job.findById(jobId)) as JobDocument | null;
    if (!job) return;

    let currentRowNumber = 1;

    const safeUnlink = async () => {
        try {
            await fs.promises.unlink(filePath);
        } catch {
            // ignore
        }
    };

    try {
        // Mark processing + set totalRows
        const totalRows = await countDataRows(filePath);

        job.status = "processing";
        job.totalRows = totalRows;
        job.processedRows = 0;
        job.successCount = 0;
        job.failedCount = 0;
        job.errors = [];
        await job.save();

        broadcast(jobId, "progress", progressPayload(jobId, job));

        // Stream parse
        const stream = fs.createReadStream(filePath).pipe(csv());

        for await (const rawRow of stream as any as AsyncIterable<any>) {
            const row = normalizeRow(rawRow);
            const parsed = rowSchema.safeParse(row);

            if (!parsed.success) {
                job.failedCount += 1;
                job.processedRows += 1;

                job.errors.push({
                    rowNumber: currentRowNumber,
                    message: parsed.error.issues.map((i) => i.message).join(", "),
                    row,
                } as any);

                currentRowNumber += 1;

                if (job.processedRows % PROGRESS_FLUSH_EVERY === 0) {
                    await job.save();
                    broadcast(jobId, "progress", progressPayload(jobId, job));
                }

                continue;
            }

            // Insert customer; rely on unique email index
            try {
                await Customer.create({
                    name: parsed.data.name,
                    email: parsed.data.email,
                    phone: parsed.data.phone || undefined,
                    company: parsed.data.company,
                    jobId: job._id,
                });

                job.successCount += 1;
            } catch (e: any) {
                job.failedCount += 1;

                const msg = e?.code === 11000 ? "email must be unique" : "failed to insert customer";

                job.errors.push({
                    rowNumber: currentRowNumber,
                    message: msg,
                    row,
                } as any);
            }

            job.processedRows += 1;
            currentRowNumber += 1;

            if (job.processedRows % PROGRESS_FLUSH_EVERY === 0) {
                await job.save();
                broadcast(jobId, "progress", progressPayload(jobId, job));
            }
        }

        // Finalize
        job.status = "completed";
        job.completedAt = new Date();
        await job.save();

        broadcast(jobId, "progress", progressPayload(jobId, job));
        broadcastAndClose(jobId, "done", { jobId, status: "completed" });
    } catch (err: any) {
        job.status = "failed";
        job.completedAt = new Date();

        const msg =
            typeof err?.message === "string"
                ? `job failed unexpectedly: ${err.message}`
                : "job failed unexpectedly";

        job.errors.push({ rowNumber: 0, message: msg } as any);

        try {
            await job.save();
        } catch {
            // ignore
        }

        broadcast(jobId, "progress", progressPayload(jobId, job));
        broadcastAndClose(jobId, "done", { jobId, status: "failed" });

        throw err;
    } finally {
        await safeUnlink();
    }
}

/**
 * Ensures “return jobId immediately, process after response is sent”
 */
export function runJobInBackground(jobId: string, filePath: string) {
    setImmediate(() => {
        processCsvJob(jobId, filePath).catch((e) => {
            console.error("Background job failed:", e);
        });
    });
}

export function ensureUploadsDir() {
    const dir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}
