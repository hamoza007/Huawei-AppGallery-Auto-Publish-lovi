// Thin Node wrapper around the Fastlane lanes in `fastlane_runner/`.
//
// This is the single integration point with Huawei AppGallery Connect: every
// publish/localization/app-id call shells out to `bundle exec fastlane <lane>`,
// which in turn calls the shr3jn/fastlane-plugin-huawei_appgallery_connect
// actions. We deliberately do NOT hand-roll the AppGallery API here.
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

// Directory that holds Gemfile + fastlane/Fastfile + fastlane/Pluginfile.
function runnerDir(): string {
  return process.env.FASTLANE_DIR || path.join(process.cwd(), "fastlane_runner");
}

export interface FastlaneCredentials {
  clientId: string;
  clientSecret: string;
}

export function huaweiCredsFromEnv(): FastlaneCredentials {
  const clientId = process.env.HUAWEI_AGC_CLIENT_ID;
  const clientSecret = process.env.HUAWEI_AGC_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Huawei credentials: set HUAWEI_AGC_CLIENT_ID and HUAWEI_AGC_CLIENT_SECRET " +
        "(AppGallery Connect → Users and permissions → Connect API).",
    );
  }
  return { clientId, clientSecret };
}

export interface RunLaneOptions {
  // Lane parameters passed as `key:value` on the fastlane CLI. Free text is
  // never passed here — long/localized text is written to files instead.
  params?: Record<string, string | number | boolean | undefined | null>;
  creds?: FastlaneCredentials;
  // Per-call timeout (uploads of large APKs can take a while).
  timeoutMs?: number;
  onLog?: (line: string) => void | Promise<void>;
}

export interface LaneResult<T = Record<string, unknown>> {
  result: T;
  stdout: string;
  stderr: string;
}

// Run a single fastlane lane and return its JSON result (written by the lane to
// the `out:` file). Throws with the tail of fastlane output on failure.
export async function runLane<T = Record<string, unknown>>(
  lane: string,
  opts: RunLaneOptions = {},
): Promise<LaneResult<T>> {
  const creds = opts.creds ?? huaweiCredsFromEnv();
  const dir = runnerDir();
  const outFile = path.join(os.tmpdir(), `fastlane-${lane}-${randomUUID()}.json`);

  const args: string[] = [lane, `out:${outFile}`];
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    args.push(`${k}:${String(v)}`);
  }

  const useBundler = process.env.FASTLANE_USE_BUNDLER !== "0";
  const bin = useBundler ? "bundle" : process.env.FASTLANE_BIN || "fastlane";
  const spawnArgs = useBundler ? ["exec", "fastlane", ...args] : args;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HUAWEI_AGC_CLIENT_ID: creds.clientId,
    HUAWEI_AGC_CLIENT_SECRET: creds.clientSecret,
    FASTLANE_DISABLE_COLORS: "1",
    FASTLANE_SKIP_UPDATE_CHECK: "1",
    FASTLANE_OPT_OUT_USAGE: "1",
    SKIP_SLOW_FASTLANE_WARNING: "1",
    CI: "1",
    LANG: process.env.LANG || "en_US.UTF-8",
  };

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, spawnArgs, { cwd: dir, env });
    let killed = false;
    const timeout = setTimeout(
      () => {
        killed = true;
        child.kill("SIGKILL");
      },
      opts.timeoutMs ?? 30 * 60 * 1000,
    );

    let lineBuf = "";
    const handleData = (buf: Buffer, sink: string[]) => {
      const text = buf.toString();
      sink.push(text);
      if (opts.onLog) {
        lineBuf += text;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) void opts.onLog(trimmed);
        }
      }
    };
    child.stdout.on("data", (b) => handleData(b, stdoutChunks));
    child.stderr.on("data", (b) => handleData(b, stderrChunks));

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn fastlane (${bin}): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (killed) return reject(new Error(`fastlane lane "${lane}" timed out`));
      if (code !== 0) {
        const tail = (stderrChunks.join("") + stdoutChunks.join("")).slice(-1500);
        return reject(new Error(`fastlane lane "${lane}" failed (exit ${code}):\n${tail}`));
      }
      resolve();
    });
  });

  const stdout = stdoutChunks.join("");
  const stderr = stderrChunks.join("");

  let result = {} as T;
  try {
    const raw = await fs.readFile(outFile, "utf8");
    result = JSON.parse(raw) as T;
  } catch {
    // Lane completed but produced no machine-readable result file.
  } finally {
    await fs.rm(outFile, { force: true }).catch(() => {});
  }

  return { result, stdout, stderr };
}

// ---------------------- High-level helpers ----------------------

export async function resolveAppId(
  packageId: string,
  opts?: Pick<RunLaneOptions, "creds" | "onLog">,
): Promise<string | null> {
  const { result, stdout, stderr } = await runLane<{ app_id?: string | null | boolean }>("get_app_id", {
    params: { package_id: packageId },
    timeoutMs: 5 * 60 * 1000,
    ...opts,
  });
  const raw = result?.app_id == null ? "" : String(result.app_id).trim();
  if (/^\d+$/.test(raw)) return raw;

  const output = `${stdout}\n${stderr}`;
  const match = output.match(/RESOLVED_APP_ID=(\d+)/);
  if (match) return match[1];

  await opts?.onLog?.(
    raw
      ? `Ignoring invalid get_app_id result "${raw}" for package ${packageId}`
      : `No numeric AGC app_id found for package ${packageId}`,
  );
  return null;
}

export interface PublishParams {
  appId: string;
  apkPath: string;
  isAab?: boolean;
  submitForReview?: boolean;
  privacyPolicyUrl?: string;
  changelogPath?: string;
  delayBeforeSubmitForReview?: number;
  releaseTime?: string;
  // Phased rollout
  phaseWiseRelease?: boolean;
  phaseReleaseStartTime?: string;
  phaseReleaseEndTime?: string;
  phaseReleasePercent?: string;
  phaseReleaseDescription?: string;
  // Open testing
  useTestingVersion?: boolean;
  skipManualReview?: boolean;
  testStartTime?: string;
  testEndTime?: string;
  feedbackEmail?: string;
}

export async function publishApk(
  p: PublishParams,
  opts?: Pick<RunLaneOptions, "creds" | "onLog">,
): Promise<void> {
  await runLane("publish", {
    params: {
      app_id: p.appId,
      apk_path: p.apkPath,
      is_aab: p.isAab,
      submit_for_review: p.submitForReview,
      privacy_policy_url: p.privacyPolicyUrl,
      changelog_path: p.changelogPath,
      delay_before_submit_for_review: p.delayBeforeSubmitForReview,
      release_time: p.releaseTime,
      phase_wise_release: p.phaseWiseRelease,
      phase_release_start_time: p.phaseReleaseStartTime,
      phase_release_end_time: p.phaseReleaseEndTime,
      phase_release_percent: p.phaseReleasePercent,
      phase_release_description: p.phaseReleaseDescription,
      use_testing_version: p.useTestingVersion,
      skip_manual_review: p.skipManualReview,
      test_start_time: p.testStartTime,
      test_end_time: p.testEndTime,
      feedback_email: p.feedbackEmail,
    },
    timeoutMs: 45 * 60 * 1000,
    ...opts,
  });
}

export async function updateLocalization(
  appId: string,
  metadataPath: string,
  opts?: Pick<RunLaneOptions, "creds" | "onLog">,
): Promise<void> {
  await runLane("update_localization", {
    params: { app_id: appId, metadata_path: metadataPath },
    timeoutMs: 15 * 60 * 1000,
    ...opts,
  });
}

export async function submitForReview(
  appId: string,
  opts?: Pick<RunLaneOptions, "creds" | "onLog">,
): Promise<void> {
  await runLane("submit_for_review", {
    params: { app_id: appId },
    timeoutMs: 15 * 60 * 1000,
    ...opts,
  });
}

export async function setGmsDependency(
  appId: string,
  gmsDependency: 0 | 1,
  opts?: Pick<RunLaneOptions, "creds" | "onLog">,
): Promise<void> {
  await runLane("set_gms_dependency", {
    params: { app_id: appId, gms_dependency: gmsDependency },
    ...opts,
  });
}
