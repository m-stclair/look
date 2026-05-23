import assert from "node:assert/strict";
import test from "node:test";
import { compareSplitFromClientX, clientNearCompareSplit } from "../src/compare-split.js";

test("compareSplitFromClientX clamps pointer positions to the preview rect", () => {
  const rect = {left: 10, top: 20, width: 200, height: 100};
  assert.equal(compareSplitFromClientX(10, rect), 0);
  assert.equal(compareSplitFromClientX(110, rect), 0.5);
  assert.equal(compareSplitFromClientX(260, rect), 1);
  assert.equal(compareSplitFromClientX(-30, rect), 0);
});

test("clientNearCompareSplit only catches enabled in-rect split drags", () => {
  const rect = {left: 10, top: 20, width: 200, height: 100};
  assert.equal(clientNearCompareSplit({clientX: 111, clientY: 50, rect, split: 0.5, enabled: true}), true);
  assert.equal(clientNearCompareSplit({clientX: 90, clientY: 50, rect, split: 0.5, enabled: true}), false);
  assert.equal(clientNearCompareSplit({clientX: 111, clientY: 10, rect, split: 0.5, enabled: true}), false);
  assert.equal(clientNearCompareSplit({clientX: 111, clientY: 50, rect, split: 0.5, enabled: false}), false);
});
