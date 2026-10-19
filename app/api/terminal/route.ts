import { NextRequest, NextResponse } from "next/server";
import {
  createTerminalSession,
  listTerminalSessions,
} from "@/lib/terminal-manager";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";

export async function GET() {
  return NextResponse.json({
    terminals: listTerminalSessions(),
  });
}

export async function POST(request: NextRequest) {
  try {
    let body: { cwd?: string; cols?: number; rows?: number; shell?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }

    const targetCwd = body.cwd;
    if (targetCwd) {
      const allowedRoots = await getAllowedFileRoots();
      if (!isFilePathAllowed(targetCwd, allowedRoots)) {
        return NextResponse.json({ error: "Working directory access denied", code: "access_denied" }, { status: 403 });
      }
    }

    const session = createTerminalSession({
      cwd: targetCwd,
      cols: typeof body.cols === "number" ? body.cols : 80,
      rows: typeof body.rows === "number" ? body.rows : 24,
      shell: body.shell,
    });

    return NextResponse.json({
      terminal: session.getInfo(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
