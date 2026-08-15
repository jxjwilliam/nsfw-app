"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  loadStoredPrefs,
  mergePrefs,
  NSFW_DEFAULTS,
  saveStoredPrefs,
} from "@/lib/nsfw-defaults";
import type { MediaType, PlanSnapshot, QualityTier, RunMetadata, Style } from "@/lib/types";

type HistoryItem = RunMetadata & { outputDir: string };

type GenState =
  | { phase: "idle" }
  | { phase: "running"; jobId: string }
  | { phase: "done"; jobId: string; status: "SUCCESS" | "FAILED"; errorMessage?: string };

const STYLES: { value: Style; label: string }[] = [
  { value: "anime", label: "Anime" },
  { value: "realistic", label: "Realistic" },
  { value: "hentai", label: "Hentai" },
  { value: "hassaku", label: "Hassaku" },
];

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "2:3", "3:2", "4:3", "3:4"] as const;

const QUALITIES: { value: QualityTier; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];

const PROMPT_MAX = 20000;
const POLL_MS = 8000;

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
  } catch {
    /* fallback */
  }
  return `${res.status} ${res.statusText}`;
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={
                selected
                  ? "rounded-full border border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_22%,transparent)] px-3 py-1 text-sm text-[color:var(--fg)] shadow-[inset_0_0_0_1px_rgba(225,29,72,0.35)]"
                  : "rounded-full border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--card)_85%,transparent)] px-3 py-1 text-sm text-[color:var(--muted)] hover:border-zinc-500 hover:text-[color:var(--fg)]"
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChipRowRatios({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((r) => {
          const selected = value === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => onChange(r)}
              className={
                selected
                  ? "rounded-full border border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_22%,transparent)] px-3 py-1 text-sm tabular-nums text-[color:var(--fg)] shadow-[inset_0_0_0_1px_rgba(225,29,72,0.35)]"
                  : "rounded-full border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--card)_85%,transparent)] px-3 py-1 text-sm tabular-nums text-[color:var(--muted)] hover:border-zinc-500 hover:text-[color:var(--fg)]"
              }
            >
              {r}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function readInitialPrefs() {
  return mergePrefs(loadStoredPrefs());
}

export default function Home() {
  const [prefsReady, setPrefsReady] = useState(false);
  const [prompt, setPrompt] = useState<string>(NSFW_DEFAULTS.prompt);
  const [style, setStyle] = useState<Style>(NSFW_DEFAULTS.style);
  const [aspectRatio, setAspectRatio] = useState<string>(NSFW_DEFAULTS.aspectRatio);
  const [qualityTier, setQualityTier] = useState<QualityTier>(NSFW_DEFAULTS.qualityTier);
  const [mediaType, setMediaType] = useState<MediaType>(NSFW_DEFAULTS.mediaType);

  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [gen, setGen] = useState<GenState>({ phase: "idle" });
  const [doneMediaType, setDoneMediaType] = useState<MediaType | undefined>(undefined);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [pollProgress, setPollProgress] = useState<number | undefined>(undefined);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySelect, setHistorySelect] = useState<string>("");

  const [bannerError, setBannerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);

  const charCount = prompt.length;
  const planDisabled = planLoading || !prompt.trim() || charCount > PROMPT_MAX;

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { items?: HistoryItem[] };
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const p = readInitialPrefs();
    setPrompt(p.prompt);
    setStyle(p.style);
    setAspectRatio(p.aspectRatio);
    setQualityTier(p.qualityTier);
    setMediaType(p.mediaType);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    saveStoredPrefs({ prompt, style, aspectRatio, qualityTier, mediaType });
  }, [prefsReady, prompt, style, aspectRatio, qualityTier, mediaType]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const previewMeta = useMemo(() => {
    if (!previewJobId) return undefined;
    return history.find((h) => h.jobId === previewJobId);
  }, [history, previewJobId]);

  const previewIsSuccess =
    previewMeta?.status === "SUCCESS" ||
    (gen.phase === "done" && gen.status === "SUCCESS" && gen.jobId === previewJobId);

  /** Poll RUNNING jobs from the server-driven status endpoint. */
  useEffect(() => {
    if (gen.phase !== "running") {
      setPollProgress(undefined);
      return undefined;
    }

    const { jobId } = gen;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/status?jobId=${encodeURIComponent(jobId)}`);
        let body: Record<string, unknown> = {};
        try {
          body = (await res.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        if (cancelled) return;

        if (!res.ok) {
          const err =
            typeof body.errorMessage === "string"
              ? body.errorMessage
              : await readErrorMessage(res);
          setGen({ phase: "done", jobId, status: "FAILED", errorMessage: err });
          setBannerError(err);
          void fetchHistory();
          return;
        }

        const status = body.status as string | undefined;
        const progress = typeof body.progress === "number" ? body.progress : undefined;

        if (status === "RUNNING") {
          setPollProgress(progress ?? 0);
          return;
        }

        setPollProgress(undefined);

        if (status === "SUCCESS") {
          setGen({ phase: "done", jobId, status: "SUCCESS" });
          setDoneMediaType(body.mediaType === "video" ? "video" : "image");
          setPreviewJobId(jobId);
          setBannerError(null);
          setActionError(null);
          setImageLoadError(null);
          void fetchHistory();
          setHistorySelect(jobId);
          return;
        }

        if (status === "FAILED") {
          const err =
            typeof body.errorMessage === "string"
              ? body.errorMessage
              : "Generation failed.";
          setGen({ phase: "done", jobId, status: "FAILED", errorMessage: err });
          setBannerError(err);
          void fetchHistory();
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Status poll failed";
        setGen({ phase: "done", jobId, status: "FAILED", errorMessage: msg });
        setBannerError(msg);
      }
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchHistory, gen]);

  async function handlePlan() {
    setBannerError(null);
    setActionError(null);
    setPlanLoading(true);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style,
          aspectRatio,
          qualityTier,
          mediaType,
        }),
      });
      if (!res.ok) {
        setPlan(null);
        setBannerError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as PlanSnapshot;
      setPlan(data);
      setGen({ phase: "idle" });
      setDoneMediaType(undefined);
      setPollProgress(undefined);
    } catch (e) {
      setPlan(null);
      setBannerError(e instanceof Error ? e.message : "Plan request failed.");
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleConfirmGenerate() {
    if (!plan) return;
    setBannerError(null);
    setActionError(null);
    setGenerateLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.planId }),
      });
      if (!res.ok) {
        setBannerError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { jobId?: string; status?: string };
      const jobId = typeof data.jobId === "string" ? data.jobId : "";
      if (!jobId) {
        setBannerError("No job id returned.");
        return;
      }
      setPreviewJobId(null);
      setImageLoadError(null);
      setPollProgress(0);
      setGen({ phase: "running", jobId });
    } catch (e) {
      setBannerError(e instanceof Error ? e.message : "Generate request failed.");
    } finally {
      setGenerateLoading(false);
    }
  }

  function handleEditPlan() {
    setPlan(null);
    setActionError(null);
  }

  async function handleReveal() {
    if (!previewJobId || !previewIsSuccess) return;
    setRevealLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/reveal?jobId=${encodeURIComponent(previewJobId)}`);
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionError(data.error ?? (await readErrorMessage(res)));
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not reveal folder.");
    } finally {
      setRevealLoading(false);
    }
  }

  function onHistoryPick(jobId: string) {
    setHistorySelect(jobId);
    setPreviewJobId(jobId);
    setImageLoadError(null);
  }

  const imageSrc =
    previewJobId && previewIsSuccess ?
      `/api/image?jobId=${encodeURIComponent(previewJobId)}`
    : null;

  const previewIsVideo =
    previewMeta?.mediaType === "video" ||
    (gen.phase === "done" && gen.jobId === previewJobId && doneMediaType === "video");

  const showRunning = gen.phase === "running";

  const genFailMessage =
    gen.phase === "done" && gen.status === "FAILED" ? gen.errorMessage : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] flex-col gap-8 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-col gap-1 border-b border-[color:var(--border)] pb-6">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-[color:var(--fg)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark, served as-is */}
          <img
            src="/logo.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
          />
          RunningHub Generator
        </h1>
        <p className="max-w-xl text-sm text-[color:var(--muted)]">
          NSFW-only · defaults saved in this browser (style {NSFW_DEFAULTS.style},{" "}
          {NSFW_DEFAULTS.aspectRatio}, {NSFW_DEFAULTS.qualityTier}). RunningHub has no
          switch to disable content safety on official APIs.
        </p>
      </header>

      {bannerError && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-100"
        >
          {bannerError}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: controls */}
        <section
          aria-label="Generator controls"
          className="flex flex-col gap-6 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="prompt" className="text-sm font-medium text-[color:var(--fg)]">
                Prompt
              </label>
              <span
                className={
                  charCount > PROMPT_MAX ?
                    "text-xs tabular-nums text-red-400"
                  : "text-xs tabular-nums text-[color:var(--muted)]"
                }
              >
                {charCount}/{PROMPT_MAX}
              </span>
            </div>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={12}
              maxLength={PROMPT_MAX}
              placeholder="Describe your image..."
              className="min-h-[200px] w-full resize-y rounded-xl border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--bg)_94%,transparent)] px-4 py-3 text-sm leading-relaxed text-[color:var(--fg)] outline-none placeholder:text-zinc-600 focus:border-[color:color-mix(in_oklab,var(--accent)_65%,var(--border))] focus:ring-2 focus:ring-[color:color-mix(in_oklab,var(--accent)_35%,transparent)]"
            />
          </div>

          <ChipRow label="Media" options={MEDIA_TYPES} value={mediaType} onChange={setMediaType} />

          {mediaType === "image" && (
            <ChipRow label="Style" options={STYLES} value={style} onChange={setStyle} />
          )}

          <ChipRowRatios
            label="Aspect ratio"
            options={ASPECT_RATIOS}
            value={aspectRatio}
            onChange={setAspectRatio}
          />

          <ChipRow label="Quality" options={QUALITIES} value={qualityTier} onChange={setQualityTier} />

          <button
            type="button"
            disabled={planDisabled}
            onClick={() => void handlePlan()}
            className="inline-flex items-center justify-center rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-900/40 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {planLoading ? "Planning…" : "[ Plan ]"}
          </button>
        </section>

        {/* Right: plan & result */}
        <section aria-label="Plan and results" className="flex flex-col gap-6">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
            <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border)] pb-4">
              <div>
                <h2 className="text-lg font-semibold text-[color:var(--fg)]">Execution plan</h2>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Review route, estimate, and reasoning before spending credits.
                </p>
              </div>
              {history.length > 0 && (
                <div className="flex min-w-[10rem] max-w-[14rem] flex-col gap-1">
                  <label htmlFor="history" className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                    History
                  </label>
                  <select
                    id="history"
                    value={historySelect}
                    onChange={(e) => onHistoryPick(e.target.value)}
                    className="rounded-lg border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--bg)_94%,transparent)] px-3 py-2 text-xs text-[color:var(--fg)] outline-none focus:border-[color:color-mix(in_oklab,var(--accent)_65%,var(--border))]"
                  >
                    <option value="">Select a run…</option>
                    {history.map((h) => (
                      <option key={h.jobId} value={h.jobId}>
                        {new Date(h.createdAt).toLocaleString()} — {h.status} —{" "}
                        {h.mediaType === "video" ? "video" : "image"} — {h.modelLabel.slice(0, 24)}
                        {h.modelLabel.length > 24 ? "…" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-4">
              {plan ?
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-[color:var(--fg)]">{plan.modelLabel}</p>
                    <p className="font-mono text-xs text-[color:var(--muted)]">{plan.route}</p>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--bg)_90%,transparent)] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                        Resolution / quality
                      </div>
                      <div className="mt-0.5 text-[color:var(--fg)]">
                        {plan.params.resolution} · {plan.params.quality}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--bg)_90%,transparent)] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                        Estimate
                      </div>
                      <div className="mt-0.5 font-medium tabular-nums text-[color:var(--fg)]">
                        ¥{plan.estimatedPrice.toFixed(2)} {plan.currency}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">Reason</div>
                    <p className="mt-1 text-sm leading-relaxed text-[color:var(--fg)]">{plan.reason}</p>
                  </div>
                  {plan.alternatives.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                        Alternatives
                      </div>
                      <ul className="mt-2 space-y-2">
                        {plan.alternatives.map((a) => (
                          <li
                            key={`${a.modelId}-${a.route}`}
                            className="rounded-lg border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--bg)_88%,transparent)] px-3 py-2 text-xs text-[color:var(--muted)]"
                          >
                            <span className="font-medium text-[color:var(--fg)]">{a.modelLabel}</span>
                            <span className="mx-2 text-zinc-600">·</span>
                            <span className="tabular-nums">¥{a.estimatedPrice.toFixed(2)}</span>
                            <div className="mt-1 font-mono text-[10px] text-zinc-500">{a.route}</div>
                            <div className="mt-1 text-[11px]">{a.reason}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              : <p className="text-sm text-[color:var(--muted)]">Run Plan to see model, price, and routing.</p>}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!plan || generateLoading || showRunning}
                onClick={() => void handleConfirmGenerate()}
                className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-xl border border-transparent bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-40 sm:flex-none"
              >
                {generateLoading ? "Starting…" : "[ Confirm Generate ]"}
              </button>
              <button
                type="button"
                onClick={handleEditPlan}
                disabled={!plan || showRunning}
                className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-xl border border-[color:var(--border)] px-4 py-2.5 text-sm font-medium text-[color:var(--fg)] transition hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40 sm:flex-none"
              >
                [ Edit plan ]
              </button>
            </div>

            {(showRunning || genFailMessage) && (
              <div className="mt-6 rounded-xl border border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--bg)_92%,transparent)] p-4">
                {showRunning && (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs text-[color:var(--muted)]">
                      <span>Generating…</span>
                      <span className="tabular-nums">{pollProgress ?? 0}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, pollProgress ?? 0))}%` }}
                      />
                    </div>
                    <p className="mt-3 text-[11px] text-[color:var(--muted)]">
                      Checking status every {POLL_MS / 1000}s (server-side polling cap applies).
                    </p>
                  </>
                )}
                {!showRunning && genFailMessage && (
                  <div role="alert" className="text-sm text-red-300">
                    {genFailMessage}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
            <h3 className="text-sm font-semibold text-[color:var(--fg)]">Output</h3>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Preview streams from{' '}
              <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[10px]">
                /api/image
              </code>
              ; download PNG or reveal the local folder after success (macOS).
            </p>

            <div className="mt-4 flex min-h-[220px] items-center justify-center overflow-hidden rounded-xl border border-dashed border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--bg)_95%,transparent)]">
              {showRunning && !previewJobId && (
                <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-[color:var(--muted)]">
                  <div
                    className="h-10 w-10 animate-spin rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)]"
                    aria-hidden
                  />
                  <span>Working on your {mediaType === "video" ? "video" : "image"}…</span>
                </div>
              )}
              {imageSrc && previewIsVideo && (
                <video
                  key={previewJobId ?? undefined}
                  src={imageSrc}
                  controls
                  playsInline
                  className="max-h-[min(70vh,520px)] w-full object-contain"
                />
              )}
              {imageSrc && !previewIsVideo && (
                // eslint-disable-next-line @next/next/no-img-element -- same-origin PNG from /api/image
                <img
                  key={previewJobId ?? undefined}
                  src={imageSrc}
                  alt="Generated output"
                  className="max-h-[min(70vh,520px)] w-full object-contain"
                  onLoad={() => setImageLoadError(null)}
                  onError={() => setImageLoadError("Could not load image for this job (missing or failed run).")}
                />
              )}
              {!showRunning && !imageSrc && !previewJobId && (
                <span className="px-6 text-center text-sm text-[color:var(--muted)]">
                  No preview yet. Plan, generate, or pick from history.
                </span>
              )}
            </div>

            {imageLoadError && (
              <div role="alert" className="mt-3 text-sm text-red-300">
                {imageLoadError}
              </div>
            )}

            {actionError && (
              <div role="alert" className="mt-3 text-sm text-amber-200">
                {actionError}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              {previewJobId && previewIsSuccess ?
                <>
                  <a
                    href={`/api/image?jobId=${encodeURIComponent(previewJobId)}`}
                    download={`runninghub-${previewJobId}.${previewIsVideo ? "mp4" : "png"}`}
                    className="inline-flex items-center justify-center rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    [ Download ]
                  </a>
                  <button
                    type="button"
                    disabled={revealLoading}
                    onClick={() => void handleReveal()}
                    className="inline-flex items-center justify-center rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm font-medium text-[color:var(--fg)] transition hover:bg-white/5 disabled:opacity-40"
                  >
                    {revealLoading ? "Opening…" : "[ Open folder ]"}
                  </button>
                </>
              : <span className="text-xs text-[color:var(--muted)]">
                  Download / reveal unlock after a successful generation (or selecting a SUCCESS history item).
                </span>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
