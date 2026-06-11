import assert from "node:assert/strict";
import test from "node:test";
import { DatasetHolder } from "../src/dataset-holder.js";

test("offline holder serves bundled data and skips the network", async () => {
  const logs = [];
  const holder = new DatasetHolder({ offline: true, log: (message) => logs.push(message) });

  // Bundled dataset loads synchronously in the constructor.
  assert.ok(holder.get().codes.length > 0);

  // refresh() must be a no-op when offline (and must never throw).
  const changed = await holder.refresh();
  assert.equal(changed, false);

  // start() must not schedule a timer when offline.
  holder.start();
  assert.equal(holder.timer, null);
  holder.stop();
});
