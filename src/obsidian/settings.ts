export interface CronJob {
	/**
	 * Stable and slug-safe. The same value is used as the Obsidian command id,
	 * the log filename and the lock directory name, so it is constrained to
	 * `[a-z0-9-]`.
	 */
	id: string;
	/** Identity key for reconciliation: filename relative to the cron folder. */
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
	defaultSchedule: string;
	/** Overrides the detected login shell when set. */
	loginShellOverride: string | null;
	/** Prepended to PATH inside the runner. */
	extraPath: string[];
	removeJobsOnDisable: boolean;
	logMaxBytes: number;
}

export const DEFAULT_SETTINGS: CronSettings = {
	version: 1,
	jobs: [],
	defaultSchedule: "0 * * * *",
	loginShellOverride: null,
	extraPath: [],
	removeJobsOnDisable: true,
	logMaxBytes: 1024 * 1024,
};

export const CRON_FOLDER_NAME = "cron";
export const RUNNER_FILE_NAME = "_runner.sh";
export const LOGS_DIR_NAME = "logs";
export const LOCKS_DIR_NAME = "locks";
