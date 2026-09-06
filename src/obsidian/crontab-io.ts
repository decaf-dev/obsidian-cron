import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { CommandNotFoundError, run, runSync } from "./exec";

/** No usable `crontab` binary on this machine. */
export class CrontabUnavailableError extends Error {
	constructor() {
		super("No crontab command was found. Cron jobs cannot be scheduled on this machine.");
		this.name = "CrontabUnavailableError";
	}
}

/** `crontab` ran but refused. Carries stderr verbatim, which is the useful part. */
export class CrontabCommandError extends Error {
	constructor(message: string, readonly stderr: string, readonly code: number) {
		super(message);
		this.name = "CrontabCommandError";
	}
}

export interface CrontabRead {
	text: string;
	/** False when the user simply has no crontab yet, which is not an error. */
	existed: boolean;
}

const CANDIDATES = ["/usr/bin/crontab", "/bin/crontab", "/usr/local/bin/crontab"];

/**
 * Obsidian launched from Finder inherits a minimal PATH, so a bare `crontab`
 * lookup is unreliable. Probe the usual absolute locations first.
 */
export async function resolveCrontabBinary(): Promise<string | null> {
	for (const candidate of CANDIDATES) {
		try {
			await fs.access(candidate, fsConstants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	try {
		await run("crontab", ["-l"], { timeoutMs: 5_000 });
		return "crontab";
	} catch (error) {
		if (error instanceof CommandNotFoundError) return null;
		// It ran and failed (e.g. "no crontab for user"), so it exists.
		return "crontab";
	}
}

const NO_CRONTAB = /no crontab for|no crontab file/i;

export async function readCrontab(bin: string): Promise<CrontabRead> {
	const result = await run(bin, ["-l"]);
	if (result.code === 0) return { text: result.stdout, existed: true };
	if (NO_CRONTAB.test(result.stderr)) return { text: "", existed: false };
	throw new CrontabCommandError(
		`Could not read the crontab: ${firstLine(result.stderr) || `exit code ${result.code}`}`,
		result.stderr,
		result.code
	);
}

export async function writeCrontab(bin: string, text: string, hadCrontab: boolean): Promise<void> {
	// Some crontab implementations reject empty stdin. Callers only reach this
	// with empty text when the splice left genuinely nothing behind.
	if (text.trim() === "") {
		if (!hadCrontab) return;
		const removed = await run(bin, ["-r"]);
		if (removed.code !== 0 && !NO_CRONTAB.test(removed.stderr)) {
			throw new CrontabCommandError(
				`Could not clear the crontab: ${firstLine(removed.stderr) || `exit code ${removed.code}`}`,
				removed.stderr,
				removed.code
			);
		}
		return;
	}

	const result = await run(bin, ["-"], { input: text });
	if (result.code !== 0) {
		throw new CrontabCommandError(
			`Could not write the crontab: ${firstLine(result.stderr) || `exit code ${result.code}`}`,
			result.stderr,
			result.code
		);
	}
}

/** Used from `onunload`, which is synchronous and cannot await a write. */
export function writeCrontabSync(bin: string, text: string, hadCrontab: boolean): void {
	if (text.trim() === "") {
		if (hadCrontab) runSync(bin, ["-r"]);
		return;
	}
	const result = runSync(bin, ["-"], text);
	if (result.code !== 0) {
		throw new CrontabCommandError(
			`Could not write the crontab: ${firstLine(result.stderr) || `exit code ${result.code}`}`,
			result.stderr,
			result.code
		);
	}
}

export function readCrontabSync(bin: string): CrontabRead {
	const result = runSync(bin, ["-l"]);
	if (result.code === 0) return { text: result.stdout, existed: true };
	if (NO_CRONTAB.test(result.stderr)) return { text: "", existed: false };
	throw new CrontabCommandError(
		`Could not read the crontab: ${firstLine(result.stderr) || `exit code ${result.code}`}`,
		result.stderr,
		result.code
	);
}

function firstLine(text: string): string {
	return text.trim().split("\n")[0] ?? "";
}
