import { Notice, debounce } from "obsidian";
import type { App } from "obsidian";
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
import { JobCommandRegistry } from "./commands";
import type { JobCommandHost } from "./commands";
import { getEnvironmentDiagnostics, getJobDiagnostics, isSchedulable } from "./diagnostics";
import type { Diagnostic } from "./diagnostics";
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
import type { CronJob, CronSettings } from "./settings";
import { fileUrl, getCronPaths, getLogPath, getScriptPath, getStatusPath } from "./vault-paths";
import type { CronPaths } from "./vault-paths";

export interface CronServiceHost {
	app: App;
	settings: CronSettings;
	manifestVersion: string;
	saveSettings(): Promise<void>;
	commands: JobCommandHost;
}

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
	private resolvedPath: string | null = null;
	private loginShell = "/bin/sh";
	private pathError: string | null = null;
	private stopWatching: StopWatching | null = null;
	private listeners = new Set<() => void>();
	private commandRegistry: JobCommandRegistry;
	/** Guards against rewriting the crontab when nothing cron cares about changed. */
	private lastSignature: string | null = null;

	readonly requestCrontabSync = debounce(() => void this.syncCrontab(), SYNC_DEBOUNCE_MS, true);

	constructor(private readonly host: CronServiceHost) {
		this.commandRegistry = new JobCommandRegistry(host.commands, (jobId) => void this.runNow(jobId));
	}

	// --- lifecycle ---------------------------------------------------------

	async initialize(): Promise<void> {
		try {
			this.paths = getCronPaths(this.host.app);
		} catch (error) {
			this.pathError = error instanceof Error ? error.message : String(error);
			this.notify();
			return;
		}

		this.loginShell = detectLoginShell(this.host.settings.loginShellOverride);
		this.crontabBin = await resolveCrontabBinary();

		await ensureCronFolders(this.paths);
		await this.writeRunner();
		await this.refreshFromDisk();

		this.stopWatching = watchCronFolder(this.paths, () => void this.refreshFromDisk());

		// Sync once on load: this also heals a block left stale by a crash, or
		// by settings edited while Obsidian was closed.
		await this.syncCrontab({ force: true });
		void this.probeLoginShellPath();
	}

	dispose(): void {
		this.requestCrontabSync.cancel();
		this.stopWatching?.();
		this.stopWatching = null;
		this.commandRegistry.clear();
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

	getPaths(): CronPaths | null {
		return this.paths;
	}

	getViews(): JobView[] {
		const byName = new Map(this.scripts.map((script) => [script.fileName, script]));
		return this.host.settings.jobs.map((job) => {
			const script = byName.get(job.fileName);
			return {
				job,
				script,
				diagnostics: getJobDiagnostics(job, script),
				scheduled: isSchedulable(job, script),
				status: this.statuses.get(job.id) ?? null,
				running: this.running.has(job.id),
			};
		});
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
			resolvedPath: this.resolvedPath,
		});
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

		this.scripts = await scanScripts(this.paths);
		const result = reconcileJobs(
			this.host.settings.jobs,
			this.scripts.map((script) => script.fileName),
			{ schedule: this.host.settings.defaultSchedule },
			(fileName) => makeJobId(fileName, randomSuffix)
		);

		if (result.changed) {
			this.host.settings.jobs = result.jobs;
			await this.host.saveSettings();
		}

		this.commandRegistry.sync(this.host.settings.jobs);
		await this.readStatuses();
		this.notify();

		if (result.changed) this.requestCrontabSync();
	}

	startPolling(register: (id: number) => void): void {
		// fs.watch can go silent on synced or network volumes, so poll as well.
		register(window.setInterval(() => void this.refreshFromDisk(), POLL_INTERVAL_MS));
	}

	private async readStatuses(): Promise<void> {
		if (this.paths === null) return;
		const paths = this.paths;
		await Promise.all(
			this.host.settings.jobs.map(async (job) => {
				try {
					const raw = await fs.readFile(getStatusPath(paths, job.id), "utf8");
					const [ranAt, exitCode] = raw.trim().split(/\s+/);
					const parsed = { ranAt: Number(ranAt), exitCode: Number(exitCode) };
					if (Number.isFinite(parsed.ranAt) && Number.isFinite(parsed.exitCode)) {
						this.statuses.set(job.id, parsed);
					}
				} catch {
					this.statuses.delete(job.id);
				}
			})
		);
	}

	// --- mutations ---------------------------------------------------------

	async updateJob(id: string, patch: Partial<CronJob>): Promise<void> {
		const jobs = this.host.settings.jobs;
		const index = jobs.findIndex((job) => job.id === id);
		if (index === -1) return;

		jobs[index] = { ...jobs[index], ...patch };
		await this.host.saveSettings();
		this.commandRegistry.sync(jobs);
		this.notify();
		this.requestCrontabSync();
	}

	async removeJob(id: string): Promise<void> {
		this.host.settings.jobs = this.host.settings.jobs.filter((job) => job.id !== id);
		await this.host.saveSettings();
		this.commandRegistry.sync(this.host.settings.jobs);
		this.notify();
		this.requestCrontabSync();
	}

	async makeJobExecutable(id: string): Promise<void> {
		const job = this.findJob(id);
		if (job === undefined || this.paths === null) return;
		try {
			await makeExecutable(this.paths, job.fileName);
		} catch (error) {
			new Notice(`Could not make ${job.fileName} executable: ${message(error)}`);
			return;
		}
		await this.refreshFromDisk();
		this.requestCrontabSync();
	}

	async updateSettings(patch: Partial<CronSettings>): Promise<void> {
		Object.assign(this.host.settings, patch);
		await this.host.saveSettings();

		if ("loginShellOverride" in patch) {
			this.loginShell = detectLoginShell(this.host.settings.loginShellOverride);
			this.resolvedPath = null;
			void this.probeLoginShellPath();
		}
		if ("loginShellOverride" in patch || "extraPath" in patch || "logMaxBytes" in patch) {
			await this.writeRunner();
		}
		this.notify();
		this.requestCrontabSync();
	}

	// --- running -----------------------------------------------------------

	async runNow(id: string): Promise<void> {
		const job = this.findJob(id);
		if (job === undefined || this.paths === null) return;

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
			// scheduled run cannot diverge.
			const result = await run(
				this.paths.runner,
				[job.id, getScriptPath(this.paths, job.fileName)],
				{ timeoutMs: 10 * 60_000 }
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

		const entries: ManagedEntry[] = [];
		for (const job of this.host.settings.jobs) {
			if (!isSchedulable(job, byName.get(job.fileName))) continue;
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

	async syncCrontab(options: { force?: boolean } = {}): Promise<void> {
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
		if (this.crontabBin === null) return;
		try {
			const current = await readCrontab(this.crontabBin);
			const next = spliceManagedBlock(current.text, null);
			if (next !== current.text) await writeCrontab(this.crontabBin, next, current.existed);
			this.lastSignature = null;
			this.blockError = null;
			new Notice("Removed this plugin's block from your crontab.");
		} catch (error) {
			new Notice(message(error));
		}
		this.notify();
	}

	// --- helpers -----------------------------------------------------------

	private findJob(id: string): CronJob | undefined {
		return this.host.settings.jobs.find((job) => job.id === id);
	}

	private async writeRunner(): Promise<void> {
		if (this.paths === null) return;
		await ensureRunnerScript(this.paths.runner, {
			pluginVersion: this.host.manifestVersion,
			loginShell: this.loginShell,
			vaultPath: this.paths.vault,
			logsDir: this.paths.logs,
			locksDir: this.paths.locks,
			extraPath: this.host.settings.extraPath,
			logMaxBytes: this.host.settings.logMaxBytes,
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
