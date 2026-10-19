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
    if (typeof body?.data !== "string") {
      return NextResponse.json({ error: "data must be a string", code: "invalid_data" }, { status: 400 });
    }

    const written = session.write(body.data);
    return NextResponse.json({ success: written });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
