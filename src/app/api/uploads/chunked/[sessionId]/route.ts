import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const CHUNK_DIR = path.join(UPLOAD_DIR, ".chunks");

function safeSessionId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!safeSessionId(sessionId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const sessionDir = path.join(CHUNK_DIR, sessionId);
  const metaRaw = await fs.readFile(path.join(sessionDir, "session.json"), "utf8").catch(() => null);
  if (!metaRaw) return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  const meta = JSON.parse(metaRaw) as { totalChunks: number };

  const form = await req.formData();
  const chunk = form.get("chunk");
  const index = Number(form.get("index"));
  if (!(chunk instanceof File)) {
    return NextResponse.json({ error: "Missing chunk" }, { status: 400 });
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= meta.totalChunks) {
    return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
  }

  const buf = Buffer.from(await chunk.arrayBuffer());
  await fs.writeFile(path.join(sessionDir, `${index}.part`), buf);
  return NextResponse.json({ ok: true, index });
}
