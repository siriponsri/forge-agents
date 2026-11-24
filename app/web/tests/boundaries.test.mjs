import test from "node:test";
import assert from "node:assert/strict";
import { assertDurableSnapshot, boundedSheetEdit } from "../src/api.mjs";
test("bounded edits reject whole columns, oversized rectangles, inverted and mismatched ranges", () => {
  for (const range of ["A:A", "A1:XFD9999", "C3:A1", "XFE1", "A0", "A1:B2"])
    assert.throws(() => boundedSheetEdit(range, "one"));
  assert.deepEqual(boundedSheetEdit("a1:b2", "1\tไทย\n=SUM(A1)\t").values, [
    ["1", "ไทย"],
    [{ f: "=SUM(A1)" }, ""],
  ]);
});
test("native snapshots preserve full resources and reject temporary browser URLs", () => {
  const snapshot = {
    id: "test",
    resources: [{ name: "plugin", data: "opaque" }],
    body: { dataStream: "ไทย\r\n" },
  };
  assert.equal(assertDurableSnapshot(snapshot), snapshot);
  for (const url of [
    "blob:http://localhost/id",
    "file:///C:/a.png",
    "filesystem:http://localhost/a",
  ])
    assert.throws(() => assertDurableSnapshot({ asset: url }));
});
