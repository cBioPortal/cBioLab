// One worker of lib/compute-pool.ts: runs a named kernel (lib/compute-kernels.ts) and posts back
// its answer, or its error's name and message.
import { parentPort } from "node:worker_threads";
import { KERNELS, type KernelName } from "./compute-kernels.ts";

parentPort!.on("message", (m: { id: number; name: KernelName; args: unknown[] }) => {
  try {
    const value = (KERNELS[m.name] as (...a: unknown[]) => unknown)(...m.args);
    parentPort!.postMessage({ id: m.id, value });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: { name: (e as Error)?.name || "Error", message: String((e as Error)?.message ?? e) } });
  }
});
