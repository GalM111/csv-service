import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { Job, JobDoc } from "../models/Job";
import { runJobInBackground } from "../services/csvJob.service";
import { addClient, removeClient, sendEvent } from "../services/sse.service";

export async function uploadCsv(req: Request, res: Response) {
    if (!req.file) {
        return res.status(400).json({ message: "CSV file is required (field name: file)" });
    }

    const job = await Job.create({
        filename: req.file.originalname,
        status: "pending",
        totalRows: 0,
        processedRows: 0,
        successCount: 0,
        failedCount: 0,
        errors: [],
    });

    // Return immediately (don’t await processing)
    res.status(201).json({ jobId: job._id.toString() });

    // Process in background
    runJobInBackground(job._id.toString(), req.file.path);
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


function toProgressPayload(jobId: string, job: JobDoc | null) {
    if (!job) return null;
    const errorsLength = Array.isArray(job.errors) ? job.errors.length : 0;
    return {
        jobId,
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        successCount: job.successCount,
        failedCount: job.failedCount,
        errorCount: errorsLength,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
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
