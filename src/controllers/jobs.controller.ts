import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { Job, JobDoc } from "../models/Job";
import { buildJobErrorReport, createPendingJob } from "../services/jobs.service";
import { jobQueue } from "../queue/queue";
import { addClient, removeClient, sendEvent } from "../services/sse.service";

export async function uploadCsv(req: Request, res: Response) {
    if (!req.file) {
        return res.status(400).json({ message: "CSV file is required (field name: file)" });
    }

    if (!req.file.path) {
        return res.status(500).json({ message: "Uploaded file path missing" });
    }

    const job = await createPendingJob(req.file.originalname);

    jobQueue.enqueue({ jobId: job._id.toString(), filePath: req.file.path });

    // Return immediately (don’t await processing)
    res.status(201).json({ jobId: job._id.toString() });
}

export async function getJob(req: Request, res: Response) {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id || !Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid job id" });

    const job = await Job.findById(id).lean();
    if (!job) return res.status(404).json({ message: "Job not found" });

    res.json(job);
}

export async function listJobs(_req: Request, res: Response) {
    const jobs = await Job.find().sort({ createdAt: -1 }).lean();
    res.json(jobs);
}

export async function downloadErrorReport(req: Request, res: Response) {
    const rawId = req.params.id;
    const jobId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!jobId || !Types.ObjectId.isValid(jobId)) {
        return res.status(400).json({ message: "Invalid job id" });
    }

    const report = await buildJobErrorReport(jobId);
    if (!report) {
        return res.status(404).json({ message: "Job not found" });
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    res.send(report.csv);
}


function toProgressPayload(jobId: string, job: JobDoc | null) {
    if (!job) return null;
    const errorsLength = Array.isArray(job.errors) ? job.errors.length : 0;
    return {
        jobId,
        filename: job.filename,
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        successCount: job.successCount,
        failedCount: job.failedCount,
        errorCount: errorsLength,
        startedAt: job.startedAt,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        lastError: job.lastError,
    };
}

function isTerminal(status: string | undefined | null) {
    return status === "completed" || status === "failed";
}

export async function streamJob(req: Request, res: Response, next: NextFunction) {
    try {
        const rawId = req.params.id;
        const jobId = Array.isArray(rawId) ? rawId[0] : rawId;

        if (!jobId || !Types.ObjectId.isValid(jobId)) {
            return res.status(400).json({ message: "Invalid job id" });
        }

        // SSE headers
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // helpful for nginx
        (req.socket as any).setTimeout?.(0);

        // Reconnect hint for EventSource (ms)
        res.write("retry: 2000\n\n");
        res.flushHeaders?.();

        // Initial state
        const job = await Job.findById(jobId).lean();
        if (!job) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: "job not found" })}\n\n`);
            return res.end();
        }

        const payload = toProgressPayload(jobId, job);
        if (payload) {
            sendEvent(res, "progress", payload);
        }

        // If job already finished, send done + close immediately
        if (isTerminal(job.status)) {
            sendEvent(res, "done", { jobId, status: job.status });
            return res.end();
        }

        // Register client for ongoing updates
        addClient(jobId, res);

        // Keep-alive ping
        const ping = setInterval(() => {
            res.write(`: ping\n\n`);
        }, 15000);

        // Cleanup
        req.on("close", () => {
            clearInterval(ping);
            removeClient(jobId, res);
            res.end();
        });
    } catch (err) {
        next(err);
    }
}
