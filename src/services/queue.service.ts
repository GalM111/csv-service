type JobTask = { jobId: string; filePath: string };

class InMemoryQueue {
    private q: JobTask[] = [];
    private running = false;

    enqueue(task: JobTask) {
        this.q.push(task);
        void this.run();
    }

    private async run() {
        if (this.running) return;
        this.running = true;

        while (this.q.length) {
            const task = this.q.shift()!;
            try {
                const { processCsvJob } = await import("./csvJob.service");
                await processCsvJob(task.jobId, task.filePath);
            } catch (err) {
                // csvJob.service will mark job failed; this is a last-resort catch
                console.error("Worker error:", err);
            }
        }

        this.running = false;
    }
}

export const jobQueue = new InMemoryQueue();
