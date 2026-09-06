import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CRON_FOLDER_NAME, LOCKS_DIR_NAME, LOGS_DIR_NAME, RUNNER_FILE_NAME } from "./settings";

/** The vault is not backed by a real directory, so cron has nothing to run. */
export class VaultPathError extends Error {
	constructor() {
		super("This vault is not stored on the local file system, so cron jobs cannot be scheduled.");
		this.name = "VaultPathError";
	}
}

export interface CronPaths {
	/** Absolute path to the vault root; the working directory for every job. */
	vault: string;
	/** Absolute path to the folder holding the user's scripts. */
	folder: string;
	runner: string;
	logs: string;
	locks: string;
}

export function getVaultBasePath(app: App): string {
	const { adapter } = app.vault;
	if (!(adapter instanceof FileSystemAdapter)) throw new VaultPathError();
	return adapter.getBasePath();
}

export function getCronPaths(app: App): CronPaths {
	const vault = getVaultBasePath(app);
	// configDir rather than a hardcoded ".obsidian" — the config folder is
	// user-configurable and differs in some setups.
	const folder = path.join(vault, app.vault.configDir, CRON_FOLDER_NAME);
	return {
		vault,
		folder,
		runner: path.join(folder, RUNNER_FILE_NAME),
		logs: path.join(folder, LOGS_DIR_NAME),
		locks: path.join(folder, LOCKS_DIR_NAME),
	};
}

export function getScriptPath(paths: CronPaths, fileName: string): string {
	return path.join(paths.folder, fileName);
}

export function getLogPath(paths: CronPaths, jobId: string): string {
	return path.join(paths.logs, `${jobId}.log`);
}

export function getStatusPath(paths: CronPaths, jobId: string): string {
	return path.join(paths.logs, `${jobId}.status`);
}

/**
 * A file URL for opening a path in the OS.
 *
 * Built rather than concatenated: vault paths routinely contain spaces, and
 * `#` or `?` in a filename would otherwise truncate the URL.
 */
export function fileUrl(target: string): string {
	return pathToFileURL(target).href;
}
