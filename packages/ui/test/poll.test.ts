import { expect, spyOn, test } from "bun:test";
import { poll } from "../src/poll.js";

test("polling reports a rejected read and continues without an unhandled rejection", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const nextRead = Promise.withResolvers<void>();
  const failure = new Error("read failed");
  let reads = 0;
  const stop = poll(async () => {
    if (++reads === 1) throw failure;
    nextRead.resolve();
  }, 5);
  try {
    await nextRead.promise;
    stop();
    expect(logged).toHaveBeenCalledWith("Polling read failed.", failure);
    await Bun.sleep(25);
    expect(reads).toBe(2);
  } finally {
    stop();
    logged.mockRestore();
  }
});

test("polling lets a slow read finish and stops scheduling after disposal", async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const reachedSecond = Promise.withResolvers<void>();
  let reads = 0;
  const stop = poll(async () => {
    reads++;
    if (reads === 1) await first.promise;
    else {
      reachedSecond.resolve();
      await second.promise;
    }
  }, 5);
  try {
    await Bun.sleep(25);
    expect(reads).toBe(1);
    first.resolve();
    await reachedSecond.promise;
    expect(reads).toBe(2);
    stop();
    second.resolve();
    await Bun.sleep(25);
    expect(reads).toBe(2);
  } finally {
    stop();
    first.resolve();
    second.resolve();
  }
});
