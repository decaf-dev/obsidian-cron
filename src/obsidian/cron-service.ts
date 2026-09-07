import { Notice, debounce } from "obsidian";
import fs from "node:fs/promises";
import os from "node:os";
import {
	MalformedManagedBlockError,
	buildManagedBlock,
	spliceManagedBlock,
} from "./crontab-block";
import type { ManagedEntry } from "./crontab-block";
import {
	CrontabCommandError,
	readCrontab,
	readCrontabSync,
	resolveCrontabBinary,
	writeCrontab,
	writeCrontabSync,
} from "./crontab-io";
import { removeJobCommands, syncJobCommands } from "./commands";
import { getEnvironmentDiagnostics, getJobDiagnostics, isSchedulable } from "./diagnostics";
import type { Diagnostic } from "./diagnostics";
import { createIgnoreRules } from "./ignore-rules";
import type { IgnoreRules } from "./ignore-rules";
import { makeJobId, reconcileJobs } from "./reconcile";
import { detectLoginShell, ensureRunnerScript } from "./runner-script";
import { run } from "./exec";
import {
	ensureCronFolders,
	makeExecutable,
	scanScripts,
	watchCronFolder,
} from "./script-scanner";
import type { ScriptInfo, StopWatching } from "./script-scanner";
import { shellSingleQuote } from "./shell-quote";
import { validateCronExpression } from "./cron-expression";
import { isSafeScriptPath } from "./settings";
import type { CronJob, CronSettings } from "./settings";
import type CronPlugin from "../main";
import { fileUrl, getCronPaths, getLogPath, getScriptPath, getStatusPath } from "./vault-paths";
import type { CronPaths } from "./vault-paths";

export interface JobStatus {
	/** Unix seconds of the last completed run, from either cron or Run now. */
	ranAt: number;
	exitCode: number;
}

export interface JobView {
	job: CronJob;
	script: ScriptInfo | undefined;
	diagnostics: Diagnostic[];
	scheduled: boolean;
	status: JobStatus | null;
	running: boolean;
}

const POLL_INTERVAL_MS = 30_000;
const SYNC_DEBOUNCE_MS = 800;

export class CronService {
	private paths: CronPaths | null = null;
	private scripts: ScriptInfo[] = [];
	private statuses = new Map<string, JobStatus>();
	private running = new Set<string>();
	private crontabBin: string | null = null;
	private crontabError: string | null = null;
	private blockError: string | null = null;
	private setupError: string | null = null;
	private scanError: string | null = null;
	private resolvedPath: string | null = null;
	private loginShell = "/bin/sh";
	private pathError: string | null = null;
	private stopWatching: StopWatching | null = null;
	private listeners = new Set<() => void>();
	/** Command id -> the name it was registered under. */
	private commands: ReadonlyMap<string, string> = new Map();
	/** Guards against rewriting the crontab when nothing cron cares about changed. */
	private lastSignature: string | null = null;
	/** Tail of the chain that serializes crontab read/modify/write cycles. */
	private crontabQueue: Promise<unknown> = Promise.resolve();

	readonly requestCrontabSync = debounce(() => void this.syncCrontab(), SYNC_DEBOUNCE_MS, true);

	constructor(private readonly plugin: CronPlugin) {}

	/**
	 * The ignore lists as a matcher. Rebuilt per use rather than cached: the
	 * lists are a handful of strings, and a stale copy would quietly disagree
	 * with what the scan just did.
	 */
	private ignoreRules(): IgnoreRules {
		const settings = this.plugin.settings;
		return createIgnoreRules(settings.ignoredFolders, settings.ignoredFiles);
	}

	// --- lifecycle ---------------------------------------------------------

	async initialize(): Promise<void> {
		try {
			this.paths = getCronPaths(this.plugin.app);
		} catch (error) {
			this.pathError = error instanceof Error ? error.message : String(error);
			this.notify();
			return;
		}

		try {
			this.loginShell = detectLoginShell(this.plugin.settings.loginShellOverride);
			this.crontabBin = await resolveCrontabBinary();

			await ensureCronFolders(this.paths);
			await this.writeRunner();
			await this.refreshFromDisk();

			this.stopWatching = watchCronFolder(this.paths, () => void this.refreshFromDisk());

			// Sync once on load: this also heals a block left stale by a crash, or
			// by settings edited while Obsidian was closed.
			await this.syncCrontab({ force: true });
			this.setupError = null;
		} catch (error) {
			// A read-only vault or an unwritable runner must not leave the plugin
			// half-started and silent: record it, and let polling retry.
			this.setupError = message(error);
		}
		this.notify();
		void this.probeLoginShellPath();
	}

	dispose(): void {
		this.requestCrontabSync.cancel();
		this.stopWatching?.();
		this.stopWatching = null;
		removeJobCommands(this.plugin, this.commands);
		this.commands = new Map();
		this.listeners.clear();
	}

	/** Called from onunload on a real plugin disable, which cannot await. */
	teardownCrontabSync(): void {
		if (this.crontabBin === null) return;
		try {
			const current = readCrontabSync(this.crontabBin);
			const next = spliceManagedBlock(current.text, null);
			if (next !== current.text) {
				writeCrontabSync(this.crontabBin, next, current.existed);
			}
		} catch {
			// onunload cannot surface anything useful, and a failure here must
			// not stop the plugin from unloading.
		}
	}

	// --- state -------------------------------------------------------------

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	/**
	 * Writes settings to disk, reporting a failure instead of rejecting.
	 *
	 * Every caller has already changed the in-memory state and goes on to
	 * notify the UI, which has to happen whether or not the write lands: a
	 * rejection here used to escape into a discarded promise, leaving the
	 * settings pane showing a job the service had already dropped, and saying
	 * nothing about why.
	 */
	private async persistSettings(): Promise<void> {
		try {
			await this.plugin.saveSettings();
		} catch (error) {
			new Notice(`Could not save the job list: ${message(error)}`);
		}
	}

	getPaths(): CronPaths | null {
		return this.paths;
	}

	getViews(): JobView[] {
		const byName = new Map(this.scripts.map((script) => [script.fileName, script]));
		const rules = this.ignoreRules();
		return this.plugin.settings.jobs.map((job) => {
			const script = byName.get(job.fileName);
			const ignored = script === undefined && rules.ignoresPath(job.fileName);
			return {
				job,
				script,
				diagnostics: getJobDiagnostics(job, script, ignored),
				scheduled: isSchedulable(job, script, ignored),
				status: this.statuses.get(job.id) ?? null,
				running: this.running.has(job.id),
			};
		});
	}

	/** PATH a scheduled job runs with, or null until the login shell is probed. */
	getResolvedPath(): string | null {
		return this.resolvedPath;
	}

	getDiagnostics(): Diagnostic[] {
		if (this.pathError !== null) {
			return [{ level: "error", message: this.pathError }];
		}
		const diagnostics = getEnvironmentDiagnostics({
			platform: os.platform(),
			crontabAvailable: this.crontabBin !== null,
			vaultPath: this.paths?.vault ?? null,
			crontabError: this.crontabError,
			loginShell: this.loginShell,
		});
		if (this.scanError !== null) {
			diagnostics.unshift({
				level: "error",
				message: "The cron folder could not be read, so the job list may be out of date.",
				detail: this.scanError,
			});
		}
		if (this.setupError !== null) {
			diagnostics.unshift({
				level: "error",
				message: "This plugin could not finish starting up.",
				detail: this.setupError,
			});
		}
		if (this.blockError !== null) {
			diagnostics.unshift({
				level: "error",
				message: "Your crontab has a damaged Obsidian Cron block, so no changes are being written.",
				detail: this.blockError,
			});
		}
		return diagnostics;
	}

	/** True when the environment cannot schedule anything at all. */
	isBlocked(): boolean {
		return this.pathError !== null || this.crontabBin === null || this.blockError !== null;
	}

	// --- discovery ---------------------------------------------------------

	async refreshFromDisk(): Promise<void> {
		if (this.paths === null) return;

		const rules = this.ignoreRules();
		try {
			this.scripts = await scanScripts(this.paths, rules);
			this.scanError = null;
		} catch (error) {
			// An unreadable folder is not an empty one. Reconciling against an
			// empty list would delete every job and clear the crontab block, so a
			// synced volume going quiet for a moment must not.
			this.scanError = message(error);
			this.notify();
			return;
		}

		const result = reconcileJobs(
			this.plugin.settings.jobs,
			this.scripts.map((script) => script.fileName),
			(fileName) => makeJobId(fileName, randomSuffix),
			(fileName) => rules.ignoresPath(fileName)
		);

		if (result.changed) {
			this.plugin.settings.jobs = result.jobs;
			await this.persistSettings();
		}

		// This path is otherwise silent, because the watch and the poll both
		// come through it. Moves and deletions are the exceptions: both change
		// what is scheduled, and nothing else on screen would say so — a deleted
		// job's row simply stops being there.
		if (result.moved.length === 1) {
			const [job] = result.moved;
			new Notice(`${job.name} now runs ${job.fileName}.`);
		} else if (result.moved.length > 1) {
			new Notice(`${result.moved.length} jobs followed their scripts to a new folder.`);
		}
		if (result.removed.length === 1) {
			const [job] = result.removed;
			new Notice(`${job.name} was removed: ${job.fileName} is no longer in the cron folder.`);
		} else if (result.removed.length > 1) {
			new Notice(`${result.removed.length} jobs were removed: their scripts are gone.`);
		}

		this.syncCommands();
		await this.readStatuses();
		this.notify();

		// Unconditional: a script gaining or losing its executable bit outside
		// Obsidian changes what belongs in the crontab without changing the job
		// list. The signature check in syncCrontab makes this free when nothing
		// cron cares about actually moved.
		this.requestCrontabSync();
	}

	/**
	 * A rescan the user asked for, which reports what it found. The watch and
	 * polling paths call `refreshFromDisk` directly so they stay silent.
	 */
	async rescan(): Promise<void> {
		if (this.paths === null) {
			new Notice("Cron is unavailable for this vault.");
			return;
		}

		await this.refreshFromDisk();

		if (this.scanError !== null) {
			new Notice(`Could not read the cron folder: ${this.scanError}`);
			return;
		}

		const count = this.scripts.length;
		new Notice(count === 1 ? "Rescanned: 1 script found." : `Rescanned: ${count} scripts found.`);
	}

	startPolling(register: (id: number) => void): void {
		// fs.watch can go silent on synced or network volumes, so poll as well.
		register(window.setInterval(() => void this.refreshFromDisk(), POLL_INTERVAL_MS));
	}

	private async readStatuses(): Promise<void> {
		if (this.paths === null) return;
		const paths = this.paths;
		await Promise.all(
			this.plugin.settings.jobs.map(async (job) => {
				try {
					const raw = await fs.readFile(getStatusPath(paths, job.id), "utf8");
					const [ranAt, exitCode] = raw.trim().split(/\s+/);
					const parsed = { ranAt: Number(ranAt), exitCode: Number(exitCode) };
					if (Number.isFinite(parsed.ranAt) && Number.isFinite(parsed.exitCode)) {
						this.statuses.set(job.id, parsed);
					} else {
						// Truncated, or read while the runner was writing it.
						// Showing the previous run's result would be a lie.
						this.statuses.delete(job.id);
					}
				} catch {
					this.statuses.delete(job.id);
				}
			})
		);
	}

	// --- mutations ---------------------------------------------------------

	async updateJob(id: string, patch: Partial<CronJob>): Promise<void> {
		const jobs = this.plugin.settings.jobs;
		const index = jobs.findIndex((job) => job.id === id);
		if (index === -1) return;

		const previous = jobs[index];
		const job = { ...previous, ...patch };
		jobs[index] = job;
		await this.persistSettings();
		this.syncCommands();
		this.notify();
		this.requestCrontabSync();

		// Announces the user's intent, which the crontab write then follows. A
		// write that fails reports itself separately. Renames and schedule
		// edits stay quiet, since the row already shows their result.
		if (patch.enabled !== undefined && patch.enabled !== previous.enabled) {
			new Notice(`${job.name} is now ${job.enabled ? "enabled" : "disabled"}.`);
		}
	}

	/**
	 * Only meaningful for a job the scan cannot see: while the file is still
	 * visible to the scan, the next one re-adds the job with a new id and the
	 * default name and schedule. A script that is gone is removed by
	 * reconciliation without asking, so in practice this is the ignored case —
	 * a job the user wants gone for good rather than parked.
	 */
	async removeJob(id: string): Promise<void> {
		this.plugin.settings.jobs = this.plugin.settings.jobs.filter((job) => job.id !== id);
		await this.persistSettings();
		this.syncCommands();
		this.notify();
		this.requestCrontabSync();
	}

	/**
	 * Sets the executable bit on every script whose diagnostic asks for it.
	 *
	 * One script that refuses to chmod does not stop the rest: the failures are
	 * reported together and keep their diagnostic, so the banner offering this
	 * comes back for them alone.
	 */
	async grantExecutePermissions(): Promise<void> {
		if (this.paths === null) return;
		const jobs = this.getViews()
			.filter((view) => view.diagnostics.some((d) => d.fix === "make-executable"))
			.map((view) => view.job);
		if (jobs.length === 0) return;

		const failures: string[] = [];
		for (const job of jobs) {
			try {
				await makeExecutable(this.paths, job.fileName);
			} catch (error) {
				failures.push(`${job.fileName}: ${message(error)}`);
			}
		}
		if (failures.length > 0) {
			new Notice(`Could not make these scripts executable:\n${failures.join("\n")}`);
		}
		// refreshFromDisk syncs the crontab itself.
		await this.refreshFromDisk();
	}

	async updateSettings(patch: Partial<CronSettings>): Promise<void> {
		Object.assign(this.plugin.settings, patch);
		await this.persistSettings();

		if ("loginShellOverride" in patch) {
			this.loginShell = detectLoginShell(this.plugin.settings.loginShellOverride);
			this.resolvedPath = null;
			void this.probeLoginShellPath();
		}
		if ("loginShellOverride" in patch || "extraPath" in patch || "logMaxBytes" in patch) {
			await this.writeRunner();
		}
		if ("ignoredFolders" in patch || "ignoredFiles" in patch) {
			// The lists decide what the scan finds, so the job list is stale the
			// moment either changes. refreshFromDisk notifies and requests the
			// crontab sync itself; the pair below is debounced and
			// signature-guarded, so repeating them costs nothing.
			await this.refreshFromDisk();
		}
		this.notify();
		this.requestCrontabSync();
	}

	// --- running -----------------------------------------------------------

	async runNow(id: string): Promise<void> {
		const job = this.findJob(id);
		if (job === undefined || this.paths === null) return;

		if (!isSafeScriptPath(job.fileName)) {
			// Reconciliation marks such a job missing, so this is only reachable
			// from a data.json written by hand or by whatever syncs the vault.
			new Notice(`${job.name}: its script path is not inside the cron folder.`);
			return;
		}
		if (job.missing) {
			new Notice(`${job.name}: script not found in the cron folder.`);
			return;
		}
		if (this.running.has(id)) {
			new Notice(`${job.name} is already running.`);
			return;
		}

		await this.writeRunner();
		this.running.add(id);
		this.notify();
		new Notice(`Running ${job.name}...`);

		try {
			// Identical arguments to the crontab line, so a manual run and a
			// scheduled run cannot diverge. Its own process group, so a run that
			// overruns the timeout is stopped along with the script it started
			// rather than being left behind holding the job's lock.
			const result = await run(
				this.paths.runner,
				[job.id, getScriptPath(this.paths, job.fileName)],
				{ timeoutMs: 10 * 60_000, ownProcessGroup: true }
			);
			if (result.code === 75) {
				new Notice(`${job.name} is already running.`);
			} else if (result.code === 0) {
				new Notice(`${job.name} finished.`);
			} else {
				new Notice(`${job.name} failed with exit code ${result.code}. Check its log.`);
			}
		} catch (error) {
			new Notice(`${job.name} could not be started: ${message(error)}`);
		} finally {
			this.running.delete(id);
			await this.readStatuses();
			this.notify();
		}
	}

	async openLog(id: string): Promise<void> {
		if (this.paths === null) return;
		const logPath = getLogPath(this.paths, id);
		try {
			await fs.access(logPath);
		} catch {
			new Notice("This job has not produced a log yet.");
			return;
		}
		window.open(fileUrl(logPath));
	}

	// --- crontab -----------------------------------------------------------

	private buildEntries(): ManagedEntry[] {
		if (this.paths === null) return [];
		const paths = this.paths;
		const byName = new Map(this.scripts.map((script) => [script.fileName, script]));
		const rules = this.ignoreRules();

		const entries: ManagedEntry[] = [];
		for (const job of this.plugin.settings.jobs) {
			const script = byName.get(job.fileName);
			const ignored = script === undefined && rules.ignoresPath(job.fileName);
			if (!isSchedulable(job, script, ignored)) continue;
			const validation = validateCronExpression(job.schedule);
			if (!validation.ok) continue;

			const command = [
				shellSingleQuote(paths.runner),
				shellSingleQuote(job.id),
				shellSingleQuote(getScriptPath(paths, job.fileName)),
				"> /dev/null 2>&1",
			].join(" ");

			entries.push({
				jobId: job.id,
				jobName: job.name,
				schedule: validation.normalized,
				command,
			});
		}
		return entries;
	}

	/**
	 * Only the fields cron actually reads take part in the signature, so
	 * renaming a job or typing a half-finished schedule never triggers a write.
	 */
	private signature(entries: readonly ManagedEntry[]): string {
		return JSON.stringify(entries.map((e) => [e.jobId, e.schedule, e.command]));
	}

	/**
	 * `crontab -` replaces the whole file, so two overlapping read/modify/write
	 * cycles can drop each other's changes. Every cycle goes through here.
	 */
	private enqueueCrontabWork<T>(work: () => Promise<T>): Promise<T> {
		const result = this.crontabQueue.then(work, work);
		this.crontabQueue = result.catch(() => undefined);
		return result;
	}

	syncCrontab(options: { force?: boolean } = {}): Promise<void> {
		return this.enqueueCrontabWork(() => this.performCrontabSync(options));
	}

	private async performCrontabSync(options: { force?: boolean }): Promise<void> {
		if (this.paths === null || this.crontabBin === null) return;

		const entries = this.buildEntries();
		const signature = this.signature(entries);
		if (!options.force && signature === this.lastSignature) return;

		let current;
		try {
			current = await readCrontab(this.crontabBin);
			this.crontabError = null;
		} catch (error) {
			this.crontabError = error instanceof CrontabCommandError ? error.stderr.trim() : message(error);
			this.notify();
			return;
		}

		let next: string;
		try {
			next = spliceManagedBlock(current.text, entries.length === 0 ? null : buildManagedBlock(entries));
			this.blockError = null;
		} catch (error) {
			if (error instanceof MalformedManagedBlockError) {
				this.blockError = error.message;
				new Notice(error.message);
				this.notify();
				return;
			}
			throw error;
		}

		if (next === current.text) {
			this.lastSignature = signature;
			this.notify();
			return;
		}

		try {
			await writeCrontab(this.crontabBin, next, current.existed);
		} catch (error) {
			this.crontabError = error instanceof CrontabCommandError ? error.stderr.trim() : message(error);
			new Notice(message(error));
			this.notify();
			return;
		}

		// crontab - replaces the whole file, so a concurrent `crontab -e`
		// session can silently drop what we just wrote. Read it back.
		try {
			const verified = await readCrontab(this.crontabBin);
			if (verified.text !== next) {
				new Notice(
					"The crontab changed while it was being written. Your jobs may not be scheduled."
				);
			}
		} catch {
			// Verification is best-effort; the write itself reported success.
		}

		this.lastSignature = signature;
		this.notify();
	}

	async removeAllManagedJobs(): Promise<void> {
		const bin = this.crontabBin;
		if (bin === null) return;

		// Disable first. Leaving the jobs enabled would have the next sync — a
		// rename, a settings change, a new script — rebuild the whole block.
		const jobs = this.plugin.settings.jobs;
		if (jobs.some((job) => job.enabled)) {
			this.plugin.settings.jobs = jobs.map((job) => ({ ...job, enabled: false }));
			await this.persistSettings();
		}

		await this.enqueueCrontabWork(async () => {
			try {
				const current = await readCrontab(bin);
				const next = spliceManagedBlock(current.text, null);
				if (next !== current.text) await writeCrontab(bin, next, current.existed);
				this.lastSignature = null;
				this.blockError = null;
				new Notice("Removed this plugin's block from your crontab, and turned every job off.");
			} catch (error) {
				new Notice(message(error));
			}
		});
		this.notify();
	}

	// --- helpers -----------------------------------------------------------

	private syncCommands(): void {
		this.commands = syncJobCommands(
			this.plugin,
			this.plugin.settings.jobs,
			this.commands,
			(jobId) => void this.runNow(jobId)
		);
	}

	private findJob(id: string): CronJob | undefined {
		return this.plugin.settings.jobs.find((job) => job.id === id);
	}

	private async writeRunner(): Promise<void> {
		if (this.paths === null) return;
		await ensureRunnerScript(this.paths.runner, {
			pluginVersion: this.plugin.manifest.version,
			loginShell: this.loginShell,
			vaultPath: this.paths.vault,
			logsDir: this.paths.logs,
			locksDir: this.paths.locks,
			extraPath: this.plugin.settings.extraPath,
			logMaxBytes: this.plugin.settings.logMaxBytes,
		});
	}

	/**
	 * Shows the user the PATH their jobs will actually see. A login shell does
	 * not read .zshrc, so this is often not the PATH they expect.
	 */
	private async probeLoginShellPath(): Promise<void> {
		try {
			const result = await run(this.loginShell, ["-l", "-c", 'printf %s "$PATH"'], {
				timeoutMs: 10_000,
			});
			if (result.code === 0) {
				this.resolvedPath = result.stdout.trim();
				this.notify();
			}
		} catch {
			// Not being able to probe is not itself a problem worth reporting.
		}
	}
}

function randomSuffix(): string {
	return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
