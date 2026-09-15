import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { randomUUID } from "node:crypto";

type Language = "javascript" | "python";

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 200_000;

// Resolve a concrete Python interpreter on PATH once at module load, rather
// than trusting a bare "python"/"python3" command name per request. On
// Windows, the first "python" on PATH is often the App Execution Alias for
// the Python install manager — invoking it on a script can silently trigger
// an interactive download/install instead of just running the code, which
// burns the whole execution timeout. Skip that stub and prefer a real,
// already-installed interpreter when one is found on PATH.
function resolvePythonCommand(): string {
  const candidateNames =
    process.platform === "win32" ? ["python.exe", "python3.exe"] : ["python3", "python"];
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    if (process.platform === "win32" && /\\WindowsApps\\?$/i.test(dir)) continue;
    for (const name of candidateNames) {
      const full = join(dir, name);
      if (existsSync(full)) return full;
    }
  }

  return process.platform === "win32" ? "python" : "python3";
}

const PYTHON_COMMAND = resolvePythonCommand();

const RUNNERS: Record<
  Language,
  { extension: string; command: (filePath: string) => { cmd: string; args: string[] } }
> = {
  javascript: {
    extension: "js",
    // Reuse the same Node binary that's running the server instead of
    // trusting a "node" entry on PATH.
    command: (filePath) => ({ cmd: process.execPath, args: [filePath] }),
  },
  python: {
    extension: "py",
    command: (filePath) => ({ cmd: PYTHON_COMMAND, args: [filePath] }),
  },
};

// Only pass through what the interpreter needs to resolve itself — never the
// full process env, since that would leak server secrets (e.g. GROQ_API_KEY)
// to arbitrary user-submitted code.
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: process.env.NODE_ENV,
  };
  if (process.platform === "win32") {
    env.SystemRoot = process.env.SystemRoot;
    env.PATHEXT = process.env.PATHEXT;
    env.ComSpec = process.env.ComSpec;
  }
  return env;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function runProcess(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false, env: childEnv() });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const appendCapped = (current: string, chunk: Buffer) => {
      if (current.length >= MAX_OUTPUT_CHARS) return current;
      const next = current + chunk.toString("utf8");
      if (next.length > MAX_OUTPUT_CHARS) {
        child.kill("SIGKILL");
        return `${next.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`;
      }
      return next;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr || err.message, exitCode: null, timedOut });
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

export async function POST(req: NextRequest) {
  let workDir: string | null = null;

  try {
    const { code, language } = await req.json();

    if (typeof code !== "string" || typeof language !== "string") {
      return NextResponse.json(
        { error: "Request must include `code` and `language` strings." },
        { status: 400 }
      );
    }

    const runner = RUNNERS[language as Language];
    if (!runner) {
      return NextResponse.json(
        { error: `Unsupported language: ${language}` },
        { status: 400 }
      );
    }

    workDir = await mkdtemp(join(tmpdir(), "hackrepl-"));
    const filePath = join(workDir, `snippet-${randomUUID()}.${runner.extension}`);
    await writeFile(filePath, code, "utf8");

    const { cmd, args } = runner.command(filePath);
    const { stdout, stderr, exitCode, timedOut } = await runProcess(cmd, args, workDir);

    if (timedOut) {
      return NextResponse.json(
        { error: `Execution timed out after ${TIMEOUT_MS / 1000}s.` },
        { status: 408 }
      );
    }

    const output = stdout || stderr || `Process finished with exit code ${exitCode}`;
    return NextResponse.json({ output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
