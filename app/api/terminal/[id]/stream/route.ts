import { NextRequest, NextResponse } from "next/server";
import { getTerminalSession } from "@/lib/terminal-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getTerminalSession(id);
  if (!session) {
    return NextResponse.json({ error: "Terminal session not found", code: "not_found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubData: (() => void) | null = null;
  let unsubExit: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send historical buffer on connect
      const history = session.getHistory();
      if (history) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "output", data: history })}\n\n`));
      }

      unsubData = session.onData((chunk) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "output", data: chunk })}\n\n`));
        } catch {
          // Controller might be closed
        }
      });

      unsubExit = session.onExit((code) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "exit", code })}\n\n`));
          controller.close();
        } catch {
          // Controller might be closed
        }
      });
    },
    cancel() {
      if (unsubData) unsubData();
      if (unsubExit) unsubExit();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
