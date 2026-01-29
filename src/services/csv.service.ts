import fs from "fs";
import csv from "csv-parser";
import { Customer } from "../models/Customer";
import type { JobError } from "../models/Job";
import { customerRowSchema } from "../utils/validators";

export type CsvProgress = {
    totalRows: number;
    processedRows: number;
    successCount: number;
    failedCount: number;
    errors: JobError[];
    lastError?: string;
};

export type ProcessFileOptions = {
    jobId: string;
    filePath: string;
    progressEvery?: number;
    maxErrors?: number;
    onProgress?: (progress: CsvProgress) => Promise<void> | void;
};

const DEFAULT_PROGRESS_EVERY = 25;
const DEFAULT_MAX_ERRORS = 50;

function normalizeRow(raw: Record<string, unknown>) {
    return {
        name: String(raw?.name ?? "").trim(),
        email: String(raw?.email ?? "").trim().toLowerCase(),
        phone: String(raw?.phone ?? "").trim(),
        company: String(raw?.company ?? "").trim(),
    };
}

async function countRows(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        let count = 0;
        fs.createReadStream(filePath)
            .pipe(csv())
            .on("data", () => count++)
            .on("end", () => resolve(count))
            .on("error", reject);
    });
}

export async function processFile(options: ProcessFileOptions): Promise<CsvProgress> {
    const totalRows = await countRows(options.filePath);
    const progress: CsvProgress = {
        totalRows,
        processedRows: 0,
        successCount: 0,
        failedCount: 0,
        errors: [],
    };

    const progressEvery = options.progressEvery ?? DEFAULT_PROGRESS_EVERY;
    const maxErrors = options.maxErrors ?? DEFAULT_MAX_ERRORS;

    const emitProgress = async (force = false) => {
        if (!options.onProgress) return;
        if (!force && progress.processedRows % progressEvery !== 0) return;
        await options.onProgress({
            ...progress,
            errors: [...progress.errors],
        });
    };

    const stream = fs.createReadStream(options.filePath).pipe(csv());
    let currentRow = 1;

    await emitProgress(true);
    try {
        for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
            // Explicit pause/resume to ensure sequential async work
            stream.pause?.();
            const parsed = customerRowSchema.safeParse(normalizeRow(raw));

            if (!parsed.success) {
                progress.failedCount += 1;
                progress.processedRows += 1;
                const message = parsed.error.issues.map((i) => i.message).join(", ");
                progress.lastError = message;
                if (progress.errors.length < maxErrors) {
                    progress.errors.push({
                        rowNumber: currentRow,
                        message,
                        row: raw as Record<string, unknown>,
                    });
                }
                currentRow += 1;
                await emitProgress();
                stream.resume?.();
                continue;
            }

            try {
                await Customer.create({
                    ...parsed.data,
                    phone: parsed.data.phone || undefined,
                    jobId: options.jobId,
                });
                progress.successCount += 1;
            } catch (err: any) {
                progress.failedCount += 1;
                const message = err?.code === 11000 ? "email must be unique" : "failed to insert customer";
                progress.lastError = message;
                if (progress.errors.length < maxErrors) {
                    progress.errors.push({
                        rowNumber: currentRow,
                        message,
                        row: parsed.data,
                    });
                }
            }

            progress.processedRows += 1;
            currentRow += 1;
            await emitProgress();
            stream.resume?.();
        }

        await emitProgress(true);
        return progress;
    } catch (err) {
        progress.lastError = err instanceof Error ? err.message : "unknown error";
        await emitProgress(true);
        throw err;
    }
}
