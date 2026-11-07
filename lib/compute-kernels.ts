// The statistics heavy enough to stall a request thread, by name: what lib/compute-pool.ts runs in
// its workers. Each is pure and takes and returns only what structured clone carries (plain
// objects, arrays, typed arrays, Sets, Maps), so a worker computes exactly what the caller would.
import { coxnetEnsemble, concordanceBootstrap, coxFit } from "./coxnet.ts";
import { grayPermutationTest, preRankedGsea } from "./stats.ts";
import { adjustedFit } from "./views/adjusted/fit.ts";
import { fitPredictiveGene } from "./views/predictive/fit.ts";

export const KERNELS = { coxnetEnsemble, concordanceBootstrap, coxFit, grayPermutationTest, preRankedGsea, adjustedFit, fitPredictiveGene };
export type Kernels = typeof KERNELS;
export type KernelName = keyof Kernels;
