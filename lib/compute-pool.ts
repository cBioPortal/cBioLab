// CPU-heavy statistics (lib/compute-kernels.ts) run on worker threads, never on the thread that
// serves requests. A model fit can take seconds of pure computation; on that thread it would stall
// every other request the process is serving — on Vercel, every request sharing the instance —
// for as long as it runs. Measured: the gallery's risk model held the event loop for 9.8 s.
//
// A fixed pool, started on first use and kept for the life of the process: COMPUTE_WORKERS
// workers (default: one fewer than the CPUs, at least 1, at most 4). Jobs queue for the next free
// worker. A worker that dies fails its job and is replaced. COMPUTE_WORKERS=0 runs every kernel
// on the calling thread instead, as before.
//
// Workers are unref'd while idle, so a script whose work is done exits without closing the pool.
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import type { Kernels, KernelName } from "./compute-kernels.ts";

type Job = { id: number; name: KernelName; args: unknown[]; resolve: (v: unknown) => void; reject: (e: Error) => void };
interface Slot { worker: Worker; job: Job | null }

const configured = process.env.COMPUTE_WORKERS;
const SIZE = configured != null && configured !== "" ? Math.max(0, Math.floor(Number(configured)) || 0)
  : Math.max(1, Math.min(4, availableParallelism() - 1));

const slots: Slot[] = [];
const queue: Job[] = [];
let nextId = 1;

function spawn(): Slot {
  const worker = new Worker(new URL("./compute-worker.ts", import.meta.url));
  const slot: Slot = { worker, job: null };
  worker.unref();
  worker.on("message", (m: { id: number; value?: unknown; error?: { name: string; message: string } }) => {
    const job = slot.job;
    if (!job || job.id !== m.id) return;
    slot.job = null;
    worker.unref();
    if (m.error) { const e = new Error(m.error.message); e.name = m.error.name; job.reject(e); }
    else job.resolve(m.value);
    pump();
  });
  // an uncaught error or an exit ends the worker: its job fails, and a fresh worker takes its place
  const lost = (why: Error) => {
    const i = slots.indexOf(slot);
    if (i < 0) return;
    slots.splice(i, 1);
    if (slot.job) slot.job.reject(why);
    slot.job = null;
    pump();
  };
  worker.on("error", (e) => lost(e instanceof Error ? e : new Error(String(e))));
  worker.on("exit", (code) => lost(new Error("a compute worker exited (code " + code + ") during a computation")));
  slots.push(slot);
  return slot;
}

function pump(): void {
  while (queue.length) {
    const slot = slots.find((s) => !s.job) || (slots.length < SIZE ? spawn() : null);
    if (!slot) return;
    const job = queue.shift()!;
    slot.job = job;
    slot.worker.ref();
    try { slot.worker.postMessage({ id: job.id, name: job.name, args: job.args }); }
    catch (e) { slot.job = null; slot.worker.unref(); job.reject(e as Error); }
  }
}

/** Run kernel `name` on a worker thread; resolves to exactly what the kernel returns, or rejects with its error's name and message. */
export async function compute<K extends KernelName>(name: K, ...args: Parameters<Kernels[K]>): Promise<ReturnType<Kernels[K]>> {
  if (SIZE === 0) {
    const { KERNELS } = await import("./compute-kernels.ts");
    return (KERNELS[name] as (...a: unknown[]) => ReturnType<Kernels[K]>)(...args);
  }
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, name, args, resolve: resolve as (v: unknown) => void, reject });
    pump();
  });
}
