import type { Response } from "express";

const clientsByJobId = new Map<string, Set<Response>>();

function writeSafe(res: Response, chunk: string) {
    try {
        res.write(chunk);
        return true;
    } catch {
        return false;
    }
}

export function addClient(jobId: string, res: Response) {
    const set = clientsByJobId.get(jobId) ?? new Set<Response>();
    set.add(res);
    clientsByJobId.set(jobId, set);
}

export function removeClient(jobId: string, res: Response) {
    const set = clientsByJobId.get(jobId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) clientsByJobId.delete(jobId);
}

export function sendEvent(res: Response, event: string, data: unknown) {
    writeSafe(res, `event: ${event}\n`);
    writeSafe(res, `data: ${JSON.stringify(data)}\n\n`);
}

export function broadcast(jobId: string, event: string, data: unknown) {
    const set = clientsByJobId.get(jobId);
    if (!set) return;

    for (const res of set) {
        const ok = writeSafe(res, `event: ${event}\n`);
        if (!ok) continue;
        writeSafe(res, `data: ${JSON.stringify(data)}\n\n`);
    }
}

export function broadcastAndClose(jobId: string, event: string, data: unknown) {
    const set = clientsByJobId.get(jobId);
    if (!set) return;

    for (const res of set) {
        sendEvent(res, event, data);
        try {
            res.end();
        } catch { }
    }

    clientsByJobId.delete(jobId);
}
