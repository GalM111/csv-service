import { InMemoryJobQueue } from "./InMemoryJobQueue";
import { processCsvJob } from "../services/jobs.service";

export const jobQueue = new InMemoryJobQueue(async ({ jobId, filePath }) => {
    await processCsvJob(jobId, filePath);
});
