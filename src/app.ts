import express from "express";
import cors from "cors";
import morgan from "morgan";
import { jobsRouter } from "./routes/jobs.routes";
import { errorMiddleware } from "./middlewares/error.middleware";

export function createApp() {
    const app = express();

    app.use(cors());
    app.use(morgan("dev"));
    app.use(express.json());

    app.use("/api/jobs", jobsRouter);

    app.get("/health", (_req, res) => res.json({ ok: true }));

    app.use(errorMiddleware);
    return app;
}

export const app = createApp();
export default app;
