import { validateCronExpression } from "./cron-expression";
import { UnquotableValueError, shellSingleQuote } from "./shell-quote";
import { isSafeScriptPath } from "./settings";
import type { CronJob } from "./settings";
import type { ScriptInfo } from "./script-scanner";

export type DiagnosticLevel = "error" | "warning";

/** A fix the settings UI can offer as a button. */
export type DiagnosticFix = "make-executable";

export interface Diagnostic {
	level: DiagnosticLevel;
	message: string;
	/** Longer explanation, rendered under the message. */
	detail?: string;
	fix?: DiagnosticFix;
}

export interface EnvironmentStatus {
	platform: NodeJS.Platform;
	crontabAvailable: boolean;
	vaultPath: string | null;
	/** Verbatim stderr from a failed crontab read, when there was one. */
	crontabError: string | null;
	loginShell: string;
}

export function getEnvironmentDiagnostics(status: EnvironmentStatus): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	if (status.platform === "win32") {
		diagnostics.push({
			level: "error",
			message: "Windows has no cron, so jobs cannot be scheduled.",
			detail: "This plugin supports macOS and Linux.",
		});
		return diagnostics;
	}

	if (status.vaultPath === null) {
		diagnostics.push({
			level: "error",
			message: "This vault is not stored on the local file system.",
			detail: "Cron runs commands against real paths, so it cannot reach this vault.",
		});
		return diagnostics;
	}

	if (!status.crontabAvailable) {
		diagnostics.push({
			level: "error",
			message: "No crontab command was found on this machine.",
			detail: "Install cron, or check that /usr/bin/crontab exists.",
		});
	}

	if (status.crontabError !== null) {
		diagnostics.push({
			level: "error",
			message: "The crontab command refused to run.",
			detail: status.crontabError,
		});
	}

	return diagnostics;
}

/**
 * Problems with one job. An error here means the job cannot be scheduled;
 * a warning is worth showing but does not block.
 */
export function getJobDiagnostics(
	job: CronJob,
	script: ScriptInfo | undefined,
	ignored = false
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	// Ahead of everything else: a job pointing outside the cron folder is never
	// something the scan produced, so no other diagnostic about it is meaningful.
	if (!isSafeScriptPath(job.fileName)) {
		diagnostics.push({
			level: "error",
			message: "This job's script path is not inside the cron folder.",
			detail: `${job.fileName} was not found by a scan, so it was written into data.json by hand or by whatever syncs your vault. Remove the job.`,
		});
		return diagnostics;
	}

	// Checked before the missing case: an ignored script is still on disk, and
	// telling the user to put it back would send them looking for nothing.
	if (ignored) {
		diagnostics.push({
			level: "error",
			message: "This script is excluded by your ignore settings.",
			detail: "Take it out of the ignored folders or ignored files to schedule it again.",
		});
		return diagnostics;
	}

	if (job.missing || script === undefined) {
		diagnostics.push({
			level: "error",
			message: "Script not found in the cron folder.",
			detail: `Put ${job.fileName} back, or remove this job. Its schedule is kept in the meantime.`,
		});
		return diagnostics;
	}

	// The scan found the file but could not look inside it, so the two checks
	// below have nothing to go on. A warning rather than an error: the script is
	// on disk, cron can still run it, and unscheduling a working job over a
	// permission bit or a sync client holding the file would be worse than
	// saying so and carrying on.
	if (script.readError !== null) {
		diagnostics.push({
			level: "warning",
			message: "This script could not be read, so it was not checked.",
			detail: `${script.readError}. The job keeps its schedule, and the next scan tries again.`,
		});
	} else {
		if (!script.executable) {
			diagnostics.push({
				level: "error",
				message: "Script is not executable.",
				fix: "make-executable",
			});
		}

		if (!script.hasShebang) {
			diagnostics.push({
				level: "warning",
				message: "Script has no #! line.",
				detail: "It will still run under your login shell, but adding #!/bin/sh makes that explicit.",
			});
		}
	}

	const validation = validateCronExpression(job.schedule);
	if (!validation.ok) {
		diagnostics.push({ level: "error", message: validation.error });
	}

	try {
		shellSingleQuote(job.fileName);
	} catch (error) {
		if (error instanceof UnquotableValueError) {
			diagnostics.push({
				level: "error",
				message: "The filename contains a line break and cannot be used in a crontab.",
			});
		} else {
			throw error;
		}
	}

	return diagnostics;
}

/**
 * Whether a job should actually appear in the crontab.
 *
 * `enabled` is the user's intent; this is the derived answer that accounts for
 * a missing script, a bad schedule or a file that cannot be executed.
 */
export function isSchedulable(job: CronJob, script: ScriptInfo | undefined, ignored = false): boolean {
	if (!job.enabled) return false;
	return !getJobDiagnostics(job, script, ignored).some((d) => d.level === "error");
}
