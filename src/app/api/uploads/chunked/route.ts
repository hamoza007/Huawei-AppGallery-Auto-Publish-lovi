import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const CHUNK_DIR = path.join(UPLOAD_DIR, ".chunks");
const MAX_APK_BYTES = 500 * 1024 * 1024;

function cleanFilename(name: string) {
  return path.basename(name).replace(/[^\w.\-()[\] ]+/g, "_");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    filename?: string;
    fileSize?: number;
    totalChunks?: number;
    huaweiAppId?: string | null;
    screenshotSource?: string;
    metadataPrompt?: string;
    screenshotPrompt?: string;
  } | null;

  const filename = cleanFilename(body?.filename ?? "");
  const fileSize = Number(body?.fileSize ?? 0);
  const totalChunks = Number(body?.totalChunks ?? 0);
  const huaweiAppId = body?.huaweiAppId?.trim() || null;
  const rawSource = (body?.screenshotSource ?? "vmos").trim();
  const screenshotSource = ["vmos", "ai_openai", "ai_gemini", "template"].includes(rawSource)
    ? rawSource
    : "vmos";

  if (!filename.toLowerCase().endsWith(".apk")) {
    return NextResponse.json({ error: "Only .apk files are accepted" }, { status: 400 });
  }
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_APK_BYTES) {
    return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
  }
  if (!Number.isSafeInteger(totalChunks) || totalChunks <= 0 || totalChunks > 200) {
    return NextResponse.json({ error: "Invalid chunk count" }, { status: 400 });
  }
  if (huaweiAppId) {
    const exists = await prisma.huaweiApp.findUnique({ where: { id: huaweiAppId } });
    if (!exists) return NextResponse.json({ error: "Unknown huaweiAppId" }, { status: 400 });
  }

  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(CHUNK_DIR, sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, "session.json"),
    JSON.stringify({
      filename,
      fileSize,
      totalChunks,
      huaweiAppId,
      screenshotSource,
      metadataPrompt: body?.metadataPrompt?.trim() || null,
      screenshotPrompt: body?.screenshotPrompt?.trim() || null,
      createdAt: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ sessionId });
}
