import fs from "fs";
import csv from "csv-parser";
import { Job } from "../models/Job";
import { Customer } from "../models/Customer";
import { customerRowSchema } from "../utils/validators";

export async function processCsvJob(jobId: string, filePath: string) {
    await Job.findByIdAndUpdate(jobId, { status: "processing" });

    let totalRows = 0;
    let processedRows = 0;
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // First pass (optional): count rows to show totalRows accurately.
    // If you want simplest approach, skip this and keep totalRows=0 until done.
    totalRows = await countRows(filePath);
    await Job.findByIdAndUpdate(jobId, { totalRows });

    const stream = fs.createReadStream(filePath).pipe(csv());

    const persistProgress = async () => {
        await Job.findByIdAndUpdate(jobId, {
            processedRows,
            successCount,
            failedCount,
            errors
        });
    };

    try {
        for await (const raw of stream as any as AsyncIterable<Record<string, string>>) {
            processedRows++;

            const parsed = customerRowSchema.safeParse({
                name: raw.name,
                email: raw.email,
                phone: raw.phone ?? "",
                company: raw.company
            });

            if (!parsed.success) {
                failedCount++;
                errors.push(`Row ${processedRows}: ${parsed.error.issues.map(i => i.message).join(", ")}`);
            } else {
                // uniqueness: rely on Mongo unique index (and catch duplicate)
                try {
                    await Customer.create({ ...parsed.data, jobId });
                    successCount++;
                } catch (e: any) {
                    failedCount++;
                    // duplicate key error from Mongo/Mongoose
                    const msg = e?.code === 11000 ? "email already exists" : "db insert failed";
                    errors.push(`Row ${processedRows}: ${msg}`);
                }
            }

            // throttle DB writes a bit
            if (processedRows % 25 === 0) await persistProgress();
        }

        await persistProgress();
        await Job.findByIdAndUpdate(jobId, {
            status: "completed",
            completedAt: new Date()
        });
    } catch (err: any) {
        errors.push(`Fatal: ${err?.message ?? "unknown error"}`);
        await Job.findByIdAndUpdate(jobId, {
            status: "failed",
            errors,
            completedAt: new Date()
        });
    } finally {
        // optional: cleanup uploaded file after processing
        // fs.unlink(filePath, () => {});
    }
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
