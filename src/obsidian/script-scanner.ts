import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import { LOCKS_DIR_NAME, LOGS_DIR_NAME, RUNNER_FILE_NAME } from "./settings";
import type { CronPaths } from "./vault-paths";

export interface ScriptInfo {
	fileName: string;
	/** Any of the execute bits are set. */
	executable: boolean;
	/** The file starts with `#!`. */
	hasShebang: boolean;
}

export async function ensureCronFolders(paths: CronPaths): Promise<void> {
	await fs.mkdir(paths.folder, { recursive: true });
	await fs.mkdir(paths.logs, { recursive: true });
	await fs.mkdir(paths.locks, { recursive: true });
}

function isCandidate(fileName: string): boolean {
	if (fileName === RUNNER_FILE_NAME) return false;
	if (fileName.startsWith(".")) return false;
	return fileName.toLowerCase().endsWith(".sh");
}

/**
 * Lists the user's scripts.
 *
 * Node `fs` rather than the vault adapter, because the adapter's `stat` has no
 * mode bits and it cannot chmod — both of which this plugin needs.
 *
 * Throws when the folder itself cannot be read. Returning an empty list would
 * be indistinguishable from a folder with no scripts in it, and callers treat
 * that as "every job's script has vanished".
 */
export async function scanScripts(paths: CronPaths): Promise<ScriptInfo[]> {
	const entries: nodeFs.Dirent[] = await fs.readdir(paths.folder, { withFileTypes: true });

	const scripts: ScriptInfo[] = [];
	for (const entry of entries) {
		if (entry.name === LOGS_DIR_NAME || entry.name === LOCKS_DIR_NAME) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		if (!isCandidate(entry.name)) continue;

		const fullPath = path.join(paths.folder, entry.name);
		let executable = false;
		let hasShebang = false;
		try {
			const stat = await fs.stat(fullPath);
			if (!stat.isFile()) continue;
			executable = (stat.mode & 0o111) !== 0;
			hasShebang = await startsWithShebang(fullPath);
		} catch {
			// A broken symlink or a file removed mid-scan: skip it and let the
			// next scan pick up whatever is actually there.
			continue;
		}
		scripts.push({ fileName: entry.name, executable, hasShebang });
	}

	scripts.sort((a, b) => a.fileName.localeCompare(b.fileName));
	return scripts;
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
 * Watches the cron folder for scripts appearing and disappearing.
 *
 * `fs.watch` goes through FSEvents on macOS and can fail outright or go quiet
 * on network and synced volumes, so callers keep a polling backstop; this
 * returns a no-op stopper when the watch could not be established.
 */
export function watchCronFolder(paths: CronPaths, onChange: () => void, debounceMs = 300): StopWatching {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let watcher: nodeFs.FSWatcher;

	try {
		watcher = nodeFs.watch(paths.folder, { persistent: false }, (_event, fileName) => {
			// Log and status writes land in a subdirectory, but a stray event
			// with no filename should still trigger a rescan.
			if (fileName !== null && !isCandidate(String(fileName))) return;
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(onChange, debounceMs);
		});
	} catch {
		return () => undefined;
	}

	watcher.on("error", () => watcher.close());

	return () => {
		if (timer !== null) clearTimeout(timer);
		watcher.close();
	};
}
