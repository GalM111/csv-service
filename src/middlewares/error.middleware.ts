import { NextFunction, Request, Response } from "express";

export function errorMiddleware(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
) {
    console.error("Error:", err);

    if (err instanceof Error) {
        return res.status(500).json({ message: err.message });
    }
    return res.status(500).json({ message: "Internal Server Error" });
}
