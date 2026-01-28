import { z } from "zod";

export const customerRowSchema = z.object({
    name: z.string().trim().min(1, "name is required"),
    email: z.string().trim().email("invalid email"),
    phone: z.string().optional().default(""),
    company: z.string().trim().min(1, "company is required")
});

export type CustomerRow = z.infer<typeof customerRowSchema>;
