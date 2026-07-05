// Run only the Huawei console-fallback steps (category, countries, content
// rating, personal data, AI, release time, submit) without re-doing the API
// steps that already succeeded. Useful when the API portion is done but the
// console-only fields are still pending.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveAppTemplate } from "@/lib/app-template";
import {
  runConsoleFlow,
  consoleAutomationEnabled,
  profileExists,
  type CategorySelection,
} from "@/lib/huawei-console";

export const runtime = "nodejs";

function categoryFromTemplate(t: {
  parentType?: number;
  childType?: number;
  grandChildType?: number;
  isGameCasual?: boolean;
}): CategorySelection | undefined {
  const parentLabel = process.env.HUAWEI_CATEGORY_PARENT_LABEL || "Games";
  const childLabel = process.env.HUAWEI_CATEGORY_CHILD_LABEL || "Role-playing";
  const grandChildLabel = process.env.HUAWEI_CATEGORY_GRAND_LABEL || "Incremental games";
  const extraTag =
    t.isGameCasual === false ? undefined : process.env.HUAWEI_CATEGORY_EXTRA_TAG || "Casual game";
  return { parent: parentLabel, child: childLabel, grandChild: grandChildLabel, extraTag };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const upload = await prisma.upload.findUnique({
    where: { id },
    include: { huaweiApp: true },
  });
  if (!upload || !upload.huaweiApp) {
    return NextResponse.json({ error: "Upload or linked Huawei app not found" }, { status: 404 });
  }

  if (!consoleAutomationEnabled()) {
    return NextResponse.json(
      { error: "HUAWEI_CONSOLE_AUTOMATION is disabled on this host" },
      { status: 400 },
    );
  }
  if (!process.env.HUAWEI_CDP_URL && !(await profileExists())) {
    return NextResponse.json(
      {
        error:
          `No persistent Chromium profile at ${process.env.HUAWEI_PROFILE_DIR || "/opt/huawei-profile"}. ` +
          `Run \`npx tsx scripts/huawei-login.ts\` on the host first.`,
      },
      { status: 400 },
    );
  }

  const template = await resolveAppTemplate();
  const which = url.searchParams.get("steps") ?? "all";
  const wantsAll = which === "all";
  const wants = new Set(which.split(",").map((s) => s.trim()));

  const enable = (key: string) => wantsAll || wants.has(key);

  const flow = {
    category: enable("category") ? categoryFromTemplate(template) : undefined,
    setCountries: enable("countries"),
    setContentRating: enable("rating") || enable("content-rating"),
    setPersonalData: enable("personal-data"),
    setAi: enable("ai"),
    setReleaseTime: enable("release-time"),
    submit: enable("submit"),
    onLog: async (line: string) => {
      await prisma.uploadEvent.create({
        data: { uploadId: id, level: "info", message: `[console] ${line}` },
      });
    },
  };

  try {
    const results = await runConsoleFlow(upload.huaweiApp.agcAppId, flow);
    await prisma.uploadEvent.create({
      data: {
        uploadId: id,
        level: results.every((r) => r.ok) ? "info" : "warn",
        message: `Console fallback: ${results.map((r) => `${r.step}=${r.ok ? "ok" : "fail"}`).join(", ")}`,
      },
    });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const message = (err as Error).message;
    await prisma.uploadEvent.create({
      data: { uploadId: id, level: "error", message: `Console fallback failed: ${message}` },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
