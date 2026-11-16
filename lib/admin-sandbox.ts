import { Sandbox } from "@vercel/sandbox";

/**
 * The admin agent's persistent Vercel Sandbox. One named sandbox per Vercel
 * environment holds the fetched store data and the memory file. It has no
 * network access and no secrets: the app fetches the data and writes it in.
 *
 * Only plain values leave this module, because workflow steps store their
 * inputs and outputs in the event log.
 */

// Preview and production get separate sandboxes, so they never share memory.

const SANDBOX_NAME = [
  process.env.ADMIN_SANDBOX_NAME ?? "ship-shop-admin",
  process.env.VERCEL_ENV ?? "development",
].join("-");
const IDLE_TIMEOUT_MS = 5 * 60_000;
const COMMAND_TIMEOUT_MS = 60_000;

export const DATA_DIR = "data";
const MEMORY_PATH = "memory/memory.md";
const MAX_MEMORY_ENTRIES = 50;
const MAX_MEMORY_LINE_CHARS = 300;
const MAX_STDOUT_CHARS = 6_000;
const MAX_STDERR_CHARS = 2_000;

async function adminSandbox(): Promise<Sandbox> {
  // Creation options apply only on the first call. Later calls resume the
  // stopped sandbox from its last snapshot.
  const sandbox = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    networkPolicy: "deny-all",
    timeout: IDLE_TIMEOUT_MS,
    persistent: true,
    // One snapshot that never expires, so memory survives long breaks.
    keepLastSnapshots: { count: 1, expiration: 0 },
  });

  // A resumed sandbox keeps the policy it was created with, so enforce it here.
  if (sandbox.networkPolicy !== "deny-all") {
    await sandbox.update({ networkPolicy: "deny-all" });
  }
  return sandbox;
}

export type BashResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
};

export async function runBash(command: string): Promise<BashResult> {
  const sandbox = await adminSandbox();
  const startedAt = Date.now();
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", command],
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  return {
    exitCode: result.exitCode,
    stdout: tail(stdout, MAX_STDOUT_CHARS),
    stderr: tail(stderr, MAX_STDERR_CHARS),
    truncated: stdout.length > MAX_STDOUT_CHARS || stderr.length > MAX_STDERR_CHARS,
    durationMs: Date.now() - startedAt,
  };
}

export async function writeDataFiles(files: { name: string; content: string }[]) {
  const sandbox = await adminSandbox();
  await sandbox.writeFiles(
    files.map((file) => ({ path: `${DATA_DIR}/${file.name}`, content: Buffer.from(file.content) })),
  );
}

/**
 * Returns the memory notes, one `- ` line each. Bash can write the file, so
 * only note lines pass, without angle brackets and cut to a fixed length.
 */
export async function readMemory(): Promise<string> {
  const sandbox = await adminSandbox();
  return (await memoryEntries(sandbox)).join("\n");
}

/** Appends one dated note. Keeps the newest 50 notes. */
export async function appendMemory(note: string, today: string): Promise<number> {
  const sandbox = await adminSandbox();
  const entries = [...(await memoryEntries(sandbox)), cleanNote(`- ${today}: ${note}`)];
  const kept = entries.slice(-MAX_MEMORY_ENTRIES);
  await sandbox.writeFiles([{ path: MEMORY_PATH, content: Buffer.from(`${kept.join("\n")}\n`) }]);
  return kept.length;
}

function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

async function memoryEntries(sandbox: Sandbox): Promise<string[]> {
  const buffer = await sandbox.readFileToBuffer({ path: MEMORY_PATH });
  return (buffer?.toString("utf8") ?? "")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map(cleanNote)
    .slice(-MAX_MEMORY_ENTRIES);
}

function cleanNote(line: string): string {
  return line.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_LINE_CHARS);
}
