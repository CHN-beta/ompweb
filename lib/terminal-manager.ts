import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { createChildProcessEnvironment } from "./project-command-env";

export interface TerminalSessionInfo {
  id: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActiveAt: number;
}

export class TerminalSession {
  readonly id: string;
  pid: number = 0;
  readonly cwd: string;
  cols: number;
  rows: number;
  readonly createdAt: number;
  lastActiveAt: number;

  private child: ChildProcess;
  private buffer: string[] = [];
  private totalBufferBytes: number = 0;
  private static readonly MAX_BUFFER_BYTES = 256 * 1024; // 256KB history
  private dataListeners: Set<(chunk: string) => void> = new Set();
  private exitListeners: Set<(code: number) => void> = new Set();
  private isExited: boolean = false;
  private exitCode: number = 0;

  constructor({
    id,
    cwd,
    cols = 80,
    rows = 24,
    shell,
  }: {
    id: string;
    cwd: string;
    cols?: number;
    rows?: number;
    shell?: string;
  }) {
    this.id = id;
    this.cwd = cwd;
    this.cols = cols;
    this.rows = rows;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();

    const bridgeScript = path.resolve(process.cwd(), "lib", "pty-bridge.py");
    const chosenShell = shell || process.env.SHELL || "/bin/bash";

    const env = createChildProcessEnvironment({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });

    this.child = spawn(
      "python3",
      [
        bridgeScript,
        "--cwd",
        this.cwd,
        "--cols",
        String(this.cols),
        "--rows",
        String(this.rows),
        "--shell",
        chosenShell,
      ],
      {
        stdio: ["pipe", "pipe", "inherit"],
        env,
      }
    );

    let stdoutBuffer = "";

    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      while (stdoutBuffer.includes("\n")) {
        const lineEnd = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, lineEnd).trim();
        stdoutBuffer = stdoutBuffer.slice(lineEnd + 1);

        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "ready") {
            this.pid = msg.pid;
          } else if (msg.type === "output") {
            const data = msg.data as string;
            this.handleOutput(data);
          } else if (msg.type === "exit") {
            this.handleExit(msg.code ?? 0);
          }
        } catch {
          // Non-JSON output
        }
      }
    });

    this.child.on("close", (code) => {
      this.handleExit(code ?? 0);
    });

    this.child.on("error", () => {
      this.handleExit(1);
    });
  }

  private handleOutput(data: string) {
    this.lastActiveAt = Date.now();
    this.buffer.push(data);
    this.totalBufferBytes += data.length;

    while (this.totalBufferBytes > TerminalSession.MAX_BUFFER_BYTES && this.buffer.length > 1) {
      const removed = this.buffer.shift();
      if (removed) this.totalBufferBytes -= removed.length;
    }

    for (const listener of this.dataListeners) {
      try {
        listener(data);
      } catch {
        // Listener error ignored
      }
    }
  }

  private handleExit(code: number) {
    if (this.isExited) return;
    this.isExited = true;
    this.exitCode = code;

    for (const listener of this.exitListeners) {
      try {
        listener(code);
      } catch {
        // Listener error ignored
      }
    }
    this.dataListeners.clear();
    this.exitListeners.clear();
  }

  write(data: string): boolean {
    if (this.isExited || !this.child.stdin || !this.child.stdin.writable) return false;
    this.lastActiveAt = Date.now();
    const payload = JSON.stringify({ type: "input", data }) + "\n";
    this.child.stdin.write(payload);
    return true;
  }

  resize(cols: number, rows: number): boolean {
    if (this.isExited || !this.child.stdin || !this.child.stdin.writable) return false;
    this.cols = cols;
    this.rows = rows;
    this.lastActiveAt = Date.now();
    const payload = JSON.stringify({ type: "resize", cols, rows }) + "\n";
    this.child.stdin.write(payload);
    return true;
  }

  kill(): void {
    if (this.isExited) return;
    try {
      if (this.child.stdin && this.child.stdin.writable) {
        this.child.stdin.write(JSON.stringify({ type: "kill" }) + "\n");
      }
    } catch {
      // Ignore
    }
    try {
      this.child.kill();
    } catch {
      // Ignore
    }
  }

  getHistory(): string {
    return this.buffer.join("");
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onExit(listener: (code: number) => void): () => void {
    if (this.isExited) {
      listener(this.exitCode);
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  getInfo(): TerminalSessionInfo {
    return {
      id: this.id,
      pid: this.pid,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
    };
  }
}

declare global {
  var __ompWebTerminalSessions: Map<string, TerminalSession> | undefined;
}

function getSessionMap(): Map<string, TerminalSession> {
  if (!globalThis.__ompWebTerminalSessions) {
    globalThis.__ompWebTerminalSessions = new Map();
  }
  return globalThis.__ompWebTerminalSessions;
}

export function createTerminalSession({
  cwd,
  cols = 80,
  rows = 24,
  shell,
}: {
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
} = {}): TerminalSession {
  const map = getSessionMap();

  const id = `term_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const effectiveCwd = cwd && fs.existsSync(cwd) ? cwd : process.cwd();

  const session = new TerminalSession({
    id,
    cwd: effectiveCwd,
    cols,
    rows,
    shell,
  });

  map.set(id, session);

  session.onExit(() => {
    // Keep in map for 10 seconds so disconnect/exit info can be read, then clean up
    setTimeout(() => {
      map.delete(id);
    }, 10_000);
  });

  return session;
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return getSessionMap().get(id);
}

export function listTerminalSessions(): TerminalSessionInfo[] {
  return Array.from(getSessionMap().values()).map((s) => s.getInfo());
}

export function killTerminalSession(id: string): boolean {
  const session = getSessionMap().get(id);
  if (!session) return false;
  session.kill();
  getSessionMap().delete(id);
  return true;
}
