import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import type { IgnoreRules } from "./ignore-rules";
import { LOCKS_DIR_NAME, LOGS_DIR_NAME, RUNNER_FILE_NAME } from "./settings";
import type { CronPaths } from "./vault-paths";

export interface ScriptInfo {
	/** Path relative to the cron folder, `/`-separated. */
	fileName: string;
	/** Any of the execute bits are set. */
	executable: boolean;
	/** The file starts with `#!`. */
	hasShebang: boolean;
	/**
	 * Why the file could not be read, when the scan found it on disk but could
	 * not look inside it. `executable` and `hasShebang` are then unknown rather
	 * than false, so nothing should be concluded from them.
	 */
	readError: string | null;
}

/**
 * How far below the cron folder the scan goes.
 *
 * A guard against a pathological tree rather than a considered limit; nobody
 * organises a handful of shell scripts eight folders deep.
 */
const MAX_DEPTH = 8;

export async function ensureCronFolders(paths: CronPaths): Promise<void> {
	await fs.mkdir(paths.folder, { recursive: true });
	await fs.mkdir(paths.logs, { recursive: true });
	await fs.mkdir(paths.locks, { recursive: true });
}

function isScriptName(fileName: string): boolean {
	if (fileName.startsWith(".")) return false;
	return fileName.toLowerCase().endsWith(".sh");
}

/** The plugin's own files, which only ever sit at the top level. */
function isReserved(name: string): boolean {
	return name === LOGS_DIR_NAME || name === LOCKS_DIR_NAME || name === RUNNER_FILE_NAME;
}

/**
 * Lists the user's scripts, including the ones in subfolders.
 *
 * Node `fs` rather than the vault adapter, because the adapter's `stat` has no
 * mode bits and it cannot chmod â both of which this plugin needs. And a
 * hand-written walk rather than a recursive `readdir`, because an ignored
 * folder has to prune the subtree rather than be filtered out afterwards.
 *
 * Throws when a folder cannot be read. Returning a short list would be
 * indistinguishable from scripts having been deleted, and callers act on that
 * by taking jobs out of the crontab.
 */
export async function scanScripts(paths: CronPaths, rules: IgnoreRules): Promise<ScriptInfo[]> {
	const scripts: ScriptInfo[] = [];
	// The chain starts at the root's real path so a symlink pointing back at
	// the cron folder is recognised as the cycle it is.
	let root: string;
	try {
		root = await fs.realpath(paths.folder);
	} catch {
		root = paths.folder;
	}
	await walk(paths.folder, "", 0, rules, scripts, [root]);
	scripts.sort(byFolderThenName);
	return scripts;
}

async function walk(
	root: string,
	relativeDir: string,
	depth: number,
	rules: IgnoreRules,
	out: ScriptInfo[],
	ancestors: readonly string[]
): Promise<void> {
	const absoluteDir = relativeDir === "" ? root : path.join(root, relativeDir);

	let entries: nodeFs.Dirent[];
	try {
		entries = await fs.readdir(absoluteDir, { withFileTypes: true });
	} catch (error) {
		// A folder deleted while the scan was walking it is not a failure; the
		// next scan sees whatever is actually there.
		if (isNotFound(error)) return;
		throw new Error(readFailure(relativeDir, error));
	}

	for (const entry of entries) {
		if (relativeDir === "" && isReserved(entry.name)) continue;
		if (entry.name.startsWith(".")) continue;

		const relative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
		const absolute = path.join(absoluteDir, entry.name);

		if (entry.isDirectory()) {
			// A real directory inside a real directory: its real path follows
			// from its parent's, with no syscall needed to ask.
			await descend(root, relative, depth, rules, out, ancestors, {
				real: `${ancestors[ancestors.length - 1]}/${entry.name}`,
			});
			continue;
		}

		if (entry.isSymbolicLink()) {
			// readdir reports the link itself, so what it points at decides
			// whether this is a folder to walk or a script to record.
			let target: nodeFs.Stats;
			try {
				target = await fs.stat(absolute);
			} catch (error) {
				// A broken symlink points at nothing, so there is no script
				// here. Any other failure leaves a link that probably still
				// resolves to one, and dropping it would report the job as
				// missing; see `record`.
				if (isNotFound(error)) continue;
				if (!isScriptName(entry.name)) continue;
				if (rules.ignoresFile(relative)) continue;
				out.push(unreadable(relative, error, false));
				continue;
			}
			if (target.isDirectory()) {
				await descend(root, relative, depth, rules, out, ancestors, { link: absolute });
				continue;
			}
			if (!target.isFile()) continue;
			if (!isScriptName(entry.name)) continue;
			if (rules.ignoresFile(relative)) continue;
			await record(absolute, relative, target, out);
			continue;
		}

		if (!entry.isFile()) continue;
		if (!isScriptName(entry.name)) continue;
		if (rules.ignoresFile(relative)) continue;

		let stat: nodeFs.Stats;
		try {
			stat = await fs.stat(absolute);
		} catch (error) {
			// Removed mid-scan: skip it and let the next scan pick up whatever
			// is actually there.
			if (isNotFound(error)) continue;
			// Anything else means readdir listed a file that is still on disk
			// and cannot be inspected; see `record`.
			out.push(unreadable(relative, error, false));
			continue;
		}
		if (!stat.isFile()) continue;
		await record(absolute, relative, stat, out);
	}
}

/**
 * Walks one subfolder, unless it is ignored, too deep, or a way back to a
 * folder already on the path to it.
 *
 * `ancestors` holds the real path of every folder from the cron folder down to
 * this one. Comparing against that, rather than against every folder the scan
 * has ever seen, is what tells a cycle apart from a shortcut: a link back to an
 * ancestor would list the same scripts twice under a longer path, while two
 * links side by side pointing at one folder are two folders the user made, and
 * both belong in the list.
 */
async function descend(
	root: string,
	relative: string,
	depth: number,
	rules: IgnoreRules,
	out: ScriptInfo[],
	ancestors: readonly string[],
	target: { real: string } | { link: string }
): Promise<void> {
	if (rules.ignoresFolder(relative)) return;
	if (depth + 1 > MAX_DEPTH) return;

	let real: string;
	if ("real" in target) {
		real = target.real;
	} else {
		try {
			real = await fs.realpath(target.link);
		} catch {
			return;
		}
	}
	if (ancestors.includes(real)) return;

	await walk(root, relative, depth + 1, rules, out, [...ancestors, real]);
}

async function record(
	absolute: string,
	relative: string,
	stat: nodeFs.Stats,
	out: ScriptInfo[]
): Promise<void> {
	const executable = (stat.mode & 0o111) !== 0;

	let hasShebang: boolean;
	try {
		hasShebang = await startsWithShebang(absolute);
	} catch (error) {
		// Deleted between the stat and the open: there is nothing to record.
		if (isNotFound(error)) return;
		// Otherwise the file is on disk and merely unreadable for the moment,
		// which a permission bit, a sync client holding it open, or a file kept
		// in the cloud all produce. Leaving it out would tell reconciliation the
		// script was deleted, which marks the job missing, takes it out of the
		// crontab and offers to remove it — and the next scan that manages to
		// read the file would add it back as a new job, its name and schedule
		// lost.
		out.push(unreadable(relative, error, executable));
		return;
	}
	out.push({ fileName: relative, executable, hasShebang, readError: null });
}

/** A script the scan found on disk but could not inspect. */
function unreadable(relative: string, error: unknown, executable: boolean): ScriptInfo {
	return {
		fileName: relative,
		executable,
		hasShebang: false,
		readError: error instanceof Error ? error.message : String(error),
	};
}

/** Top-level scripts first, then each folder's scripts kept together. */
function byFolderThenName(a: ScriptInfo, b: ScriptInfo): number {
	const dirA = dirOf(a.fileName);
	const dirB = dirOf(b.fileName);
	if (dirA !== dirB) return dirA.localeCompare(dirB);
	return baseOf(a.fileName).localeCompare(baseOf(b.fileName));
}

function dirOf(relativePath: string): string {
	const slash = relativePath.lastIndexOf("/");
	return slash === -1 ? "" : relativePath.slice(0, slash);
}

function baseOf(relativePath: string): string {
	const slash = relativePath.lastIndexOf("/");
	return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

function isNotFound(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function readFailure(relativeDir: string, error: unknown): string {
	const reason = error instanceof Error ? error.message : String(error);
	if (relativeDir === "") return reason;
	return `${relativeDir}: ${reason}. Add it to the ignored folders setting to skip it.`;
}

async function startsWithShebang(fullPath: string): Promise<boolean> {
	const handle = await fs.open(fullPath, "r");
	try {
		const buffer = Buffer.alloc(2);
		const { bytesRead } = await handle.read(buffer, 0, 2, 0);
		return bytesRead === 2 && buffer.toString("latin1") === "#!";
	} finally {
		await handle.close();
	}
}

export async function makeExecutable(paths: CronPaths, fileName: string): Promise<void> {
	await fs.chmod(path.join(paths.folder, fileName), 0o755);
}

export type StopWatching = () => void;

/**
 * Whether a watch event is worth a rescan.
 *
 * The runner writes a log and a status file on every run, so without this the
 * folder would rescan itself every time a job fired. Ignored paths are
 * deliberately *not* filtered here: a rescan that finds nothing new is cheap,
 * and a second copy of the ignore rules is a second place to get them wrong.
 */
function isWatchEvent(relative: string): boolean {
	const segments = relative.split("/");
	const name = segments[segments.length - 1];
	if (segments[0] === LOGS_DIR_NAME || segments[0] === LOCKS_DIR_NAME) return false;
	if (segments.length === 1 && name === RUNNER_FILE_NAME) return false;
	if (segments.some((segment) => segment.startsWith("."))) return false;
	// A folder dragged in whole can arrive as a single event naming the folder,
	// with nothing said about the scripts inside it, so anything without an
	// extension is treated as a possible folder and rescanned.
	if (!name.includes(".")) return true;
	return isScriptName(name);
}

/**
 * Watches the cron folder, and everything under it, for scripts appearing and
 * disappearing.
 *
 * `fs.watch` goes through FSEvents on macOS and can fail outright or go quiet
 * on network and synced volumes, so callers keep a polling backstop; this
 * returns a no-op stopper when the watch could not be established. Recursive
 * watching is unavailable on older Linux builds, where the same backstop covers
 * the subfolders a flat watch cannot see.
 */
export function watchCronFolder(paths: CronPaths, onChange: () => void, debounceMs = 300): StopWatching {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const handle = (_event: string, fileName: string | Buffer | null) => {
		// A stray event with no filename should still trigger a rescan.
		if (fileName !== null && !isWatchEvent(String(fileName).split(path.sep).join("/"))) return;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(onChange, debounceMs);
	};

	let watcher: nodeFs.FSWatcher;
	try {
		watcher = nodeFs.watch(paths.folder, { persistent: false, recursive: true }, handle);
	} catch {
		try {
			watcher = nodeFs.watch(paths.folder, { persistent: false }, handle);
		} catch {
			return () => undefined;
		}
	}

	watcher.on("error", () => watcher.close());

	return () => {
		if (timer !== null) clearTimeout(timer);
		watcher.close();
	};
}
