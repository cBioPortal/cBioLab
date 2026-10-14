// Explore's natural order for values that have one (lib/ordinal.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { naturalOrder, ordinalKey } from "../lib/ordinal.ts";

const order = (xs: string[]) => naturalOrder(xs, (x) => x);

test("stage groups read in stage order, missing values last", () => {
  assert.deepEqual(order(["4", "1A", "4A", "2A", "1", "Unknown", "3B", "0", "1B"]), ["0", "1", "1A", "1B", "2A", "3B", "4", "4A", "Unknown"]);
  assert.deepEqual(order(["Stage 4", "Stage 1-3", "Unknown"]), ["Stage 1-3", "Stage 4", "Unknown"]);
  assert.deepEqual(order(["Stage IV", "Stage IIA", "Stage I", "Stage IIIC"]), ["Stage I", "Stage IIA", "Stage IIIC", "Stage IV"]);
});

test("a registry's odd codes go after the stages, the stages still in order", () => {
  const msk = ["4", "1A", "4A", "4B", "2A", "2B", "3B", "1B", "3A", "1", "3", "1A2", "3C", "2", "1A3", "0", "1A1", "4C", "2C", "Occu", "9", "OC"];
  assert.deepEqual(order(msk), ["0", "1", "1A", "1A1", "1A2", "1A3", "1B", "2", "2A", "2B", "2C", "3", "3A", "3B", "3C", "4", "4A", "4B", "4C", "9", "Occu", "OC"]);
});

test("grades, Gleason scores and TNM categories", () => {
  assert.deepEqual(order(["9", "7", "8", "6", "10"]), ["6", "7", "8", "9", "10"]);
  assert.deepEqual(order(["T3", "T1a", "T2", "Tis", "TX"]), ["Tis", "T1a", "T2", "T3", "TX"]);
  assert.deepEqual(order(["G3", "G1", "G2"]), ["G1", "G2", "G3"]);
  assert.deepEqual(ordinalKey("Grade 2"), [2, ""]);
});

test("anything that is not a position keeps its given (count) order", () => {
  assert.deepEqual(order(["Lung", "Breast", "Colon"]), ["Lung", "Breast", "Colon"]);
  assert.deepEqual(order(["Stage 4", "Lung"]), ["Stage 4", "Lung"]);
  assert.deepEqual(order(["Lung", "Breast", "Colon", "Stage 4", "Stage 1", "Stage 2"]), ["Lung", "Breast", "Colon", "Stage 4", "Stage 1", "Stage 2"]);
  assert.deepEqual(order(["Yes", "No"]), ["Yes", "No"]);
  assert.deepEqual(order(["4", "Unknown"]), ["4", "Unknown"]);
});
