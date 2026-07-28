import { describe, expect, it } from "vitest";
import { loopbackProxy } from "../vite.config.js";

describe("local API proxy boundary", () => {
  it("uses only the strict loopback server target without rewriting API paths", () => {
    expect(loopbackProxy).toEqual({
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/health": { target: "http://127.0.0.1:3000", changeOrigin: false },
    });
    expect(
      Object.values(loopbackProxy).every((entry) => entry.target.startsWith("http://127.0.0.1:")),
    ).toBe(true);
  });
});
