import { NextRequest, NextResponse } from "next/server";
import { getTerminalSession } from "@/lib/terminal-manager";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getTerminalSession(id);
  if (!session) {
    return NextResponse.json({ error: "Terminal session not found", code: "not_found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const cols = typeof body?.cols === "number" ? body.cols : session.cols;
    const rows = typeof body?.rows === "number" ? body.rows : session.rows;

    const resized = session.resize(cols, rows);
    return NextResponse.json({ success: resized, cols, rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
