import os from "node:os";
import path from "node:path";
import { validateCronExpression } from "./cron-expression";
import { UnquotableValueError, shellSingleQuote } from "./shell-quote";
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

/**
 * macOS restricts these directories under TCC. `/usr/sbin/cron` needs Full Disk
 * Access to touch anything inside them, and the failure is silent, so a vault
 * living here is worth warning about up front.
 */
const PROTECTED_DIRECTORIES = ["Documents", "Desktop", "Downloads"];

function isTccProtected(vaultPath: string): boolean {
	const home = os.homedir();
	const relative = path.relative(home, vaultPath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return vaultPath.includes("Library/Mobile Documents");
	}
	const [first] = relative.split(path.sep);
	return PROTECTED_DIRECTORIES.includes(first) || vaultPath.includes("Library/Mobile Documents");
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

	if (status.platform === "darwin" && isTccProtected(status.vaultPath)) {
		diagnostics.push({
			level: "warning",
			message: "This vault is in a folder macOS protects, so scheduled jobs will fail silently.",
			detail:
				"macOS blocks cron from reaching ~/Desktop, ~/Documents, ~/Downloads and iCloud Drive. " +
				"The fix that changes least is to move this vault somewhere unprotected, such as ~/Vaults, " +
				"after which no permission is needed at all.\n\n" +
				"The alternative is to grant Full Disk Access to cron: System Settings > Privacy & Security > " +
				"Full Disk Access > + > press Cmd-Shift-G > enter /usr/sbin/cron. Weigh that carefully. The grant " +
				"is inherited by every job in every crontab, not just this plugin's, and Full Disk Access also " +
				"covers Mail, Messages, Safari data and Time Machine backups.\n\n" +
				"Running a job from the command palette works either way, because it inherits Obsidian's own permissions.",
		});
	}

	return diagnostics;
}

/**
 * Problems with one job. An error here means the job cannot be scheduled;
 * a warning is worth showing but does not block.
 */
export function getJobDiagnostics(job: CronJob, script: ScriptInfo | undefined): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	if (job.missing || script === undefined) {
		diagnostics.push({
			level: "error",
			message: "Script not found in the cron folder.",
			detail: `Put ${job.fileName} back, or remove this job. Its schedule is kept in the meantime.`,
		});
		return diagnostics;
	}

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
export function isSchedulable(job: CronJob, script: ScriptInfo | undefined): boolean {
	if (!job.enabled) return false;
	return !getJobDiagnostics(job, script).some((d) => d.level === "error");
}
