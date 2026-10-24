// The germline view's per-gene counting, on fixed inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { germAdd } from "../lib/views/germline/run.ts";

const blank = () => ({ sequenced: 0, carriers: 0, outsidePanel: 0, carrierSomatic: 0, carrierCnaProfiled: 0, carrierDeletion: 0, carrierEither: 0,
  noncarriers: 0, noncarrierSomatic: 0, noncarrierCnaProfiled: 0, noncarrierDeletion: 0, noncarrierEither: 0 });

test("carriers and non-carriers split, second hits counted once, deletions only where copy number was profiled", () => {
  const c = blank();
  germAdd(c, { mp: 1, carrier: 1, som: 1, cp: 1, del: 1, n: 2 });
  germAdd(c, { mp: 1, carrier: 1, som: 0, cp: 0, del: 0, n: 3 });
  germAdd(c, { mp: 1, carrier: 0, som: 0, cp: 1, del: 1, n: 4 });
  germAdd(c, { mp: 1, carrier: 0, som: 0, cp: 0, del: 0, n: 10 });
  assert.deepEqual([c.sequenced, c.carriers, c.carrierSomatic, c.carrierCnaProfiled, c.carrierDeletion, c.carrierEither], [19, 5, 2, 2, 2, 2]);
  assert.deepEqual([c.noncarriers, c.noncarrierEither, c.noncarrierDeletion, c.noncarrierCnaProfiled], [14, 4, 4, 4]);
});

test("a carrier whose panel omits the gene is counted apart, never as sequenced", () => {
  const c = blank();
  germAdd(c, { mp: 0, carrier: 1, som: 0, cp: 0, del: 0, n: 2 });
  germAdd(c, { mp: 0, carrier: 0, som: 0, cp: 0, del: 0, n: 7 });
  assert.equal(c.outsidePanel, 2);
  assert.equal(c.sequenced, 0);
});
