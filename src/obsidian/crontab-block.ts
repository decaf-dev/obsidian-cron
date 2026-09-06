export const BLOCK_BEGIN = "# BEGIN obsidian-cron";
export const BLOCK_END = "# END obsidian-cron";

const BLOCK_NOTICE =
	"# Managed by the Obsidian Cron plugin. Edits inside this block are overwritten.";

/**
 * Thrown when the crontab contains a begin sentinel without a matching end,
 * or more than one begin sentinel.
 *
 * We refuse to write in that case rather than guessing where the block ends;
 * guessing wrong would delete the user's own cron jobs.
 */
export class MalformedManagedBlockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MalformedManagedBlockError";
	}
}

export interface ManagedEntry {
	jobId: string;
	jobName: string;
	schedule: string;
	/** Fully quoted command, ready to place after the schedule fields. */
	command: string;
}

/**
 * Escapes `%` for vixie cron, where the first unescaped `%` in a command ends
 * the command and everything after it is fed to the job on stdin.
 */
export function escapeCronPercent(command: string): string {
	return command.replace(/%/g, "\\%");
}

/** Strips characters that would break out of a single-line crontab comment. */
function commentSafe(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildManagedBlock(entries: readonly ManagedEntry[]): string {
	const lines: string[] = [BLOCK_BEGIN, BLOCK_NOTICE];
	for (const entry of entries) {
		lines.push(`# job: ${commentSafe(entry.jobName)} (${entry.jobId})`);
		lines.push(`${entry.schedule} ${escapeCronPercent(entry.command)}`);
	}
	lines.push(BLOCK_END);
	return lines.join("\n");
}

interface BlockBounds {
	start: number;
	end: number;
}

/**
 * Locates the managed block by sentinel lines.
 *
 * `trimEnd` rather than `trim` on the comparison so a CRLF crontab still
 * matches, while an indented sentinel inside some other tool's block does not.
 */
function findBlock(lines: readonly string[]): BlockBounds | null {
	const begins: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trimEnd() === BLOCK_BEGIN) begins.push(i);
	}
	if (begins.length === 0) return null;
	if (begins.length > 1) {
		throw new MalformedManagedBlockError(
			`Found ${begins.length} "${BLOCK_BEGIN}" lines in the crontab. Remove the duplicates before continuing.`
		);
	}
	const start = begins[0];
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].trimEnd() === BLOCK_END) return { start, end: i };
	}
	throw new MalformedManagedBlockError(
		`Found "${BLOCK_BEGIN}" in the crontab with no matching "${BLOCK_END}". Fix the crontab manually before continuing.`
	);
}

/** Returns the managed block including its sentinels, or null if absent. */
export function extractManagedBlock(crontab: string): string | null {
	const lines = crontab.split("\n");
	const bounds = findBlock(lines);
	if (bounds === null) return null;
	return lines.slice(bounds.start, bounds.end + 1).join("\n");
}

/**
 * Replaces the managed block in `crontab` with `block`, or removes it when
 * `block` is null. Every line outside the block is preserved byte for byte,
 * and an existing block keeps its position in the file.
 */
export function spliceManagedBlock(crontab: string, block: string | null): string {
	const lines = crontab.split("\n");
	const bounds = findBlock(lines);

	if (bounds === null) {
		// Nothing to remove: hand back the input untouched, including any
		// unusual trailing whitespace, so a no-op sync writes nothing.
		if (block === null) return crontab;
		return appendBlock(crontab, block);
	}

	const before = lines.slice(0, bounds.start);
	const after = lines.slice(bounds.end + 1);

	if (block === null) {
		// Drop the blank line that separated the block from what came before,
		// so repeated add/remove cycles do not accumulate blank lines.
		if (before.length > 0 && before[before.length - 1].trim() === "") {
			before.pop();
		}
		const rest = [...before, ...after];
		if (rest.every((line) => line.trim() === "")) return "";
		return ensureTrailingNewline(rest.join("\n"));
	}

	return ensureTrailingNewline([...before, ...block.split("\n"), ...after].join("\n"));
}

function appendBlock(crontab: string, block: string): string {
	if (crontab.trim() === "") return ensureTrailingNewline(block);
	const body = crontab.replace(/\n+$/, "");
	return ensureTrailingNewline(`${body}\n\n${block}`);
}

/** vixie cron warns about a "premature EOF" on a file with no final newline. */
function ensureTrailingNewline(text: string): string {
	if (text === "") return "";
	return text.endsWith("\n") ? text : `${text}\n`;
}
