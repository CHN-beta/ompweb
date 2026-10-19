import { NextRequest, NextResponse } from "next/server";
import { getTerminalSession, killTerminalSession } from "@/lib/terminal-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getTerminalSession(id);
  if (!session) {
    return NextResponse.json({ error: "Terminal session not found", code: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    terminal: session.getInfo(),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const killed = killTerminalSession(id);
  return NextResponse.json({ success: killed });
}
