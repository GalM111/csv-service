import { Request, Response } from "express";
import { Types } from "mongoose";
import { Job } from "../models/Job";
import { runJobInBackground } from "../services/csvJob.service";

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
