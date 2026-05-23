import assert from "node:assert/strict";
import test from "node:test";
import { hsv2Rgb, lookTintFromHueDegrees } from "../src/color-utils.js";

test("hsv2Rgb matches Vandal tint conversion for default Look hue", () => {
  const tint = hsv2Rgb(68 / 360, 1, 1);
  assert.ok(Math.abs(tint[0] - 0.8666666666666667) < 1e-12);
  assert.equal(tint[1], 1);
  assert.equal(tint[2], 0);
});

test("lookTintFromHueDegrees accepts degrees", () => {
  assert.deepEqual(lookTintFromHueDegrees(0), [1, 0, 0]);
  assert.deepEqual(lookTintFromHueDegrees(120), [0, 1, 0]);
  assert.deepEqual(lookTintFromHueDegrees(240), [0, 0, 1]);
});
