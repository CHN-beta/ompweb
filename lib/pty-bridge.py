#!/usr/bin/env python3
"""
Lightweight, zero-native-dependency POSIX PTY bridge for omp-web.
Communicates with Node.js parent via JSON lines over stdio.
"""

import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios


def set_winsize(fd: int, rows: int, cols: int):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except Exception:
        pass


def send_msg(msg: dict):
    line = json.dumps(msg, ensure_ascii=False) + "\n"
    sys.stdout.write(line)
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description="POSIX PTY bridge")
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--shell", default=os.environ.get("SHELL", "/bin/bash"))
    parser.add_argument("--cols", type=int, default=80)
    parser.add_argument("--rows", type=int, default=24)
    args = parser.parse_args()

    shell = args.shell
    if not os.path.isfile(shell) or not os.access(shell, os.X_OK):
        shell = "/bin/sh"

    cwd = args.cwd
    if not os.path.isdir(cwd):
        cwd = os.path.expanduser("~")

    # Inherit environment with terminal attributes
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"

    # Allocate pseudo-terminal
    master_fd, slave_fd = pty.openpty()
    set_winsize(slave_fd, args.rows, args.cols)

    try:
        proc = subprocess.Popen(
            [shell, "-i"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=cwd,
            env=env,
            close_fds=True,
            preexec_fn=os.setsid,
        )
    finally:
        os.close(slave_fd)

    send_msg({"type": "ready", "pid": proc.pid})

    stdin_fd = sys.stdin.fileno()
    stdin_buf = ""

    running = True
    while running:
        rlist, _, _ = select.select([master_fd, stdin_fd], [], [])

        # Data from PTY (shell output)
        if master_fd in rlist:
            try:
                data = os.read(master_fd, 4096)
                if not data:
                    break
                text = data.decode("utf-8", errors="replace")
                send_msg({"type": "output", "data": text})
            except OSError:
                # EIO typically happens on Linux when slave closes
                break

        # Data from Node.js (commands & user input)
        if stdin_fd in rlist:
            try:
                raw_chunk = os.read(stdin_fd, 4096)
                if not raw_chunk:
                    break
                chunk = raw_chunk.decode("utf-8", errors="replace")
            except OSError:
                break
            stdin_buf += chunk
            while "\n" in stdin_buf:
                line, stdin_buf = stdin_buf.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    cmd = json.loads(line)
                    cmd_type = cmd.get("type")
                    if cmd_type == "input":
                        data_to_write = cmd.get("data", "").encode("utf-8")
                        os.write(master_fd, data_to_write)
                    elif cmd_type == "resize":
                        rows = int(cmd.get("rows", 24))
                        cols = int(cmd.get("cols", 80))
                        set_winsize(master_fd, rows, cols)
                    elif cmd_type == "kill":
                        running = False
                        break
                except Exception as e:
                    pass

    # Clean up process
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        pass

    try:
        proc.wait(timeout=1.0)
    except Exception:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            pass

    code = proc.poll() or 0
    send_msg({"type": "exit", "code": code})
    os.close(master_fd)


if __name__ == "__main__":
    main()
