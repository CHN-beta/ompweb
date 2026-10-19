import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@/": new URL("../", import.meta.url).pathname },
});

async function loadManager() {
  return jiti.import("./terminal-manager.ts");
}

test("terminal manager lifecycle: spawn, write, receive output, and kill", async () => {
  const { createTerminalSession, getTerminalSession, listTerminalSessions, killTerminalSession } =
    await loadManager();

  const session = createTerminalSession({
    cols: 80,
    rows: 24,
  });

  assert.ok(session.id.startsWith("term_"));
  assert.equal(getTerminalSession(session.id), session);

  const initialList = listTerminalSessions();
  assert.ok(initialList.some((t) => t.id === session.id));

  // Listen for output
  let received = "";
  const donePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for terminal output")), 6000);

    session.onData((data) => {
      received += data;
      if (received.includes("HELLO_TERMINAL_TEST")) {
        clearTimeout(timer);
        resolve(received);
      }
    });
  });

  // Write a command
  session.write("echo HELLO_TERMINAL_TEST\n");

  await donePromise;
  assert.ok(received.includes("HELLO_TERMINAL_TEST"));

  // Resize
  const resized = session.resize(100, 30);
  assert.equal(resized, true);
  assert.equal(session.cols, 100);
  assert.equal(session.rows, 30);

  // Kill
  const killed = killTerminalSession(session.id);
  assert.equal(killed, true);
});
