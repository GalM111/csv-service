import { app } from "./app";
import { connectDb as connectDB } from "./config/db";
import { jobQueue } from "./queue/queue";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await connectDB();
        jobQueue.start();
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

