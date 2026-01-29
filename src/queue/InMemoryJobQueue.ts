export type QueueJob = {
    jobId: string;
    filePath: string;
};

type Worker = (job: QueueJob) => Promise<void>;

export class InMemoryJobQueue {
    private readonly queue: QueueJob[] = [];
    private running = false;
    private started = false;

    constructor(private readonly worker: Worker) {}

    start() {
        if (this.started) return;
        this.started = true;
        void this.process();
    }

    stop() {
        this.started = false;
    }

    enqueue(job: QueueJob) {
        this.queue.push(job);
        if (this.started) {
            void this.process();
        }
    }

    size() {
        return this.queue.length;
    }

    private async process() {
        if (!this.started || this.running) return;
        this.running = true;

        try {
            while (this.started && this.queue.length > 0) {
                const job = this.queue.shift()!;
                try {
                    await this.worker(job);
                } catch (err) {
                    console.error("Queue worker failed", { jobId: job.jobId, err });
                }
            }
        } finally {
            this.running = false;
            if (this.started && this.queue.length > 0) {
                setImmediate(() => void this.process());
            }
        }
    }
}
