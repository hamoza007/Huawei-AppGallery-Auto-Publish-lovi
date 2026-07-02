import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const CHUNK_DIR = path.join(UPLOAD_DIR, ".chunks");

function safeSessionId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!safeSessionId(sessionId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const sessionDir = path.join(CHUNK_DIR, sessionId);
  const metaRaw = await fs.readFile(path.join(sessionDir, "session.json"), "utf8").catch(() => null);
  if (!metaRaw) return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  const meta = JSON.parse(metaRaw) as {
    filename: string;
    fileSize: number;
    totalChunks: number;
    huaweiAppId: string | null;
    screenshotSource: string;
    metadataPrompt: string | null;
    screenshotPrompt: string | null;
  };

  for (let i = 0; i < meta.totalChunks; i += 1) {
    await fs.access(path.join(sessionDir, `${i}.part`)).catch(() => {
      throw new Error(`Missing chunk ${i + 1}/${meta.totalChunks}`);
    });
  }

  const upload = await prisma.upload.create({
    data: {
      huaweiAppId: meta.huaweiAppId,
      filename: meta.filename,
      apkPath: "",
      apkSize: BigInt(meta.fileSize),
      metadataPrompt: meta.metadataPrompt,
      screenshotPrompt: meta.screenshotPrompt,
      screenshotSource: meta.screenshotSource,
      autoCreateApp: !meta.huaweiAppId,
    },
  });

  const uploadDir = path.join(UPLOAD_DIR, upload.id);
  await fs.mkdir(uploadDir, { recursive: true });
  const apkPath = path.join(uploadDir, meta.filename);
  const out = await fs.open(apkPath, "w");
  const hash = crypto.createHash("sha256");
  let written = 0;

  try {
    for (let i = 0; i < meta.totalChunks; i += 1) {
      const chunk = await fs.readFile(path.join(sessionDir, `${i}.part`));
      hash.update(chunk);
      written += chunk.byteLength;
      await out.write(chunk);
    }
  } finally {
    await out.close();
  }

  if (written !== meta.fileSize) {
    await prisma.upload.delete({ where: { id: upload.id } }).catch(() => undefined);
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
    return NextResponse.json({ error: "Merged file size mismatch" }, { status: 400 });
  }

  await prisma.upload.update({
    where: { id: upload.id },
    data: { apkPath, apkSha256: hash.digest("hex") },
  });
  await prisma.job.create({
    data: { uploadId: upload.id, kind: "PARSE_APK", status: "QUEUED" },
  });
  await prisma.uploadEvent.create({
    data: { uploadId: upload.id, level: "info", message: "Chunked upload received; queued for parsing" },
  });
  await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);

  return NextResponse.json({ id: upload.id });
}
