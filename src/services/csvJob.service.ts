import fs from "fs";
import path from "path";
import readline from "readline";
import csv from "csv-parser";
import { z } from "zod";
import type { HydratedDocument } from "mongoose";
import { Job } from "../models/Job";
import type { JobDoc, JobError } from "../models/Job";
import { Customer } from "../models/Customer";

type JobDocument = Omit<HydratedDocument<JobDoc>, "errors"> & { errors: JobError[] };

// CSV row validation (matches assignment rules)
const rowSchema = z.object({
    name: z.string().trim().min(1, "name is required"),
    email: z.string().trim().email("invalid email"),
    phone: z.string().trim().optional().or(z.literal("")),
    company: z.string().trim().min(1, "company is required"),
});

function normalizeRow(raw: any) {
    // csv-parser returns keys from header row
    return {
        name: String(raw.name ?? "").trim(),
        email: String(raw.email ?? "").trim().toLowerCase(),
        phone: String(raw.phone ?? "").trim(),
        company: String(raw.company ?? "").trim(),
    };
}

async function countDataRows(filePath: string): Promise<number> {
    // Fast streaming line count; subtract 1 header line if present.
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
    });

    let lines = 0;
    for await (const _line of rl) lines++;

    // If file is empty: lines=0, rows=0. If only header: lines=1, rows=0
    return Math.max(0, lines - 1);
}

// Update progress every N rows so we don’t spam Mongo with writes
const PROGRESS_FLUSH_EVERY = 50;

export async function processCsvJob(jobId: string, filePath: string) {
    const job = (await Job.findById(jobId)) as JobDocument | null;
    if (!job) return;

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

        let rowNumber = 1; // data row number (excluding header)
        let bufferedErrors = 0;

        // Stream with explicit pause/resume so DB work doesn't overload memory
        const stream = fs.createReadStream(filePath).pipe(csv());

        await new Promise<void>((resolve, reject) => {
            stream.on("data", async (rawRow) => {
                stream.pause();
                try {
                    const row = normalizeRow(rawRow);

                    const parsed = rowSchema.safeParse(row);
                    if (!parsed.success) {
                        job.failedCount += 1;
                        job.processedRows += 1;
                        bufferedErrors += 1;

                        job.errors.push({
                            rowNumber,
                            message: parsed.error.issues.map((i) => i.message).join(", "),
                            row,
                        });

                        rowNumber += 1;
                        if (job.processedRows % PROGRESS_FLUSH_EVERY === 0) await job.save();
                        stream.resume();
                        return;
                    }

                    // Try insert. Unique email is enforced by Mongo unique index.
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
                        bufferedErrors += 1;

                        // Handle duplicate email (E11000)
                        const msg =
                            typeof e?.message === "string" && e.message.includes("E11000")
                                ? "email must be unique"
                                : "failed to insert customer";

                        job.errors.push({ rowNumber, message: msg, row });
                    }

                    job.processedRows += 1;
                    rowNumber += 1;

                    if (job.processedRows % PROGRESS_FLUSH_EVERY === 0) await job.save();
                    stream.resume();
                } catch (err) {
                    stream.resume();
                    reject(err);
                }
            });

            stream.on("error", reject);

            stream.on("end", async () => {
                try {
                    job.status = "completed";
                    job.completedAt = new Date();
                    await job.save();

                    // Cleanup uploaded file
                    fs.unlink(filePath, () => { });
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });
    } catch (err) {
        job.status = "failed";
        job.completedAt = new Date();
        job.errors.push({ rowNumber: 0, message: "job failed unexpectedly" });
        await job.save();

        fs.unlink(filePath, () => { });
        throw err;
    }
}

/**
 * Ensures “return jobId immediately, process after response is sent” :contentReference[oaicite:4]{index=4}
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
