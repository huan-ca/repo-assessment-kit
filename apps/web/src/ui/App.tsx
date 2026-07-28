import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Download,
  FileSearch,
  KeyRound,
  Menu,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { discoveryTopics } from "@rak/contracts";
import {
  bootstrapSessionFromFragment,
  createAndUploadSecret,
  createRun,
  loadInitialData,
  runAction,
  saveApprovals,
  saveDiscovery,
  type DataMode,
} from "../api.js";
import { fixtureData } from "../fixtures.js";
import {
  coverageLabels,
  coverageSummarySentence,
  launcherName,
  providerName,
  shortId,
  stateLabels,
  statusTone,
  viewTitles,
  type AppData,
  type Approval,
  type ConsentChoice,
  type DraftClaim,
  type DraftSetup,
  type EvidenceOccurrence,
  type Finding,
  type ProductClaim,
  type View,
} from "../model.js";

const navItems: Array<{ view: View; label: string }> = [
  { view: "overview", label: "Overview" },
  { view: "capability", label: "Runtime capability" },
  { view: "coverage", label: "Coverage" },
  { view: "findings", label: "Findings" },
  { view: "evidence", label: "Supporting records" },
  { view: "decision", label: "Decision" },
  { view: "release", label: "Reviews and release" },
];

const topicContent: Record<
  DraftClaim["topic"],
  { title: string; prompt: string; unknownEffect: string }
> = {
  "target-customers": {
    title: "Target customers",
    prompt: "Who relies on this product?",
    unknownEffect: "We may not be able to weigh findings against customer impact.",
  },
  buyers: {
    title: "Buyers",
    prompt: "Who chooses or pays for the product?",
    unknownEffect: "Commercial priorities may be incomplete.",
  },
  "user-roles": {
    title: "User roles",
    prompt: "Which roles use it, and what does each need to do?",
    unknownEffect: "Role-specific behavior may remain unverified.",
  },
  "customer-pain": {
    title: "Customer pain",
    prompt: "What problem does the product solve today?",
    unknownEffect: "The recommendation may underweight the original customer problem.",
  },
  "valuable-workflows": {
    title: "Valuable workflows",
    prompt: "Which end-to-end tasks matter most?",
    unknownEffect: "Workflow coverage and business priority will be less certain.",
  },
  "alternatives-differentiators": {
    title: "Alternatives and differentiators",
    prompt: "What would customers use instead, and why do they choose this product?",
    unknownEffect: "The assessment cannot fully compare replacement tradeoffs.",
  },
  "revenue-retention-critical-behavior": {
    title: "Revenue or retention",
    prompt: "Which behavior most affects revenue or customer retention?",
    unknownEffect: "Business priority may remain unassigned.",
  },
  "contractual-obligations": {
    title: "Contractual obligations",
    prompt: "What product behavior has been promised to customers?",
    unknownEffect: "Contractual impact is not assessed and needs owner confirmation.",
  },
  "expected-scale": {
    title: "Expected scale",
    prompt: "How many users, records, or transactions should it support?",
    unknownEffect: "Scale suitability cannot be confirmed.",
  },
  "feature-parity-expectations": {
    title: "Feature-parity expectations",
    prompt: "What would a replacement have to preserve?",
    unknownEffect: "Rebuild cost and replacement risk may be understated.",
  },
};

const phaseNames: Record<string, string> = {
  discovery: "Product discovery",
  "target-snapshot": "Safe source copy",
  "static-inventory": "Repository inventory",
  "static-security-quality": "Static security and quality checks",
  "runtime-capability": "Runtime capability",
  "dynamic-assessment": "Safe live checks",
  "product-code-traceability": "Product-to-code trace",
  "decision-synthesis": "Decision synthesis",
  "independent-security-review": "Independent security review",
  "independent-decision-review": "Independent decision review",
  "deterministic-validation": "Record validation",
  "technical-human-review": "Technical human review",
  "lay-human-review": "Plain-language review",
  package: "Customer package",
};

const defaultSetup: DraftSetup = {
  projectSlug: "",
  engagementId: "",
  sourceKind: "local",
  sourceHandleId: "src_local_customer",
  relativePath: ".",
  sshUrl: "",
  ref: "",
  mode: "commit-only",
  profiles: ["general-security-baseline"],
  optionalServiceIds: [],
};

const defaultClaims = (): DraftClaim[] =>
  discoveryTopics.map((topic) => ({
    topic,
    statement: "",
    isUnknown: false,
    unknownReason: "",
    confidenceEffect: topicContent[topic].unknownEffect,
    coverageEffect: topicContent[topic].unknownEffect,
    followUp: "Product owner to confirm before the decision review.",
    provenance: "owner-stated",
    confidence: "medium",
    speakerRole: "Product owner",
    inferenceReasoning: "",
    analyticsDataset: "",
    analyticsQuery: "",
    analyticsWindowStart: "",
    analyticsWindowEnd: "",
  }));

function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
}) {
  return (
    <button className={`button button--${variant}`} type="button" {...props}>
      {children}
    </button>
  );
}

function Status({ value, label }: { value: string; label?: string }) {
  const tone = statusTone(value);
  const icon =
    tone === "positive" ? (
      <Check aria-hidden="true" />
    ) : tone === "danger" ? (
      <X aria-hidden="true" />
    ) : tone === "caution" ? (
      <AlertTriangle aria-hidden="true" />
    ) : (
      <span className="status__dot" aria-hidden="true" />
    );
  return (
    <span className={`status status--${tone}`} aria-label={`Status: ${label ?? value}`}>
      {icon}
      {label ?? value}
    </span>
  );
}

function Notice({
  title,
  children,
  tone = "info",
  alert = false,
}: {
  title: string;
  children: ReactNode;
  tone?: "info" | "success" | "caution" | "danger";
  alert?: boolean;
}) {
  return (
    <section className={`notice notice--${tone}`} role={alert ? "alert" : undefined}>
      <div className="notice__mark" aria-hidden="true">
        {tone === "success" ? <Check /> : tone === "danger" ? <X /> : <AlertTriangle />}
      </div>
      <div>
        <h2 className="notice__title">{title}</h2>
        <div className="notice__body">{children}</div>
      </div>
    </section>
  );
}

function TechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <details className="technical">
      <summary>Show technical details</summary>
      <div className="technical__body">{children}</div>
    </details>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="copy-value">
      <code>{value}</code>
      <Button variant="quiet" onClick={() => void copy()}>
        <Clipboard aria-hidden="true" /> Copy {label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied.` : ""}
      </span>
    </span>
  );
}

function ScopeStrip({ data }: { data: AppData }) {
  const run = data.run.run;
  return (
    <dl className="scope-strip" aria-label="Assessment scope">
      <div>
        <dt>Project</dt>
        <dd>{run.projectSlug}</dd>
      </div>
      <div>
        <dt>Revision</dt>
        <dd>{run.revision}</dd>
      </div>
      <div>
        <dt>Provider</dt>
        <dd>{providerName(run.provider)}</dd>
      </div>
      <div>
        <dt>State</dt>
        <dd>{stateLabels[run.state]}</dd>
      </div>
      {run.targetSnapshotId ? (
        <div>
          <dt>Snapshot ID</dt>
          <dd title={run.targetSnapshotId}>{shortId(run.targetSnapshotId)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Welcome({ data, navigate }: { data: AppData; navigate: (view: View) => void }) {
  const provider = providerName(data.system.launcherProvider);
  return (
    <div className="hero-layout">
      <section className="hero">
        <p className="eyebrow">Local repository assessment workspace</p>
        <h1 tabIndex={-1}>{viewTitles.welcome}</h1>
        <p className="hero__lede">
          Define what matters, preserve what is unknown, and compare modernization choices using
          supporting records—not a score.
        </p>
        <div className="button-row">
          <Button onClick={() => navigate("new")}>
            Start assessment <ChevronRight aria-hidden="true" />
          </Button>
          <Button variant="secondary" onClick={() => navigate("assessments")}>
            View assessments
          </Button>
        </div>
      </section>
      <aside className="fieldnote" aria-labelledby="before-title">
        <p className="fieldnote__number">Before you begin</p>
        <h2 id="before-title">Know the boundary</h2>
        <ul className="checklist">
          <li>Running with {provider}; the launcher decides the provider.</li>
          <li>The web interface is available only on this computer through loopback.</li>
          <li>The source is assessed through an immutable safe copy.</li>
          <li>Live checks run only when bounded isolation can be established.</li>
        </ul>
        <p className="muted">
          Provider processing is not the same as source staying on this computer.
        </p>
      </aside>
    </div>
  );
}

function Readiness({ data }: { data: AppData }) {
  const provider = providerName(data.system.launcherProvider);
  const signIn = data.system.prerequisites.find((item) =>
    item.capabilityId.includes("authentication"),
  );
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Before source access</p>
        <h1 tabIndex={-1}>{viewTitles.readiness}</h1>
        <p>
          Running with {provider} on {data.system.hostOs} {data.system.hostArch}. These checks do
          not assess a repository.
        </p>
      </header>
      {signIn?.effective !== "available" ? (
        <Notice title={`${provider} sign-in is needed`} tone="caution" alert>
          <p>{signIn?.reason ?? "The launcher did not confirm provider authentication."}</p>
          <p>
            Close this page, run <code>{launcherName(data.system.launcherProvider)} login</code>,
            then start the kit again. Provider homes remain separate by engagement.
          </p>
        </Notice>
      ) : (
        <Notice title={`${provider} launcher is ready`} tone="success">
          <p>
            Authentication is handled by the matching launcher. This interface never asks for a
            provider password or token.
          </p>
        </Notice>
      )}
      <section className="section">
        <h2>Prerequisites</h2>
        <div className="card-list">
          {data.system.prerequisites.map((item) => (
            <article className="card" key={item.capabilityId}>
              <div className="card__heading">
                <h3>{humanize(item.capabilityId)}</h3>
                <Status value={item.effective} label={humanize(item.effective)} />
              </div>
              <p>{item.reason}</p>
              {item.coverageEffects.length > 0 ? (
                <ul>
                  {item.coverageEffects.map((effect) => (
                    <li key={effect}>{effect}</li>
                  ))}
                </ul>
              ) : null}
              <TechnicalDetails>
                <dl className="definition-grid">
                  <div>
                    <dt>Support</dt>
                    <dd>{item.support}</dd>
                  </div>
                  <div>
                    <dt>Attestation</dt>
                    <dd>{item.attestation}</dd>
                  </div>
                  <div>
                    <dt>Approval</dt>
                    <dd>{item.approval}</dd>
                  </div>
                  <div>
                    <dt>Checked</dt>
                    <dd>{formatDate(item.checkedAt)}</dd>
                  </div>
                </dl>
              </TechnicalDetails>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function Assessments({ data, navigate }: { data: AppData; navigate: (view: View) => void }) {
  if (!data.runAvailable) {
    return (
      <>
        <header className="page-heading page-heading--action">
          <div>
            <p className="eyebrow">Local records</p>
            <h1 tabIndex={-1}>{viewTitles.assessments}</h1>
            <p>No assessment has been created in this local workspace.</p>
          </div>
          <Button onClick={() => navigate("new")}>Start assessment</Button>
        </header>
        <div className="empty-note">
          <FileSearch aria-hidden="true" />
          <div>
            <h2>No assessments yet</h2>
            <p>
              System readiness and registered source handles are available. Create a setup draft to
              begin; no sample run is shown as live data.
            </p>
          </div>
        </div>
      </>
    );
  }
  const run = data.run.run;
  return (
    <>
      <header className="page-heading page-heading--action">
        <div>
          <p className="eyebrow">Local records</p>
          <h1 tabIndex={-1}>{viewTitles.assessments}</h1>
          <p>Runs remain readable after they stop. No result here is a repository safety score.</p>
        </div>
        <Button onClick={() => navigate("new")}>Start assessment</Button>
      </header>
      <article className="run-card">
        <div>
          <p className="eyebrow">Revision {run.revision}</p>
          <h2>{run.projectSlug}</h2>
          <p>Updated {formatDate(run.updatedAt)}</p>
        </div>
        <Status value={run.state} label={stateLabels[run.state]} />
        <dl>
          <div>
            <dt>Provider</dt>
            <dd>{providerName(run.provider)}</dd>
          </div>
          <div>
            <dt>Snapshot ID</dt>
            <dd>{run.targetSnapshotId ? shortId(run.targetSnapshotId) : "Not prepared"}</dd>
          </div>
        </dl>
        <Button variant="secondary" onClick={() => navigate("overview")}>
          Open assessment
        </Button>
      </article>
      <div className="empty-note">
        <FileSearch aria-hidden="true" />
        <div>
          <h2>No other assessments</h2>
          <p>A completed zero-result list is different from a loading or error state.</p>
        </div>
      </div>
    </>
  );
}

function NewSetup({
  data,
  mode,
  setup,
  setSetup,
  onCreated,
  navigate,
}: {
  data: AppData;
  mode: DataMode;
  setup: DraftSetup;
  setSetup: (setup: DraftSetup) => void;
  onCreated: (run: AppData["run"]["run"]) => void;
  navigate: (view: View) => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(setup.projectSlug) || !setup.engagementId) {
      setError("Enter a lowercase project slug and engagement ID.");
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setError("");
    if (mode === "preview") {
      navigate("discovery");
      return;
    }
    setSaving(true);
    try {
      const run = await createRun(setup, data.system.launcherProvider);
      onCreated(run);
      navigate("discovery");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The setup draft could not be created.");
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Prepare · Step 1 of 4</p>
        <h1 tabIndex={-1}>{viewTitles.new}</h1>
        <p>
          These choices stay only in this browser tab until a draft is created. They are not stored
          in local storage.
        </p>
      </header>
      {error ? (
        <div className="error-summary" ref={summaryRef} tabIndex={-1} role="alert">
          <h2>Check the setup</h2>
          <p>{error}</p>
        </div>
      ) : null}
      <form className="form-stack" onSubmit={submit}>
        <fieldset>
          <legend>Project and provider</legend>
          <label className="field">
            <span>Project slug</span>
            <span className="hint">Lowercase letters, numbers, and hyphens.</span>
            <input
              value={setup.projectSlug}
              onChange={(event) => setSetup({ ...setup, projectSlug: event.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Engagement ID</span>
            <span className="hint">The local engagement boundary for provider state.</span>
            <input
              value={setup.engagementId}
              onChange={(event) => setSetup({ ...setup, engagementId: event.target.value })}
              autoComplete="off"
            />
          </label>
          <div className="fixed-choice">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>Running with {providerName(data.system.launcherProvider)}</strong>
              <p>
                Provider choice is made by the launcher. To compare with the other provider, leave
                this app and start its launcher.
              </p>
            </div>
          </div>
          <Notice title="Provider data boundary" tone="caution">
            <p>
              The selected provider may receive bounded, redacted repository context for inference.
              Provider processing is not the same as source staying on this computer.
            </p>
          </Notice>
        </fieldset>
        <fieldset>
          <legend>Source</legend>
          <p className="hint">
            Only registered handles appear. Arbitrary host paths are not accepted.
          </p>
          <div className="choice-grid">
            <label className="radio-card">
              <input
                type="radio"
                name="source-kind"
                checked={setup.sourceKind === "local"}
                onChange={() => setSetup({ ...setup, sourceKind: "local" })}
              />
              <span>
                <strong>Registered local source</strong>
                <small>Use a repository beneath an approved local root.</small>
              </span>
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="source-kind"
                checked={setup.sourceKind === "ssh-git"}
                onChange={() => setSetup({ ...setup, sourceKind: "ssh-git" })}
              />
              <span>
                <strong>SSH Git</strong>
                <small>Use a registered, read-only SSH handle.</small>
              </span>
            </label>
          </div>
          <label className="field">
            <span>Registered handle</span>
            <select
              value={setup.sourceHandleId}
              onChange={(event) => setSetup({ ...setup, sourceHandleId: event.target.value })}
            >
              {data.sourceHandles
                .filter((item) => item.kind === (setup.sourceKind === "local" ? "local" : "ssh"))
                .map((item) => (
                  <option key={item.sourceHandleId} value={item.sourceHandleId}>
                    {item.displayName}
                  </option>
                ))}
            </select>
          </label>
          {setup.sourceKind === "local" ? (
            <>
              <label className="field">
                <span>Relative path</span>
                <input
                  value={setup.relativePath}
                  onChange={(e) => setSetup({ ...setup, relativePath: e.target.value })}
                />
              </label>
              <div className="choice-grid">
                <label className="radio-card">
                  <input
                    type="radio"
                    name="source-mode"
                    checked={setup.mode === "commit-only"}
                    onChange={() => setSetup({ ...setup, mode: "commit-only" })}
                  />
                  <span>
                    <strong>Commit only</strong>
                    <small>Safe default. Changed and untracked files are excluded.</small>
                  </span>
                </label>
                <label className="radio-card">
                  <input
                    type="radio"
                    name="source-mode"
                    checked={setup.mode === "frozen-working-tree"}
                    onChange={() => setSetup({ ...setup, mode: "frozen-working-tree" })}
                  />
                  <span>
                    <strong>Frozen working tree</strong>
                    <small>
                      Includes changed and untracked files in a deterministic copy. Separate
                      approval is required.
                    </small>
                  </span>
                </label>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span>SSH Git URL</span>
                <input
                  value={setup.sshUrl}
                  onChange={(e) => setSetup({ ...setup, sshUrl: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Ref (optional)</span>
                <input
                  value={setup.ref}
                  onChange={(e) => setSetup({ ...setup, ref: e.target.value })}
                />
              </label>
            </>
          )}
        </fieldset>
        <fieldset>
          <legend>Profiles and optional services</legend>
          <label className="check-row">
            <input type="checkbox" checked readOnly />
            <span>
              <strong>General security baseline</strong>
              <small>Technical coverage, not certification or proof of security.</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={setup.profiles.includes("owasp-asvs-5-l1")}
              onChange={(event) =>
                setSetup({
                  ...setup,
                  profiles: event.target.checked
                    ? [...setup.profiles, "owasp-asvs-5-l1"]
                    : setup.profiles.filter((item) => item !== "owasp-asvs-5-l1"),
                })
              }
            />
            <span>
              <strong>OWASP ASVS 5.0 Level 1 technical profile</strong>
              <small>Applicability is not assessed. Selection does not claim compliance.</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={setup.optionalServiceIds.includes("hosted-code-scan")}
              onChange={(event) =>
                setSetup({
                  ...setup,
                  optionalServiceIds: event.target.checked ? ["hosted-code-scan"] : [],
                })
              }
            />
            <span>
              <strong>Consider optional hosted scanner</strong>
              <small>
                Off by default. Exact consent is requested later; no upload happens from this
                choice.
              </small>
            </span>
          </label>
        </fieldset>
        <aside className="review-card">
          <h2>Draft request summary</h2>
          <p>
            Create a setup draft for <strong>{setup.projectSlug || "unnamed project"}</strong> using{" "}
            {providerName(data.system.launcherProvider)} and a{" "}
            {setup.sourceKind === "local" ? "registered local source" : "registered SSH source"}.
          </p>
          <p className="muted">
            No assessment starts at this step. Source preparation happens only after discovery and
            consent.
          </p>
        </aside>
        <div className="button-row">
          <button className="button button--primary" type="submit" disabled={saving}>
            {saving ? "Creating setup draft…" : "Continue to product context"}{" "}
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </form>
    </>
  );
}

function Discovery({
  claims,
  setClaims,
  run,
  mode,
  onSaved,
  navigate,
}: {
  claims: DraftClaim[];
  setClaims: (claims: DraftClaim[]) => void;
  run: AppData["run"]["run"];
  mode: DataMode;
  onSaved: (rowVersion: number) => void;
  navigate: (view: View) => void;
}) {
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const claim = claims[index];
  if (!claim) return null;
  const content = topicContent[claim.topic];
  const update = (patch: Partial<DraftClaim>) => {
    setClaims(
      claims.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };
  const next = async () => {
    if (
      (!claim.isUnknown && !claim.statement.trim()) ||
      (claim.isUnknown && !claim.unknownReason.trim())
    ) {
      setError(
        claim.isUnknown
          ? "Explain briefly why this is not known yet."
          : "Enter an answer or mark this topic as unknown.",
      );
      return;
    }
    if (
      !claim.isUnknown &&
      claim.provenance === "code-inferred" &&
      !claim.inferenceReasoning.trim()
    ) {
      setError("Explain the reasoning behind a code-inferred claim.");
      return;
    }
    if (
      !claim.isUnknown &&
      claim.provenance === "analytics-supported" &&
      (!claim.analyticsDataset ||
        !claim.analyticsQuery ||
        !claim.analyticsWindowStart ||
        !claim.analyticsWindowEnd)
    ) {
      setError("Analytics-supported claims require a dataset, query, and exact time window.");
      return;
    }
    setError("");
    if (index !== claims.length - 1) {
      setIndex(index + 1);
      return;
    }
    if (mode === "preview") {
      navigate("consent");
      return;
    }
    try {
      const response = await saveDiscovery(
        run,
        claims.map((item, claimIndex) => toProductClaim(item, run.runId, claimIndex)),
      );
      onSaved(response.rowVersion);
      navigate("consent");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Product context could not be saved.");
    }
  };
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">
          Prepare · Product context · {index + 1} of {claims.length}
        </p>
        <h1 tabIndex={-1}>{content.title}</h1>
        <p>{content.prompt}</p>
      </header>
      <ol className="step-dots" aria-label="Product context progress">
        {claims.map((item, dotIndex) => (
          <li key={item.topic} aria-current={dotIndex === index ? "step" : undefined}>
            <button
              onClick={() => setIndex(dotIndex)}
              aria-label={`${dotIndex + 1}. ${topicContent[item.topic].title}`}
            >
              {dotIndex + 1}
            </button>
          </li>
        ))}
      </ol>
      {error ? (
        <div className="error-summary" role="alert">
          <h2>Answer needed</h2>
          <p>{error}</p>
        </div>
      ) : null}
      <section className="question-sheet">
        <label className="field">
          <span>Your answer</span>
          <span className="hint">
            Record owner knowledge in plain language. Code inference does not replace it.
          </span>
          <textarea
            rows={6}
            value={claim.statement}
            disabled={claim.isUnknown}
            onChange={(event) => update({ statement: event.target.value })}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={claim.isUnknown}
            onChange={(event) => update({ isUnknown: event.target.checked })}
          />
          <span>
            <strong>I do not know yet</strong>
            <small>Unknown is a valid result and remains visible in coverage and confidence.</small>
          </span>
        </label>
        {claim.isUnknown ? (
          <div className="unknown-panel">
            <label className="field">
              <span>Why is this not known?</span>
              <textarea
                rows={3}
                value={claim.unknownReason}
                onChange={(e) => update({ unknownReason: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Confidence effect</span>
              <textarea
                rows={2}
                value={claim.confidenceEffect}
                onChange={(e) => update({ confidenceEffect: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Coverage effect</span>
              <textarea
                rows={2}
                value={claim.coverageEffect}
                onChange={(e) => update({ coverageEffect: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Follow-up owner or action</span>
              <input
                value={claim.followUp}
                onChange={(e) => update({ followUp: e.target.value })}
              />
            </label>
          </div>
        ) : (
          <div className="two-column">
            <label className="field">
              <span>Source and confidence</span>
              <select
                value={claim.provenance}
                onChange={(e) => update({ provenance: e.target.value as DraftClaim["provenance"] })}
              >
                <option value="owner-stated">Told to us by an owner</option>
                <option value="documented">Written in product or customer material</option>
                <option value="observed">Seen during this assessment</option>
                <option value="analytics-supported">Supported by analytics</option>
                <option value="code-inferred">Inferred from the code</option>
                <option value="unverified">Not yet verified</option>
                <option value="conflicting">Sources disagree</option>
              </select>
            </label>
            <label className="field">
              <span>Confidence</span>
              <select
                value={claim.confidence}
                onChange={(e) => update({ confidence: e.target.value as DraftClaim["confidence"] })}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            {claim.provenance === "owner-stated" ? (
              <label className="field">
                <span>Speaker role</span>
                <input
                  value={claim.speakerRole}
                  onChange={(e) => update({ speakerRole: e.target.value })}
                />
              </label>
            ) : null}
            {claim.provenance === "conflicting" ? (
              <Notice title="References are required" tone="caution">
                <p>
                  Initial setup cannot create conflicting references. Save this as “Not yet
                  verified” and state that sources disagree.
                </p>
              </Notice>
            ) : null}
            {claim.provenance === "code-inferred" ? (
              <label className="field">
                <span>Inference reasoning</span>
                <textarea
                  rows={3}
                  value={claim.inferenceReasoning}
                  onChange={(event) => update({ inferenceReasoning: event.target.value })}
                />
              </label>
            ) : null}
            {claim.provenance === "analytics-supported" ? (
              <>
                <label className="field">
                  <span>Dataset</span>
                  <input
                    value={claim.analyticsDataset}
                    onChange={(event) => update({ analyticsDataset: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Query</span>
                  <input
                    value={claim.analyticsQuery}
                    onChange={(event) => update({ analyticsQuery: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Window start</span>
                  <input
                    type="datetime-local"
                    value={claim.analyticsWindowStart}
                    onChange={(event) => update({ analyticsWindowStart: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Window end</span>
                  <input
                    type="datetime-local"
                    value={claim.analyticsWindowEnd}
                    onChange={(event) => update({ analyticsWindowEnd: event.target.value })}
                  />
                </label>
              </>
            ) : null}
          </div>
        )}
      </section>
      <div className="button-row button-row--spread">
        <Button variant="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ArrowLeft aria-hidden="true" /> Previous
        </Button>
        <Button onClick={() => void next()}>
          {index === claims.length - 1 ? "Continue to access and consent" : "Save and continue"}{" "}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </>
  );
}

const consentCards = [
  {
    id: "provider-inference",
    title: "Provider inference",
    body: "Permit bounded, redacted source excerpts to the current provider for assessment reasoning.",
    destination: "Current provider endpoints from the release policy",
    data: "Repository metadata and selected redacted text excerpts",
    denial: "Provider phases remain blocked; cross-agent completeness cannot be claimed.",
  },
  {
    id: "target-code-execution",
    title: "Execute target code",
    body: "Run unknown repository code only inside a disposable worker virtual machine.",
    destination: "Internal runtime only; external network denied",
    data: "Immutable safe copy and synthetic fixtures",
    denial: "Dynamic controls are blocked. Static assessment remains valid.",
  },
  {
    id: "build-acquisition",
    title: "Acquire build dependencies",
    body: "Permit a trusted fetch adapter to retrieve exact declared dependencies.",
    destination: "registry.npmjs.org:443",
    data: "Typed package coordinates; no source body",
    denial: "Build-dependent checks may be blocked or partly tested.",
  },
  {
    id: "optional-hosted-scan",
    title: "Optional hosted scanner",
    body: "Send a minimized manifest to the disclosed hosted service through a pinned adapter.",
    destination: "scanner.example.invalid:443",
    data: "File manifest and selected redacted records, up to 5 MiB",
    denial: "Local tools continue. The hosted comparison is not tested.",
  },
];

function Consent({
  choices,
  setChoices,
  run,
  mode,
  onSaved,
  navigate,
}: {
  choices: ConsentChoice[];
  setChoices: (choices: ConsentChoice[]) => void;
  run: AppData["run"]["run"];
  mode: DataMode;
  onSaved: (rowVersion: number) => void;
  navigate: (view: View) => void;
}) {
  const [error, setError] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretHandle, setSecretHandle] = useState("");
  const choose = (capabilityId: string, decision: ConsentChoice["decision"]) => {
    setChoices(
      choices.map((item) => (item.capabilityId === capabilityId ? { ...item, decision } : item)),
    );
  };
  const proceed = async () => {
    if (choices.some((choice) => !choice.decision)) {
      setError("Choose Approve or Do not approve for every capability. Nothing is preselected.");
      return;
    }
    setError("");
    if (mode === "preview") {
      navigate("review");
      return;
    }
    try {
      const response = await saveApprovals(
        run,
        choices.map((choice, index) => toApproval(choice, run.runId, index)),
      );
      onSaved(response.rowVersion);
      navigate("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Access decisions could not be saved.");
    }
  };
  const uploadSecret = async (event: FormEvent) => {
    event.preventDefault();
    if (!secretValue) return;
    const value = secretValue;
    setSecretValue("");
    if (mode === "preview") {
      setSecretHandle("sec_target-service · preview only · no upload performed");
      return;
    }
    try {
      const result = await createAndUploadSecret(run, value, onSaved);
      setSecretHandle(`${result.secretHandleId} · uploaded · one use`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The secret could not be uploaded.");
    }
  };
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Prepare · Step 3 of 4</p>
        <h1 tabIndex={-1}>{viewTitles.consent}</h1>
        <p>Approve only the access you understand. Approval and denial have equal weight.</p>
      </header>
      <Notice title="Bounded isolation, not a guarantee" tone="caution">
        <p>
          An unknown repository may be hostile. Execution uses a disposable virtual machine with no
          host Docker socket, provider credential, host mount, or output path. Hypervisor and
          approved-channel exfiltration risks remain.
        </p>
      </Notice>
      {error ? (
        <div className="error-summary" role="alert">
          <h2>Decisions needed</h2>
          <p>{error}</p>
        </div>
      ) : null}
      <div className="consent-list">
        {consentCards.map((card) => {
          const choice = choices.find((item) => item.capabilityId === card.id);
          return (
            <fieldset className="consent-card" key={card.id}>
              <legend>{card.title}</legend>
              <p>{card.body}</p>
              <dl className="definition-grid">
                <div>
                  <dt>Destination</dt>
                  <dd>{card.destination}</dd>
                </div>
                <div>
                  <dt>Methods</dt>
                  <dd>
                    {card.id === "target-code-execution"
                      ? "Release-owned safe controls only"
                      : "GET / HEAD through trusted adapter"}
                  </dd>
                </div>
                <div>
                  <dt>Data categories</dt>
                  <dd>{card.data}</dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>
                    {card.id === "target-code-execution"
                      ? "Disposable local worker VM"
                      : "Disclosed service"}
                  </dd>
                </div>
                <div>
                  <dt>Expiry</dt>
                  <dd>End of this run or 12 hours, whichever comes first</dd>
                </div>
                <div>
                  <dt>If denied</dt>
                  <dd>{card.denial}</dd>
                </div>
              </dl>
              <div className="approval-row">
                <label>
                  <input
                    type="radio"
                    name={`approval-${card.id}`}
                    checked={choice?.decision === "approved"}
                    onChange={() => choose(card.id, "approved")}
                  />{" "}
                  Approve
                </label>
                <label>
                  <input
                    type="radio"
                    name={`approval-${card.id}`}
                    checked={choice?.decision === "denied"}
                    onChange={() => choose(card.id, "denied")}
                  />{" "}
                  Do not approve
                </label>
              </div>
              <TechnicalDetails>
                <p>
                  Capability ID: <code>{card.id}</code>
                </p>
                <p>
                  Disclosure version: <code>rak-disclosure/1.0.0</code>
                </p>
              </TechnicalDetails>
            </fieldset>
          );
        })}
      </div>
      <section className="section secret-boundary">
        <div>
          <p className="eyebrow">Safe credential boundary</p>
          <h2>Sandbox credential</h2>
          <p>
            Only newly created or confirmed disposable, non-production, short-lived credentials
            belong here. Production and shared production/test credentials are prohibited.
          </p>
        </div>
        {secretHandle ? (
          <Notice title="Credential handle created" tone="success">
            <p>
              <code>{secretHandle}</code>
            </p>
            <p>
              The secret value was cleared and cannot be shown again. Revoking the handle does not
              revoke an approval.
            </p>
          </Notice>
        ) : (
          <form className="form-stack" onSubmit={(event) => void uploadSecret(event)}>
            <label className="field">
              <span>One-use sandbox credential</span>
              <span className="hint">
                Sent as a bounded octet upload. It is not stored in JSON, local storage, or rendered
                again.
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
              />
            </label>
            <button className="button button--secondary" type="submit">
              <KeyRound aria-hidden="true" /> Create and upload handle
            </button>
          </form>
        )}
      </section>
      <div className="button-row button-row--spread">
        <Button variant="secondary" onClick={() => navigate("discovery")}>
          <ArrowLeft aria-hidden="true" /> Product context
        </Button>
        <Button onClick={() => void proceed()}>
          Review setup <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </>
  );
}

function SetupReview({
  data,
  setup,
  claims,
  choices,
  mode,
  navigate,
}: {
  data: AppData;
  setup: DraftSetup;
  claims: DraftClaim[];
  choices: ConsentChoice[];
  mode: DataMode;
  navigate: (view: View) => void;
}) {
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState("");
  const prepare = async () => {
    if (!authorized) {
      setMessage("Confirm that you are authorized and supplied only sandbox-safe access.");
      return;
    }
    if (mode === "preview") {
      setMessage(
        "Preview only: setup was checked in this tab, but no draft or safe copy was created.",
      );
      return;
    }
    try {
      await runAction(
        `/api/v1/runs/${data.run.run.runId}/actions/resolve-target`,
        data.run.run.rowVersion,
        { expectedRowVersion: data.run.run.rowVersion },
      );
      navigate("overview");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The source could not be prepared.");
    }
  };
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Prepare · Step 4 of 4</p>
        <h1 tabIndex={-1}>{viewTitles.review}</h1>
        <p>Review every editable setup choice before preparing the immutable safe copy.</p>
      </header>
      <Notice title="This setup review is session-local" tone="info">
        <p>
          Saved discovery and approval details cannot be reopened after reload in this contract
          version. Start a new draft to review or change them. An existing draft remains listed.
        </p>
      </Notice>
      <section className="review-ledger">
        <h2>Project and source</h2>
        <dl className="definition-grid">
          <div>
            <dt>Project</dt>
            <dd>{setup.projectSlug || "northstar-portal"}</dd>
          </div>
          <div>
            <dt>Engagement</dt>
            <dd>{setup.engagementId || "eng-demo"}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{providerName(data.system.launcherProvider)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {setup.sourceKind === "local"
                ? `${setup.sourceHandleId} / ${setup.relativePath}`
                : setup.sshUrl}
            </dd>
          </div>
          <div>
            <dt>Copy mode</dt>
            <dd>{humanize(setup.mode)}</dd>
          </div>
          <div>
            <dt>Output convention</dt>
            <dd>
              <code>generated/&lt;project&gt;-&lt;commit&gt;-&lt;timestamp&gt;/</code>
            </dd>
          </div>
        </dl>
        <Button variant="quiet" onClick={() => navigate("new")}>
          Change project or source
        </Button>
      </section>
      <section className="review-ledger">
        <h2>Product context</h2>
        <ol className="trace-rail">
          {claims.map((claim, index) => (
            <li key={claim.topic}>
              <span className="trace-rail__number">{index + 1}</span>
              <div>
                <h3>{topicContent[claim.topic].title}</h3>
                <p>
                  {claim.isUnknown
                    ? `Unknown: ${claim.unknownReason || "No reason entered"}`
                    : claim.statement || "Sample response pending"}
                </p>
                <small>
                  {claim.isUnknown
                    ? claim.coverageEffect
                    : `${humanize(claim.provenance)} · ${claim.confidence} confidence`}
                </small>
              </div>
            </li>
          ))}
        </ol>
        <Button variant="quiet" onClick={() => navigate("discovery")}>
          Change product context
        </Button>
      </section>
      <section className="review-ledger">
        <h2>Access decisions</h2>
        <ul className="decision-list">
          {choices.map((choice) => (
            <li key={choice.capabilityId}>
              <span>{humanize(choice.capabilityId)}</span>
              <Status
                value={choice.decision || "missing"}
                label={choice.decision ? humanize(choice.decision) : "Decision missing"}
              />
            </li>
          ))}
        </ul>
        <Button variant="quiet" onClick={() => navigate("consent")}>
          Change access decisions
        </Button>
      </section>
      <label className="authorization">
        <input
          type="checkbox"
          checked={authorized}
          onChange={(event) => setAuthorized(event.target.checked)}
        />
        <span>
          <strong>Authorization statement</strong>I am authorized to assess this repository and
          supplied only credentials and endpoints approved for this sandbox.
        </span>
      </label>
      {message ? (
        <Notice
          title={mode === "preview" ? "No operation performed" : "Could not prepare the source"}
          tone="caution"
          alert
        >
          <p>{message}</p>
          <p>Your entered setup remains in this tab. Coverage has not changed.</p>
        </Notice>
      ) : null}
      <div className="button-row">
        <Button onClick={() => void prepare()}>
          <ShieldCheck aria-hidden="true" /> Prepare safe copy
        </Button>
      </div>
    </>
  );
}

function Overview({
  data,
  mode,
  eventStatus,
  actionMessage,
  setActionMessage,
}: {
  data: AppData;
  mode: DataMode;
  eventStatus: "connected" | "reconnecting" | "preview";
  actionMessage: string;
  setActionMessage: (message: string) => void;
}) {
  const run = data.run.run;
  const currentPhase = data.run.phases.findIndex((phase) => phase.state === "RUNNING");
  const action = async (kind: "pause" | "cancel") => {
    if (mode === "preview") {
      setActionMessage(`Preview only: ${kind} was not sent and no run state changed.`);
      return;
    }
    try {
      await runAction(`/api/v1/runs/${run.runId}/actions/${kind}`, run.rowVersion, {
        reason:
          kind === "pause"
            ? "Operator requested a safe pause."
            : "Operator requested cancellation.",
      });
      setActionMessage(
        `${humanize(kind)} was durably accepted. Completion will appear in run state.`,
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "The operation was not accepted.");
    }
  };
  return (
    <>
      <ScopeStrip data={data} />
      <header className="page-heading">
        <p className="eyebrow">{stateLabels[run.state]}</p>
        <h1 tabIndex={-1}>{viewTitles.overview}</h1>
        <p>Static evidence remains useful even when live checks cannot run safely.</p>
      </header>
      <Notice title="Browser and live-runtime checks could not run safely" tone="caution">
        <p>
          Static assessment continues. This lowers confidence in login, session, and deployed
          behavior.
        </p>
      </Notice>
      <p
        className="live-status"
        role="status"
        aria-label="Live assessment status"
        aria-live="polite"
        aria-atomic="true"
      >
        Assessment status: {stateLabels[run.state]}. Live updates{" "}
        {eventStatus === "connected"
          ? "are connected"
          : eventStatus === "reconnecting"
            ? "are reconnecting"
            : "use preview records"}
        .
      </p>
      {actionMessage ? (
        <div className="polite-update" aria-live="polite">
          {actionMessage}
        </div>
      ) : null}
      <section className="overview-grid">
        <article className="metric-card">
          <span>Current phase</span>
          <strong>
            {currentPhase >= 0
              ? `${currentPhase + 1} of ${data.run.phases.length}`
              : "No phase running"}
          </strong>
          <small>
            {currentPhase >= 0
              ? phaseNames[data.run.phases[currentPhase]?.phaseKey ?? ""]
              : "See phase ledger"}
          </small>
        </article>
        <article className="metric-card">
          <span>Limitations</span>
          <strong>{run.limitationIds.length}</strong>
          <small>Visible in coverage; not hidden by completion</small>
        </article>
        <article className="metric-card">
          <span>Snapshot</span>
          <strong>{run.targetSnapshotId ? "Locked" : "Not prepared"}</strong>
          <small>The interface does not label the snapshot ID as a commit SHA</small>
        </article>
      </section>
      <section className="section" id="current-phase">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Durable workflow</p>
            <h2>Assessment phases</h2>
          </div>
          <p>No percent-complete estimate is inferred.</p>
        </div>
        <ol className="phase-rail">
          {data.run.phases.map((phase, index) => (
            <li key={phase.phaseId} aria-current={phase.state === "RUNNING" ? "step" : undefined}>
              <span className="phase-rail__number">{index + 1}</span>
              <div>
                <h3>{phaseNames[phase.phaseKey] ?? humanize(phase.phaseKey)}</h3>
                <p>
                  {phase.required ? "Required" : "Conditional"}
                  {phase.limitationIds.length ? ` · ${phase.limitationIds.length} limitation` : ""}
                </p>
              </div>
              <Status value={phase.state} label={humanize(phase.state)} />
            </li>
          ))}
        </ol>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">This browser session</p>
            <h2>Live activity</h2>
          </div>
          <span className="updating">
            {eventStatus === "connected"
              ? "Connected"
              : eventStatus === "reconnecting"
                ? "Reconnecting"
                : "Sample activity"}
          </span>
        </div>
        {eventStatus === "reconnecting" ? (
          <p className="polite-update" aria-live="polite">
            Live updates are reconnecting. The local assessment continues.
          </p>
        ) : null}
        <p className="muted">This is a bounded activity list, not durable event history.</p>
        <ol className="activity-list">
          {data.events.map((event) => (
            <li key={event.sequence}>
              <time>{formatTime(event.occurredAt)}</time>
              <span>{event.summary}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="button-row">
        <Button variant="secondary" onClick={() => void action("pause")}>
          <Pause aria-hidden="true" /> Pause safely
        </Button>
        <Button variant="danger" onClick={() => void action("cancel")}>
          <Square aria-hidden="true" /> Stop and clean up
        </Button>
      </div>
      <p className="disabled-reason">
        Resume is unavailable here because the read contract does not expose a recovery plan ID or
        retry attempt IDs. Cancel does not delete admitted records.
      </p>
    </>
  );
}

function Capability({ data, mode }: { data: AppData; mode: DataMode }) {
  const [message, setMessage] = useState("");
  const rerun = async () => {
    if (mode === "preview") {
      setMessage(
        "Preview only: the runtime check was not rerun and prior sample results are unchanged.",
      );
      return;
    }
    try {
      await runAction(
        `/api/v1/runs/${data.run.run.runId}/actions/runtime-gate`,
        data.run.run.rowVersion,
        {},
      );
      setMessage(
        "The safe runtime check was accepted. Its result will update without changing approval scope.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The runtime check was not accepted.");
    }
  };
  return (
    <>
      <ScopeStrip data={data} />
      <header className="page-heading page-heading--action">
        <div>
          <p className="eyebrow">Safety boundary</p>
          <h1 tabIndex={-1}>{viewTitles.capability}</h1>
          <p>Runtime starts offline and runs only after bounded isolation is attested.</p>
        </div>
        <Button variant="secondary" onClick={() => void rerun()}>
          <RotateCcw aria-hidden="true" /> Rerun safe runtime check
        </Button>
      </header>
      {message ? (
        <div className="polite-update" aria-live="polite">
          {message}
        </div>
      ) : null}
      <Notice title="Static-first continuation" tone="info">
        <p>
          A blocked runtime reduces coverage. It does not invalidate static evidence or widen
          permissions.
        </p>
      </Notice>
      <div className="card-list">
        {data.run.currentCapabilities.map((item) => (
          <article className="card" key={item.capabilityId}>
            <div className="card__heading">
              <h2>{humanize(item.capabilityId)}</h2>
              <Status value={item.effective} label={humanize(item.effective)} />
            </div>
            <p>{item.reason}</p>
            {item.coverageEffects.length ? (
              <div className="impact">
                <strong>Coverage effect</strong>
                <ul>
                  {item.coverageEffects.map((effect) => (
                    <li key={effect}>{effect}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <TechnicalDetails>
              <dl className="definition-grid">
                <div>
                  <dt>Support</dt>
                  <dd>{item.support}</dd>
                </div>
                <div>
                  <dt>Attestation</dt>
                  <dd>{item.attestation}</dd>
                </div>
                <div>
                  <dt>Approval</dt>
                  <dd>{item.approval}</dd>
                </div>
                <div>
                  <dt>Reason code</dt>
                  <dd>
                    <code>{item.reasonCode}</code>
                  </dd>
                </div>
                {item.evidenceOccurrenceIds.length ? (
                  <div>
                    <dt>Supporting record IDs</dt>
                    <dd>{item.evidenceOccurrenceIds.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
            </TechnicalDetails>
          </article>
        ))}
      </div>
    </>
  );
}

function Coverage({ data }: { data: AppData }) {
  return (
    <>
      <ScopeStrip data={data} />
      <header className="page-heading">
        <p className="eyebrow">Honest accounting</p>
        <h1 tabIndex={-1}>{viewTitles.coverage}</h1>
        <p>{coverageSummarySentence(data.run.coverageSummary)}</p>
      </header>
      <Notice title="Coverage is not a safety score" tone="info">
        <p>
          A pass means a stated check met its condition. It does not prove the repository or product
          is safe.
        </p>
      </Notice>
      <div className="coverage-ledger">
        {data.run.coverageSummary.map((item) => (
          <article className="coverage-row" key={item.coverageId}>
            <div>
              <h2>{humanize(item.domainId)}</h2>
              <p>
                {item.reconciledControls} of {item.plannedControls} planned controls reconciled
              </p>
            </div>
            <Status value={item.status} label={coverageLabels[item.status]} />
            <dl>
              <div>
                <dt>Exclusions</dt>
                <dd>{item.exclusions.length ? item.exclusions.join("; ") : "None recorded"}</dd>
              </div>
              <div>
                <dt>Unsupported ecosystems</dt>
                <dd>
                  {item.unsupportedEcosystems.length
                    ? item.unsupportedEcosystems.join(", ")
                    : "None recorded"}
                </dd>
              </div>
              <div>
                <dt>Limitations</dt>
                <dd>
                  {item.limitationIds.length ? item.limitationIds.join(", ") : "None recorded"}
                </dd>
              </div>
              <div>
                <dt>Supporting records</dt>
                <dd>
                  {item.evidenceOccurrenceIds.length
                    ? item.evidenceOccurrenceIds.join(", ")
                    : "None exposed"}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <section className="section">
        <h2>Status definitions</h2>
        <dl className="definition-grid definition-grid--wide">
          <div>
            <dt>Pass</dt>
            <dd>The check completed and met its stated condition.</dd>
          </div>
          <div>
            <dt>Fail</dt>
            <dd>The check completed and did not meet its stated condition.</dd>
          </div>
          <div>
            <dt>Partly tested</dt>
            <dd>Only a named subset was exercised.</dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>A safety boundary, prerequisite, or authorization prevented the check.</dd>
          </div>
          <div>
            <dt>Not applicable</dt>
            <dd>The subject was confirmed absent.</dd>
          </div>
          <div>
            <dt>Not tested</dt>
            <dd>Applicable work was omitted, not selected, or exhausted its safe budget.</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

function Findings({
  data,
  selectFinding,
}: {
  data: AppData;
  selectFinding: (finding: Finding) => void;
}) {
  const [severity, setSeverity] = useState("");
  const [validation, setValidation] = useState("");
  const filtered = data.findings.filter(
    (item) =>
      (!severity || item.technicalSeverity === severity) &&
      (!validation || item.validationState === validation),
  );
  return (
    <>
      <ScopeStrip data={data} />
      <header className="page-heading">
        <p className="eyebrow">Evidence-backed concerns and strengths</p>
        <h1 tabIndex={-1}>{viewTitles.findings}</h1>
        <p>Technical severity, business priority, confidence, and validation are kept separate.</p>
      </header>
      <div className="filter-bar" aria-label="Finding filters">
        <label>
          <span>Technical severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="informational">Informational</option>
          </select>
        </label>
        <label>
          <span>Validation</span>
          <select value={validation} onChange={(e) => setValidation(e.target.value)}>
            <option value="">All</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="corroborated">Corroborated</option>
            <option value="independently reproduced">Independently reproduced</option>
            <option value="disputed">Disputed</option>
            <option value="invalidated">Invalidated</option>
          </select>
        </label>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-note">
          <FileSearch aria-hidden="true" />
          <div>
            <h2>No filter matches</h2>
            <p>Clear one or both filters. This does not mean the assessment has zero findings.</p>
          </div>
        </div>
      ) : (
        <div className="finding-list" aria-labelledby="finding-list-title">
          <h2 className="sr-only" id="finding-list-title">
            Filtered findings
          </h2>
          {filtered.map((finding) => (
            <article className="finding-card" key={finding.findingId}>
              <div>
                <p className="eyebrow">{humanize(finding.category)}</p>
                <h3>{finding.title}</h3>
                <p>{finding.description}</p>
              </div>
              <dl className="finding-signals">
                <div>
                  <dt>Business priority</dt>
                  <dd>{humanize(finding.businessPriority)}</dd>
                </div>
                <div>
                  <dt>Technical severity</dt>
                  <dd>{humanize(finding.technicalSeverity)}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{humanize(finding.confidence)}</dd>
                </div>
                <div>
                  <dt>Validation</dt>
                  <dd>{humanize(finding.validationState)}</dd>
                </div>
              </dl>
              <p className="path">
                {finding.locations[0]?.repoRelPath ?? "No source location exposed"}
              </p>
              <Button variant="secondary" onClick={() => selectFinding(finding)}>
                Open finding <ChevronRight aria-hidden="true" />
              </Button>
            </article>
          ))}
        </div>
      )}
      <p className="pager-note">
        No next cursor was returned. The interface does not invent a total or page count.
      </p>
    </>
  );
}

function FindingDetail({
  finding,
  data,
  navigate,
  selectEvidence,
}: {
  finding: Finding;
  data: AppData;
  navigate: (view: View) => void;
  selectEvidence: (evidence: EvidenceOccurrence) => void;
}) {
  const linked = data.evidence.filter((item) =>
    finding.evidenceOccurrenceIds.includes(item.evidenceId),
  );
  return (
    <>
      <Button variant="quiet" onClick={() => navigate("findings")}>
        <ArrowLeft aria-hidden="true" /> All findings
      </Button>
      <header className="page-heading">
        <p className="eyebrow">{humanize(finding.category)}</p>
        <h1 tabIndex={-1}>{finding.title}</h1>
      </header>
      {["disputed", "invalidated"].includes(finding.validationState) ? (
        <Notice title={`Independent review marked this ${finding.validationState}`} tone="caution">
          <p>
            The original description remains visible, but it cannot support an unconditional
            recommendation.
          </p>
        </Notice>
      ) : null}
      <section className="finding-consequence">
        <div>
          <p className="eyebrow">Business consequence</p>
          <h2>Session behavior may differ from the code-level expectation</h2>
          <p>
            Customer accounts could receive weaker transport protection if the deployment setting is
            absent.
          </p>
        </div>
        <div>
          <p className="eyebrow">Next action</p>
          <h2>{finding.remediationTheme ?? "Confirm the condition and choose an owner."}</h2>
        </div>
      </section>
      <dl className="signal-grid">
        <div>
          <dt>Business priority</dt>
          <dd>{humanize(finding.businessPriority)}</dd>
        </div>
        <div>
          <dt>Technical severity</dt>
          <dd>{humanize(finding.technicalSeverity)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{humanize(finding.confidence)}</dd>
        </div>
        <div>
          <dt>Validation</dt>
          <dd>{humanize(finding.validationState)}</dd>
        </div>
      </dl>
      <section className="section">
        <h2>Description</h2>
        <p className="measure">{finding.description}</p>
      </section>
      <section className="section">
        <h2>Supporting record trace</h2>
        {linked.length ? (
          <ol className="trace-rail">
            {linked.map((item, index) => (
              <li key={item.evidenceId}>
                <span className="trace-rail__number">{index + 1}</span>
                <div>
                  <p className="eyebrow">{humanize(item.evidenceType)}</p>
                  <h3>{item.title}</h3>
                  <p>
                    {item.collectionLimitations.join(" ") || "No collection limitation recorded."}
                  </p>
                  <Button variant="quiet" onClick={() => selectEvidence(item)}>
                    Open supporting record
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>No returned evidence links are available.</p>
        )}
      </section>
      <TechnicalDetails>
        <dl className="definition-grid">
          <div>
            <dt>Finding ID</dt>
            <dd>{finding.findingId}</dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd>{finding.fingerprint.value}</dd>
          </div>
          <div>
            <dt>Locations</dt>
            <dd>
              {finding.locations
                .map((item) => `${item.repoRelPath}:${String(item.startLine ?? "")}`)
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt>CWE mappings</dt>
            <dd>{finding.cweMappings.map((item) => item.cweId).join(", ") || "None"}</dd>
          </div>
        </dl>
      </TechnicalDetails>
    </>
  );
}

function EvidenceList({
  data,
  selectEvidence,
}: {
  data: AppData;
  selectEvidence: (evidence: EvidenceOccurrence) => void;
}) {
  const [validation, setValidation] = useState("");
  const items = data.evidence.filter((item) => !validation || item.validationState === validation);
  return (
    <>
      <ScopeStrip data={data} />
      <header className="page-heading">
        <p className="eyebrow">Supporting records</p>
        <h1 tabIndex={-1}>{viewTitles.evidence}</h1>
        <p>Each record has its own capture context, validation, sensitivity, and limitations.</p>
      </header>
      <div className="filter-bar">
        <label>
          <span>Validation</span>
          <select value={validation} onChange={(e) => setValidation(e.target.value)}>
            <option value="">All</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="validated">Validated</option>
            <option value="disputed">Disputed</option>
            <option value="invalidated">Invalidated</option>
          </select>
        </label>
      </div>
      <div className="evidence-list">
        {items.map((item) => (
          <article className="evidence-card" key={item.evidenceId}>
            <div>
              <p className="eyebrow">{humanize(item.evidenceType)}</p>
              <h2>{item.title}</h2>
            </div>
            <dl>
              <div>
                <dt>Captured</dt>
                <dd>{formatDate(item.capturedAt)}</dd>
              </div>
              <div>
                <dt>Sensitivity</dt>
                <dd>{humanize(item.sensitivity)}</dd>
              </div>
              <div>
                <dt>Redaction</dt>
                <dd>{humanize(item.redactionState)}</dd>
              </div>
              <div>
                <dt>Validation</dt>
                <dd>{humanize(item.validationState)}</dd>
              </div>
            </dl>
            <Button variant="secondary" onClick={() => selectEvidence(item)}>
              Open record
            </Button>
          </article>
        ))}
      </div>
      <p className="pager-note">
        No next cursor was returned. Search and complete result totals are not available in this
        contract.
      </p>
    </>
  );
}

function EvidenceDetail({
  evidence,
  navigate,
}: {
  evidence: EvidenceOccurrence;
  navigate: (view: View) => void;
}) {
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const preview = () => {
    setPreviewState("loading");
    window.setTimeout(() => setPreviewState("ready"), 450);
  };
  return (
    <>
      <Button variant="quiet" onClick={() => navigate("evidence")}>
        <ArrowLeft aria-hidden="true" /> All supporting records
      </Button>
      <header className="page-heading">
        <p className="eyebrow">{humanize(evidence.evidenceType)}</p>
        <h1 tabIndex={-1}>{evidence.title}</h1>
        <p>Captured {formatDate(evidence.capturedAt)}</p>
      </header>
      <dl className="definition-grid definition-grid--wide">
        <div>
          <dt>Snapshot ID</dt>
          <dd>{evidence.snapshotId}</dd>
        </div>
        <div>
          <dt>Activity ID</dt>
          <dd>{evidence.activityId}</dd>
        </div>
        <div>
          <dt>Sensitivity</dt>
          <dd>{humanize(evidence.sensitivity)}</dd>
        </div>
        <div>
          <dt>Redaction</dt>
          <dd>{humanize(evidence.redactionState)}</dd>
        </div>
        <div>
          <dt>Validation</dt>
          <dd>{humanize(evidence.validationState)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {evidence.sourceLocator?.repoRelPath ??
              evidence.packageRelPath ??
              evidence.externalLocator ??
              "No locator exposed"}
          </dd>
        </div>
      </dl>
      {evidence.collectionLimitations.length ? (
        <Notice title="Collection limitations" tone="caution">
          <ul>
            {evidence.collectionLimitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <section className="safe-preview" aria-busy={previewState === "loading"}>
        <div className="safe-preview__heading">
          <div>
            <p className="eyebrow">Safe preview</p>
            <h2>Escaped text derivative</h2>
          </div>
          {previewState === "idle" ? (
            <Button variant="secondary" onClick={preview}>
              Load safe preview
            </Button>
          ) : null}
        </div>
        {previewState === "idle" ? (
          <p>
            Preview is requested separately. Active HTML, SVG, XML, PDF, archives, and unknown media
            never render inline.
          </p>
        ) : null}
        {previewState === "loading" ? <p>Loading bounded preview…</p> : null}
        {previewState === "ready" ? (
          <pre tabIndex={0}>
            Session cookie policy: secure transport setting requires deployment confirmation.{"\n"}
            Preview ends here.
          </pre>
        ) : null}
        {previewState === "error" ? (
          <p role="alert">
            The safe preview could not be loaded. The record remains unchanged and may still be
            available as an attachment.
          </p>
        ) : null}
      </section>
      <div className="button-row">
        <Button variant="secondary" onClick={() => setPreviewState("error")}>
          Show preview failure state
        </Button>
        <Button variant="secondary">
          <Download aria-hidden="true" /> Download attachment
        </Button>
      </div>
      <TechnicalDetails>
        <CopyValue label="evidence ID" value={evidence.evidenceId} />
        <p>Derived from: {evidence.derivedFromEvidenceIds.join(", ") || "None"}</p>
        <p>Linked findings: {evidence.linkedFindingIds.join(", ") || "None"}</p>
        <p>Linked controls: {evidence.linkedControlIds.join(", ") || "None"}</p>
      </TechnicalDetails>
    </>
  );
}

function Decision({ data }: { data: AppData }) {
  if (!data.decisionAvailable) {
    return (
      <>
        <ScopeStrip data={data} />
        <header className="page-heading">
          <p className="eyebrow">Equal-criteria comparison</p>
          <h1 tabIndex={-1}>{viewTitles.decision}</h1>
        </header>
        <div className="empty-note">
          <FileSearch aria-hidden="true" />
          <div>
            <h2>Decision comparison is not available yet</h2>
            <p>
              The persisted assessment remains live. A comparison will appear only after the local
              API admits one; sample recommendations are never substituted.
            </p>
          </div>
        </div>
      </>
    );
  }
  const recommendation =
    data.decision.recommendation.kind === "single"
      ? humanize(data.decision.recommendation.option)
      : data.decision.recommendation.options.map(humanize).join(" → ");
  return (
    <>
      <a className="skip-secondary" href="#recommendation">
        Skip to recommendation
      </a>
      <ScopeStrip data={data} />
      <header className="page-heading" id="recommendation">
        <p className="eyebrow">Current evidence suggests</p>
        <h1 tabIndex={-1}>{recommendation}</h1>
        <p>{data.decision.rationale}</p>
        <p>
          <strong>{humanize(data.decision.confidence)} confidence</strong>
        </p>
      </header>
      <Notice title="A recommendation, not the customer's decision" tone="info">
        <p>The three paths use the same seven criteria. Reversal conditions remain visible.</p>
      </Notice>
      <div className="criterion-list">
        {data.decision.criteria.map((criterion) => (
          <section className="criterion" key={criterion.criterion}>
            <h2>{humanize(criterion.criterion)}</h2>
            <div className="option-grid">
              {(["remediation", "incremental-replacement", "full-rebuild"] as const).map(
                (option) => {
                  const item = criterion.options[option];
                  const recommended =
                    data.decision.recommendation.kind === "single"
                      ? data.decision.recommendation.option === option
                      : data.decision.recommendation.options.includes(option);
                  return (
                    <article
                      className={`option-card ${recommended ? "option-card--recommended" : ""}`}
                      key={option}
                    >
                      {recommended ? (
                        <p className="recommend-label">Recommended from current evidence</p>
                      ) : null}
                      <h3>{humanize(option)}</h3>
                      <p>{item.assessment}</p>
                      <dl>
                        <div>
                          <dt>Evidence state</dt>
                          <dd>{humanize(item.state)}</dd>
                        </div>
                        <div>
                          <dt>Confidence</dt>
                          <dd>{humanize(item.confidence)}</dd>
                        </div>
                      </dl>
                      <TechnicalDetails>
                        <p>Claim IDs: {item.claimIds.join(", ") || "None"}</p>
                        <p>Evidence IDs: {item.evidenceOccurrenceIds.join(", ") || "None"}</p>
                      </TechnicalDetails>
                    </article>
                  );
                },
              )}
            </div>
          </section>
        ))}
      </div>
      <section className="decision-conditions">
        <div>
          <h2>Assumptions</h2>
          <ul>
            {data.decision.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Dependencies</h2>
          <ul>
            {data.decision.dependencies.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2>What would change this recommendation</h2>
          <ul>
            {data.decision.reversalConditions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

function Release({ data, mode }: { data: AppData; mode: DataMode }) {
  const [message, setMessage] = useState("");
  const gateKeys = new Set([
    "independent-security-review",
    "independent-decision-review",
    "deterministic-validation",
    "technical-human-review",
    "lay-human-review",
    "package",
  ]);
  const gates = data.run.phases.filter((phase) => gateKeys.has(phase.phaseKey));
  const packageItem = data.packages[0];
  const createPackage = async () => {
    if (mode === "preview") {
      setMessage("Preview only: no package was requested and no validation or download succeeded.");
      return;
    }
    try {
      await runAction(`/api/v1/runs/${data.run.run.runId}/packages`, data.run.run.rowVersion, {});
      setMessage("Package creation was accepted. A download appears only after validation.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Package creation was not accepted.");
    }
  };
  return (
    <>
      <ScopeStrip data={data} />
      <header className="page-heading">
        <p className="eyebrow">Release gates</p>
        <h1 tabIndex={-1}>{viewTitles.release}</h1>
        <p>
          A customer package is downloadable only after its exposed state is Validated and ready.
        </p>
      </header>
      <Notice title="Review authoring is not available here" tone="info">
        <p>
          Review completion is recorded by the assessment workflow. This local interface can show
          gate state but cannot author or reopen review records in this contract version.
        </p>
      </Notice>
      <section className="section">
        <h2>Review and validation gates</h2>
        <ul className="gate-list">
          {gates.map((gate) => (
            <li key={gate.phaseId}>
              <span>{phaseNames[gate.phaseKey]}</span>
              <Status value={gate.state} label={humanize(gate.state)} />
            </li>
          ))}
        </ul>
      </section>
      <section className="package-card">
        <div>
          <p className="eyebrow">Customer package</p>
          <h2>{packageItem ? packageState(packageItem.state) : "Not created yet"}</h2>
        </div>
        {packageItem ? (
          <Status value={packageItem.state} label={packageState(packageItem.state)} />
        ) : null}
        {packageItem?.state === "FAILED" ? (
          <Notice title="Package validation did not complete" tone="danger">
            <p>Customer files were not released. The assessment records remain unchanged.</p>
            <p>
              Validation report ID: <code>{packageItem.validationReportId}</code>
            </p>
          </Notice>
        ) : null}
        {packageItem?.state === "VALIDATED" && packageItem.zipSha256 ? (
          <>
            <CopyValue label="package fingerprint" value={packageItem.zipSha256} />
            <div className="button-row">
              <Button>
                <Download aria-hidden="true" /> Download ZIP
              </Button>
              <Button variant="secondary">Download fingerprint</Button>
            </div>
          </>
        ) : (
          <Button onClick={() => void createPackage()}>
            <Play aria-hidden="true" /> Request validated package
          </Button>
        )}
        {message ? (
          <div className="polite-update" aria-live="polite">
            {message}
          </div>
        ) : null}
        <p className="muted">
          The plain ZIP is always retained. Customer report HTML is read after download and never
          previewed in this authenticated origin.
        </p>
      </section>
      <section className="section danger-zone">
        <p className="eyebrow">Data and retention</p>
        <h2>Deletion is separate from stopping</h2>
        <p>
          Deletion is available only for terminal runs, requires exact confirmations, and cannot
          delete provider or optional-service copies.
        </p>
        <Button variant="danger" disabled>
          Review deletion options
        </Button>
        <p className="disabled-reason">
          This sample run is not terminal, so deletion is unavailable.
        </p>
      </section>
    </>
  );
}

function Help({ data, mode }: { data: AppData; mode: DataMode }) {
  const [demoState, setDemoState] = useState<
    "none" | "loading" | "error" | "denied" | "disconnected" | "expired"
  >("none");
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Read the fieldbook</p>
        <h1 tabIndex={-1}>{viewTitles.help}</h1>
        <p>Plain-language definitions and honest off-path states for the local interface.</p>
      </header>
      <Notice title="Local interface boundary" tone="info">
        <p>
          This UI is published only on <code>127.0.0.1</code>. The current data source is{" "}
          <strong>{mode === "live" ? "the local API" : "a deterministic interface preview"}</strong>
          .
        </p>
      </Notice>
      <section className="section">
        <h2>Glossary</h2>
        <dl className="glossary">
          <div>
            <dt>Assessment</dt>
            <dd>
              A bounded technical and product review. It is not a legal audit or penetration test.
            </dd>
          </div>
          <div>
            <dt>Safe copy</dt>
            <dd>
              An immutable source snapshot used so assessment work does not modify the registered
              repository.
            </dd>
          </div>
          <div>
            <dt>Supporting record</dt>
            <dd>
              A captured evidence occurrence with its own source, time, validation, sensitivity, and
              limitations.
            </dd>
          </div>
          <div>
            <dt>Source and confidence</dt>
            <dd>
              Where a product claim came from and how strongly it is supported. The canonical term
              is provenance.
            </dd>
          </div>
          <div>
            <dt>File fingerprint</dt>
            <dd>A SHA-256 digest used to detect changes. It does not prove authorship.</dd>
          </div>
          <div>
            <dt>Bounded isolation</dt>
            <dd>
              Layered controls that reduce hostile runtime risk. It is not a guarantee against every
              escape.
            </dd>
          </div>
          <div>
            <dt>Technical coverage</dt>
            <dd>
              Checks against a named profile. It does not establish compliance or absence of
              vulnerabilities.
            </dd>
          </div>
        </dl>
      </section>
      <section className="section">
        <h2>Keyboard help</h2>
        <ul>
          <li>Use Tab and Shift+Tab to move through controls.</li>
          <li>Use Space for checkboxes and radio rows.</li>
          <li>Use Enter or Space for buttons and disclosures.</li>
          <li>The route heading receives focus after navigation.</li>
        </ul>
      </section>
      <section className="section">
        <h2>Universal route states</h2>
        <div className="button-row">
          <Button variant="secondary" onClick={() => setDemoState("loading")}>
            Loading
          </Button>
          <Button variant="secondary" onClick={() => setDemoState("error")}>
            Error
          </Button>
          <Button variant="secondary" onClick={() => setDemoState("denied")}>
            Denied
          </Button>
          <Button variant="secondary" onClick={() => setDemoState("disconnected")}>
            Disconnected
          </Button>
          <Button variant="secondary" onClick={() => setDemoState("expired")}>
            Replay expired
          </Button>
        </div>
        {demoState === "loading" ? (
          <div className="route-state" aria-busy="true">
            <h3>Loading assessment records</h3>
            <p>The route heading remains stable while the local API responds.</p>
            <div className="skeleton" aria-hidden="true" />
          </div>
        ) : null}
        {demoState === "error" ? (
          <Notice title="Assessment records could not be loaded" tone="danger" alert>
            <p>The run is unchanged. Retry after checking that the local server is ready.</p>
            <p>
              Coverage cannot be displayed until canonical records load. Request ID:{" "}
              <code>req_preview</code>
            </p>
          </Notice>
        ) : null}
        {demoState === "denied" ? (
          <Notice title="This action is not approved" tone="caution">
            <p>
              No access was widened and static work remains available. Create a revised assessment
              if the required approval must change.
            </p>
          </Notice>
        ) : null}
        {demoState === "disconnected" ? (
          <Notice title="Live updates are reconnecting" tone="caution">
            <p>
              The local assessment continues. Canonical run content remains visible and focus does
              not move.
            </p>
          </Notice>
        ) : null}
        {demoState === "expired" ? (
          <Notice title="Earlier activity is not available in this view" tone="info">
            <p>
              The event list was cleared and canonical resources were refetched. Durable assessment
              records remain available.
            </p>
          </Notice>
        ) : null}
      </section>
      <TechnicalDetails>
        <p>
          Product version: <code>{data.system.productVersion}</code>
        </p>
        <p>
          Contract: <code>{data.system.contractProfile}</code>
        </p>
        <p>
          Workflow: <code>{data.system.workflowProfile}</code>
        </p>
        <p>
          Export profile: <code>{data.system.exportProfile}</code>
        </p>
      </TechnicalDetails>
    </>
  );
}

export function App() {
  const [data, setData] = useState<AppData>(fixtureData);
  const [mode, setMode] = useState<DataMode>("live");
  const [loading, setLoading] = useState(true);
  const [authoritativeDataLoaded, setAuthoritativeDataLoaded] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [view, setView] = useState<View>("welcome");
  const [menuOpen, setMenuOpen] = useState(false);
  const [setup, setSetup] = useState(defaultSetup);
  const [claims, setClaims] = useState(defaultClaims);
  const [choices, setChoices] = useState<ConsentChoice[]>(
    consentCards.map((item) => ({ capabilityId: item.id, decision: "" })),
  );
  const [selectedFinding, setSelectedFinding] = useState<Finding>(fixtureData.findings[0]!);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceOccurrence>(
    fixtureData.evidence[0]!,
  );
  const [actionMessage, setActionMessage] = useState("");
  const [eventStatus, setEventStatus] = useState<"connected" | "reconnecting" | "preview">(
    "preview",
  );
  const headingRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await bootstrapSessionFromFragment();
        if (controller.signal.aborted) return;
        const result = await loadInitialData(controller.signal);
        if (controller.signal.aborted) return;
        if (result.data) {
          setData(result.data);
          setAuthoritativeDataLoaded(true);
        }
        setMode(result.mode);
        setLiveError((current) => current || result.liveError || "");
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setLiveError(
          error instanceof Error ? error.message : "The one-time session link was not accepted.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode !== "live" || loading || !data.runAvailable) {
      setEventStatus("preview");
      return;
    }
    const source = new EventSource(
      `/api/v1/runs/${encodeURIComponent(data.run.run.runId)}/events`,
      { withCredentials: true },
    );
    const eventTypes = [
      "run.state.changed",
      "phase.state.changed",
      "job.state.changed",
      "capability.changed",
      "coverage.changed",
      "finding.admitted",
      "review.required",
      "artifact.admitted",
      "package.state.changed",
      "warning.raised",
    ];
    const receive = (event: MessageEvent<string>) => {
      try {
        const item = JSON.parse(event.data) as AppData["events"][number];
        setData((current) => ({
          ...current,
          events: [
            ...current.events.filter((existing) => existing.sequence !== item.sequence),
            item,
          ]
            .sort((left, right) => Number(left.sequence) - Number(right.sequence))
            .slice(-50),
        }));
      } catch {
        setEventStatus("reconnecting");
      }
    };
    eventTypes.forEach((type) => source.addEventListener(type, receive as EventListener));
    source.onopen = () => setEventStatus("connected");
    source.onerror = () => setEventStatus("reconnecting");
    return () => source.close();
  }, [data.run.run.runId, data.runAvailable, loading, mode]);

  useEffect(() => {
    const title = viewTitles[view];
    document.title = `${title} · Repository Assessment Kit`;
    requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("#main-content h1");
      headingRef.current = heading;
      heading?.focus();
    });
  }, [view]);

  const navigate = (next: View) => {
    setView(next);
    setMenuOpen(false);
  };
  const selectFinding = (finding: Finding) => {
    setSelectedFinding(finding);
    navigate("finding");
  };
  const selectEvidence = (evidence: EvidenceOccurrence) => {
    setSelectedEvidence(evidence);
    navigate("evidence-detail");
  };
  const inRun =
    data.runAvailable &&
    (navItems.some((item) => item.view === view) || ["finding", "evidence-detail"].includes(view));

  let content: ReactNode;
  if (loading) {
    content = (
      <div className="route-state" aria-busy="true">
        <h1 tabIndex={-1}>Loading local workspace</h1>
        <p>Checking the local API and launcher state.</p>
        <div className="skeleton" aria-hidden="true" />
      </div>
    );
  } else if (!authoritativeDataLoaded && mode === "live") {
    content = (
      <div className="route-state" role="alert">
        <h1 tabIndex={-1}>The local workspace could not be loaded</h1>
        <p>
          No preview records were substituted. Restart the matching launcher and use a fresh
          one-time link; persisted assessment records remain unchanged.
        </p>
        {liveError ? <p className="technical__body">{liveError}</p> : null}
      </div>
    );
  } else {
    const pages: Partial<Record<View, ReactNode>> = {
      welcome: <Welcome data={data} navigate={navigate} />,
      readiness: <Readiness data={data} />,
      assessments: <Assessments data={data} navigate={navigate} />,
      new: (
        <NewSetup
          data={data}
          mode={mode}
          setup={setup}
          setSetup={setSetup}
          onCreated={(run) =>
            setData((current) => ({
              ...current,
              runAvailable: true,
              decisionAvailable: false,
              run: { run, phases: [], currentCapabilities: [], coverageSummary: [] },
              events: [],
              findings: [],
              evidence: [],
              packages: [],
            }))
          }
          navigate={navigate}
        />
      ),
      discovery: (
        <Discovery
          claims={claims}
          setClaims={setClaims}
          run={data.run.run}
          mode={mode}
          onSaved={(rowVersion) =>
            setData((current) => ({
              ...current,
              run: { ...current.run, run: { ...current.run.run, rowVersion } },
            }))
          }
          navigate={navigate}
        />
      ),
      consent: (
        <Consent
          choices={choices}
          setChoices={setChoices}
          run={data.run.run}
          mode={mode}
          onSaved={(rowVersion) =>
            setData((current) => ({
              ...current,
              run: { ...current.run, run: { ...current.run.run, rowVersion } },
            }))
          }
          navigate={navigate}
        />
      ),
      review: (
        <SetupReview
          data={data}
          setup={setup}
          claims={claims}
          choices={choices}
          mode={mode}
          navigate={navigate}
        />
      ),
      overview: (
        <Overview
          data={data}
          mode={mode}
          eventStatus={eventStatus}
          actionMessage={actionMessage}
          setActionMessage={setActionMessage}
        />
      ),
      capability: <Capability data={data} mode={mode} />,
      coverage: <Coverage data={data} />,
      findings: <Findings data={data} selectFinding={selectFinding} />,
      finding: (
        <FindingDetail
          finding={selectedFinding}
          data={data}
          navigate={navigate}
          selectEvidence={selectEvidence}
        />
      ),
      evidence: <EvidenceList data={data} selectEvidence={selectEvidence} />,
      "evidence-detail": <EvidenceDetail evidence={selectedEvidence} navigate={navigate} />,
      decision: <Decision data={data} />,
      release: <Release data={data} mode={mode} />,
      help: <Help data={data} mode={mode} />,
    };
    content = pages[view] ?? pages.welcome;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {inRun ? (
        <a className="skip-link skip-link--second" href="#current-phase">
          Skip to current phase
        </a>
      ) : null}
      <header className="app-header">
        <button
          className="wordmark"
          onClick={() => navigate("welcome")}
          aria-label="Repository Assessment Kit home"
        >
          <span className="wordmark__mark">RAK</span>
          <span>Repository Assessment Kit</span>
        </button>
        <div className="header-meta">
          <span>Local workspace</span>
          {authoritativeDataLoaded || mode === "preview" ? (
            <span className="provider-badge">
              Running with {providerName(data.system.launcherProvider)}
            </span>
          ) : null}
          <Button variant="quiet" onClick={() => navigate("readiness")}>
            <ShieldCheck aria-hidden="true" /> Readiness
          </Button>
          <Button variant="quiet" onClick={() => navigate("help")}>
            <CircleHelp aria-hidden="true" /> Help
          </Button>
        </div>
      </header>
      {mode === "preview" && !loading ? (
        <div className="preview-banner" role="status">
          <strong>Interface preview</strong>
          <span>
            Sample records are shown because the assessment API is not ready. No assessment
            operation, validation, or download has succeeded.
          </span>
          {liveError ? (
            <TechnicalDetails>
              <p>{liveError}</p>
            </TechnicalDetails>
          ) : null}
        </div>
      ) : null}
      <div className={`shell ${inRun ? "shell--run" : ""}`}>
        {inRun ? (
          <>
            <button className="mobile-run-nav" onClick={() => setMenuOpen(true)}>
              <Menu aria-hidden="true" /> Run navigation
            </button>
            <nav className={`run-nav ${menuOpen ? "run-nav--open" : ""}`} aria-label="Assessment">
              <div className="run-nav__header">
                <p className="eyebrow">Assessment</p>
                <strong>{data.run.run.projectSlug}</strong>
                <button
                  className="run-nav__close"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close run navigation"
                >
                  <X />
                </button>
              </div>
              <ul>
                {navItems.map((item) => (
                  <li key={item.view}>
                    <button
                      aria-current={
                        view === item.view ||
                        (view === "finding" && item.view === "findings") ||
                        (view === "evidence-detail" && item.view === "evidence")
                          ? "page"
                          : undefined
                      }
                      onClick={() => navigate(item.view)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
              <Button variant="quiet" onClick={() => navigate("assessments")}>
                <ArrowLeft aria-hidden="true" /> All assessments
              </Button>
            </nav>
            {menuOpen ? (
              <button
                className="nav-backdrop"
                onClick={() => setMenuOpen(false)}
                aria-label="Close run navigation"
              />
            ) : null}
          </>
        ) : null}
        <main id="main-content" className="main-content">
          {content}
        </main>
      </div>
      <footer className="app-footer">
        <span>Repository Assessment Kit {data.system.productVersion}</span>
        <span>This interface is published to this computer only through loopback.</span>
      </footer>
    </div>
  );
}

function humanize(value: string): string {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function packageState(value: string): string {
  const labels: Record<string, string> = {
    REQUESTED: "Requested",
    STAGING: "Preparing files",
    VALIDATING: "Checking package",
    VALIDATED: "Validated and ready",
    FAILED: "Failed",
  };
  return labels[value] ?? humanize(value);
}

function toProductClaim(claim: DraftClaim, runId: string, index: number): ProductClaim {
  const now = new Date().toISOString();
  const provenance = claim.provenance === "conflicting" ? "unverified" : claim.provenance;
  return {
    schemaVersion: "1.0.0",
    claimId: `claim_${String(index + 1).padStart(2, "0")}`,
    runId,
    topic: claim.topic,
    ...(claim.isUnknown
      ? {
          unknown: {
            reason: claim.unknownReason,
            confidenceEffect: claim.confidenceEffect,
            coverageEffect: claim.coverageEffect,
            followUp: claim.followUp,
          },
        }
      : { statement: claim.statement }),
    provenance: claim.isUnknown ? "unverified" : provenance,
    ...(provenance === "owner-stated" && !claim.isUnknown
      ? { speakerRole: claim.speakerRole, capturedAt: now }
      : {}),
    ...(provenance === "analytics-supported" && !claim.isUnknown
      ? {
          analytics: {
            dataset: claim.analyticsDataset,
            query: claim.analyticsQuery,
            windowStart: new Date(claim.analyticsWindowStart).toISOString(),
            windowEnd: new Date(claim.analyticsWindowEnd).toISOString(),
          },
        }
      : {}),
    ...(provenance === "code-inferred" && !claim.isUnknown
      ? { inferenceReasoning: claim.inferenceReasoning }
      : {}),
    confidence: claim.confidence,
    evidenceOccurrenceIds: [],
    conflictsWithClaimIds: [],
    revision: 1,
  };
}

function toApproval(choice: ConsentChoice, runId: string, index: number): Approval {
  const card = consentCards.find((item) => item.id === choice.capabilityId);
  const approvedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const destinations =
    choice.capabilityId === "build-acquisition"
      ? [{ scheme: "https", host: "registry.npmjs.org", port: 443 }]
      : choice.capabilityId === "optional-hosted-scan"
        ? [{ scheme: "https", host: "scanner.example.invalid", port: 443 }]
        : [];
  return {
    schemaVersion: "1.0.0",
    approvalId: `apr_${String(index + 1).padStart(2, "0")}`,
    runId,
    capabilityId: choice.capabilityId,
    decision: choice.decision === "approved" ? "approved" : "denied",
    destinations,
    methods: choice.capabilityId === "target-code-execution" ? [] : ["GET", "HEAD"],
    dataCategories: [card?.data ?? "No external data category"],
    recipientServices: [card?.destination ?? "Local assessment runtime"],
    disclosureVersion: "rak-disclosure/1.0.0",
    approverRole: "assessment-operator",
    approvedAt,
    expiresAt,
  };
}
