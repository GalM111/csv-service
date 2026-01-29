import fs from "fs/promises";
import type { HydratedDocument } from "mongoose";
import { Job, JobDoc, JobError } from "../models/Job";
import { broadcast, broadcastAndClose } from "./sse.service";
import { CsvProgress, processFile } from "./csv.service";

type JobHydrated = HydratedDocument<JobDoc>;

function getErrors(job: JobHydrated): JobError[] {
    const value = job.get("errors");
    return Array.isArray(value) ? (value as JobError[]) : [];
}

function setErrors(job: JobHydrated, errors: JobError[]) {
    job.set("errors", errors);
}

export async function createPendingJob(filename: string) {
    return Job.create({
        filename,
        status: "pending",
        totalRows: 0,
        processedRows: 0,
        successCount: 0,
        failedCount: 0,
        errors: [],
    });
}

function toProgress(job: JobHydrated) {
    const errors = getErrors(job);

    return {
        jobId: job._id.toString(),
        filename: job.filename,
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        successCount: job.successCount,
        failedCount: job.failedCount,
        errorCount: errors.length,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        lastError: job.lastError,
        createdAt: job.createdAt,
    };
}

async function persistProgress(job: JobHydrated, progress: CsvProgress) {
    job.totalRows = progress.totalRows;
    job.processedRows = progress.processedRows;
    job.successCount = progress.successCount;
    job.failedCount = progress.failedCount;
    setErrors(job, progress.errors);
    job.lastError = progress.lastError;
    await job.save();
    broadcast(job._id.toString(), "progress", toProgress(job));
}

export async function processCsvJob(jobId: string, filePath: string) {
    const job = (await Job.findById(jobId)) as JobHydrated | null;
    if (!job) {
        await safeDelete(filePath);
        return;
    }

    job.status = "processing";
    job.startedAt = new Date();
    job.completedAt = undefined;
    job.lastError = undefined;
    await job.save();
    broadcast(jobId, "progress", toProgress(job));

    try {
        const result = await processFile({
            jobId,
            filePath,
            onProgress: async (progress) => persistProgress(job, progress),
        });

        job.status = "completed";
        job.completedAt = new Date();
        await persistProgress(job, result);
        broadcastAndClose(jobId, "done", { jobId, status: "completed" });
    } catch (err: any) {
        job.status = "failed";
        job.completedAt = new Date();
        job.lastError = err?.message ?? "job failed unexpectedly";
        await job.save();
        broadcast(jobId, "progress", toProgress(job));
        broadcastAndClose(jobId, "done", { jobId, status: "failed" });
        throw err;
    } finally {
        await safeDelete(filePath);
    }
}

async function safeDelete(filePath: string) {
    try {
        await fs.unlink(filePath);
    } catch {
    }
}

type ErrorReport = {
    filename: string;
    csv: string;
    errorCount: number;
};

const ERROR_REPORT_HEADER = ["rowNumber", "name", "email", "phone", "company", "error"] as const;

export async function buildJobErrorReport(jobId: string): Promise<ErrorReport | null> {
    const job = await Job.findById(jobId).lean<JobDoc>();
    if (!job) return null;

    const rows = (job.errors ?? []).map((err) => formatErrorRow(err));
    const csvLines = [ERROR_REPORT_HEADER, ...rows].map((cols) => cols.map(escapeCsv).join(","));
    const safeBase = sanitizeFilename(job.filename || "job");
    const filename = `${safeBase}_errors.csv`;

    return {
        filename,
        csv: csvLines.join("\n"),
        errorCount: rows.length,
    };
}

function formatErrorRow(error: JobError): string[] {
    const row = (error.row ?? {}) as Record<string, unknown>;
    return [
        String(error.rowNumber ?? ""),
        valueOrEmpty(row.name),
        valueOrEmpty(row.email),
        valueOrEmpty(row.phone),
        valueOrEmpty(row.company),
        error.message ?? "",
    ];
}

function valueOrEmpty(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function escapeCsv(value: string) {
    if (value === undefined || value === null) return "";
    if (value.includes('"') || value.includes(",") || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

function sanitizeFilename(filename: string) {
    const base = filename.replace(/\.[^.]+$/, "");
    const safe = base.replace(/[^\w.-]+/g, "_");
    return safe || "job";
}
