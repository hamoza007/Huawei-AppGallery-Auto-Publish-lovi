import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/**
 * POST /api/uploads/chunked/[sessionId]
 * Upload a single chunk.
 * FormData: { chunk: File, index: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const sessionDir = path.join(UPLOAD_DIR, "_chunks", sessionId);

  // Verify session exists
  try {
    await fs.access(path.join(sessionDir, "_meta.json"));
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 404 });
  }

  const form = await req.formData();
  const chunk = form.get("chunk");
  const indexStr = form.get("index");

  if (!(chunk instanceof File) || indexStr === null) {
    return NextResponse.json({ error: "Missing chunk or index" }, { status: 400 });
  }

  const index = Number(indexStr);
  if (!Number.isFinite(index) || index < 0) {
    return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
  }

  const buf = Buffer.from(await chunk.arrayBuffer());
  await fs.writeFile(path.join(sessionDir, `chunk_${index}`), buf);

  return NextResponse.json({ ok: true, index, size: buf.byteLength });
}
