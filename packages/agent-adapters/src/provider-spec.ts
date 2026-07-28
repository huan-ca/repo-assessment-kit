export const providerCliSpecs = Object.freeze({
  codex: Object.freeze({
    executable: "codex" as const,
    fixedArguments: Object.freeze([
      "exec",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--strict-config",
      "-c",
      'approval_policy="never"',
      "--json",
      "--output-schema",
      "/run/rak/schema/agent-proposal.schema.json",
      "-C",
      "/run/rak/proposal",
      "-c",
      "mcp_servers={}",
      "-c",
      "notify=[]",
      "-c",
      "project_doc_max_bytes=0",
      "-",
    ]),
    permissionMode: "read-only/never" as const,
  }),
  "claude-code": Object.freeze({
    executable: "claude" as const,
    fixedArguments: Object.freeze([
      "-p",
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "stream-json",
      "--verbose",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--tools",
      "",
    ]),
    permissionMode: "dontAsk/deny-precedence" as const,
  }),
});

export type ProviderName = keyof typeof providerCliSpecs;

export const registeredAcceptanceCheckIds = Object.freeze(["material-claims-cited"] as const);
export const registeredOutputSchemaIds = Object.freeze(["rak-agent-proposal/1.0.0"] as const);
