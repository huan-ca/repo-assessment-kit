import { describe, expect, it } from "vitest";
import {
  coverageLabels,
  coverageSummarySentence,
  launcherName,
  providerName,
  shortId,
  stateLabels,
  statusTone,
} from "./model.js";
import { fixtureData } from "./fixtures.js";

describe("plain-language UI mappings", () => {
  it("maps every coverage state without collapsing partial and blocked", () => {
    expect(coverageLabels).toEqual({
      pass: "Pass",
      fail: "Fail",
      partial: "Partly tested",
      blocked: "Blocked",
      "not applicable": "Not applicable",
      "not tested": "Not tested",
    });
  });

  it("keeps operational states in calm language", () => {
    expect(stateLabels.RECOVERABLE_FAILURE).toBe("Action is needed to continue");
    expect(stateLabels.CANCELLING).toBe("Stopping and cleaning up");
    expect(stateLabels.CANCELLED).toBe("Stopped");
  });

  it("binds provider help to the launcher", () => {
    expect(providerName("codex")).toBe("Codex");
    expect(providerName("claude-code")).toBe("Claude Code");
    expect(launcherName("codex")).toBe("start-codex.sh");
    expect(launcherName("claude-code")).toBe("start-cc.sh");
  });

  it("shortens identifiers without relabeling them", () => {
    expect(shortId("snp_6c388b8272b6d3673f")).toBe("snp_6c388b82…d3673f");
    expect(shortId("short")).toBe("short");
  });

  it("uses shape-and-word tones rather than color-only state", () => {
    expect(statusTone("pass")).toBe("positive");
    expect(statusTone("blocked")).toBe("caution");
    expect(statusTone("FAILED")).toBe("danger");
    expect(statusTone("PENDING")).toBe("neutral");
  });

  it("accounts for every required area in the coverage headline", () => {
    expect(coverageSummarySentence(fixtureData.run.coverageSummary)).toBe(
      "All 15 required assessment areas are accounted for. 7 passed, 0 failed, 2 were partly tested, 2 were blocked, 1 was not applicable, and 3 were not tested.",
    );
  });
});
