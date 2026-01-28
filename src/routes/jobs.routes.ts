import { Router } from "express";
import multer from "multer";
import path from "path";
import { ensureUploadsDir } from "../services/csvJob.service";
import { uploadCsv, getJob, listJobs } from "../controllers/jobs.controller";

const uploadDir = ensureUploadsDir();

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
        cb(null, `${Date.now()}_${safe}`);
    },
});

function csvOnly(
    req: Express.Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".csv") return cb(new Error("Only .csv files are allowed"));
    cb(null, true);
}

const upload = multer({
    storage,
    fileFilter: csvOnly,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

export const jobsRouter = Router();

// Required by assignment :contentReference[oaicite:6]{index=6}
jobsRouter.post("/upload", upload.single("file"), uploadCsv);
jobsRouter.get("/:id", getJob);
jobsRouter.get("/", listJobs);
