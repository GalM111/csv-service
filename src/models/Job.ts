import { Schema, model, Types } from "mongoose";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export type JobError = {
    rowNumber: number;
    message: string;
    // Optional extra context (handy for debugging / bonus error report later)
    row?: Record<string, unknown>;
};

export interface JobDoc {
    _id: Types.ObjectId;
    filename: string;
    status: JobStatus;
    totalRows: number;
    processedRows: number;
    successCount: number;
    failedCount: number;
    errors: JobError[];
    createdAt: Date;
    completedAt?: Date;
}

const JobSchema = new Schema<JobDoc>(
    {
        filename: { type: String, required: true },
        status: {
            type: String,
            enum: ["pending", "processing", "completed", "failed"],
            default: "pending",
            required: true,
        },
        totalRows: { type: Number, default: 0 },
        processedRows: { type: Number, default: 0 },
        successCount: { type: Number, default: 0 },
        failedCount: { type: Number, default: 0 },
        errors: [
            {
                rowNumber: { type: Number, required: true },
                message: { type: String, required: true },
                row: { type: Schema.Types.Mixed, required: false },
            },
        ],
        completedAt: { type: Date, required: false },
    },
    { timestamps: { createdAt: true, updatedAt: true } }
);

export const Job = model<JobDoc>("Job", JobSchema);
