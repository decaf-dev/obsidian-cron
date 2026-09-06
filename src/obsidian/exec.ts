import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** The binary itself could not be executed (ENOENT, EACCES). */
export class CommandNotFoundError extends Error {
	constructor(readonly bin: string, cause: unknown) {
		super(`Could not run "${bin}": ${describe(cause)}`);
		this.name = "CommandNotFoundError";
	}
}

export interface RunOptions {
	/** Written to stdin and then closed. `execFile` cannot do this. */
	input?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

/**
 * Runs a binary with an argument array — never a shell string, so nothing in a
 * path or filename can be interpreted as a command.
 */
export function run(bin: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
	const { input, cwd, env, timeoutMs = 30_000 } = options;

	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(bin, [...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
		} catch (error) {
			reject(new CommandNotFoundError(bin, error));
			return;
		}

		let stdout = "";
		let stderr = "";
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGKILL");
			reject(new Error(`"${bin}" did not finish within ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => (stdout += chunk));
		child.stderr.on("data", (chunk: string) => (stderr += chunk));

		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new CommandNotFoundError(bin, error));
		});

		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ code: code ?? 0, stdout, stderr });
		});

		if (input !== undefined) {
			// A closed stdin (the child exited early) must not take down Obsidian.
			child.stdin.on("error", () => undefined);
			child.stdin.end(input);
		} else {
			child.stdin.end();
		}
	});
}

/**
 * Synchronous variant, used only from `onunload`, which cannot await.
 */
export function runSync(bin: string, args: readonly string[], input?: string): RunResult {
	// env is passed explicitly so this matches the async path; spawnSync does
	// not reliably inherit it across every runtime this code is exercised in.
	const result = spawnSync(bin, [...args], {
		input,
		env: process.env,
		encoding: "utf8",
		timeout: 10_000,
	});
	if (result.error) throw new CommandNotFoundError(bin, result.error);
	return {
		code: result.status ?? 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function describe(cause: unknown): string {
	if (cause instanceof Error) return cause.message;
	return String(cause);
}
