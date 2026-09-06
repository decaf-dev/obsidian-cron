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
	/**
	 * Run the child in its own process group so a timeout can signal the whole
	 * tree. Without it, killing a wrapper leaves the processes it spawned
	 * running, detached from anything that could clean up after them.
	 */
	ownProcessGroup?: boolean;
}

/** How long a timed-out child gets to handle SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 5_000;

/**
 * Runs a binary with an argument array — never a shell string, so nothing in a
 * path or filename can be interpreted as a command.
 */
export function run(bin: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
	const { input, cwd, env, timeoutMs = 30_000, ownProcessGroup = false } = options;

	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(bin, [...args], {
				cwd,
				env,
				detached: ownProcessGroup,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			reject(new CommandNotFoundError(bin, error));
			return;
		}

		let stdout = "";
		let stderr = "";
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | null = null;

		const signal = (name: NodeJS.Signals) => {
			try {
				// A negative pid addresses the process group, so a wrapper's
				// children are signalled too rather than being orphaned.
				if (ownProcessGroup && child.pid !== undefined) process.kill(-child.pid, name);
				else child.kill(name);
			} catch {
				// Already gone.
			}
		};

		const stopTimers = () => {
			clearTimeout(timer);
			if (killTimer !== null) clearTimeout(killTimer);
		};

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			// SIGTERM first: the runner traps it to release its lock, which
			// SIGKILL would leave behind for the next run to trip over.
			signal("SIGTERM");
			killTimer = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
			reject(new Error(`"${bin}" did not finish within ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => (stdout += chunk));
		child.stderr.on("data", (chunk: string) => (stderr += chunk));

		child.on("error", (error) => {
			stopTimers();
			if (settled) return;
			settled = true;
			reject(new CommandNotFoundError(bin, error));
		});

		child.on("close", (code) => {
			// Unconditional: a child that dies to SIGTERM after the timeout has
			// already settled the promise, but its SIGKILL is now pointless.
			stopTimers();
			if (settled) return;
			settled = true;
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
