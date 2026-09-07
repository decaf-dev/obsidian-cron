export interface CronJob {
	/**
	 * Stable and slug-safe. The same value is used as the Obsidian command id,
	 * the log filename and the lock directory name, so it is constrained to
	 * `[a-z0-9-]`.
	 */
	id: string;
	/**
	 * Identity key for reconciliation: the script's path relative to the cron
	 * folder, `/`-separated. A script sitting at the top level is just its
	 * filename, which is what every job saved before nested scanning holds.
	 */
	fileName: string;
	name: string;
	schedule: string;
	/**
	 * The user's intent, never mutated by reconciliation. Whether a job is
	 * actually scheduled is derived — see `isSchedulable`.
	 */
	enabled: boolean;
	/** The script is not currently on disk. */
	missing: boolean;
}

export interface CronSettings {
	version: 1;
	jobs: CronJob[];
	/** Overrides the detected login shell when set. */
	loginShellOverride: string | null;
	/** Prepended to PATH inside the runner. */
	extraPath: string[];
	logMaxBytes: number;
	/** Folders inside the cron folder that the scan does not descend into. */
	ignoredFolders: string[];
	/** Scripts the scan does not turn into jobs. */
	ignoredFiles: string[];
}

export const DEFAULT_SETTINGS: CronSettings = {
	version: 1,
	jobs: [],
	loginShellOverride: null,
	extraPath: [],
	logMaxBytes: 1024 * 1024,
	ignoredFolders: [],
	ignoredFiles: [],
};

/** Schedule a newly discovered script is given. It stays disabled until the user turns it on. */
export const DEFAULT_SCHEDULE = "0 * * * *";

export const CRON_FOLDER_NAME = "cron";
export const RUNNER_FILE_NAME = "_runner.sh";
export const LOGS_DIR_NAME = "logs";
export const LOCKS_DIR_NAME = "locks";

/**
 * Whether a job's `fileName` is a path that stays inside the cron folder.
 *
 * The scan only ever produces such paths, but `data.json` is a file the user
 * can edit and a synced vault can deliver, and `fileName` is joined onto the
 * cron folder to build the command a crontab line runs. When it was a bare
 * filename that join could not escape; now that it is a path, it has to be
 * checked.
 */
export function isSafeScriptPath(fileName: string): boolean {
	if (fileName === "" || fileName.startsWith("/") || fileName.includes("\\")) return false;
	return !fileName
		.split("/")
		.some((segment) => segment === "" || segment === "." || segment === "..");
}
