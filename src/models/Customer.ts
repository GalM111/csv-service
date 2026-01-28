import { Schema, model, Types } from "mongoose";

export interface CustomerDoc {
    _id: Types.ObjectId;
    name: string;
    email: string;
    phone?: string;
    company: string;
    jobId: Types.ObjectId;
    createdAt: Date;
}

const CustomerSchema = new Schema<CustomerDoc>(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, lowercase: true, unique: true },
        phone: { type: String, required: false, trim: true },
        company: { type: String, required: true, trim: true },
        jobId: { type: Schema.Types.ObjectId, ref: "Job", required: true },
    },
    { timestamps: { createdAt: true, updatedAt: true } }
);

export const Customer = model<CustomerDoc>("Customer", CustomerSchema);
