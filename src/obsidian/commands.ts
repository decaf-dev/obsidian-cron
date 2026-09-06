import type { Plugin } from "obsidian";
import type { CronJob } from "./settings";

export interface JobCommandHost {
	addCommand: Plugin["addCommand"];
	removeCommand: Plugin["removeCommand"];
}

function commandId(job: CronJob): string {
	// No plugin id prefix: addCommand and removeCommand both apply it.
	return `run-${job.id}`;
}

function commandName(job: CronJob): string {
	return `Run script: ${job.name}`;
}

/**
 * Keeps the command palette in step with the job list.
 *
 * Tracks the name each command was registered under, because Obsidian caches
 * the resolved name — a renamed job needs the command removed and re-added
 * rather than simply overwritten.
 */
export class JobCommandRegistry {
	private registered = new Map<string, string>();

	constructor(
		private readonly host: JobCommandHost,
		private readonly onRun: (jobId: string) => void
	) {}

	sync(jobs: readonly CronJob[]): void {
		const desired = new Map<string, CronJob>();
		for (const job of jobs) desired.set(commandId(job), job);

		for (const [id] of this.registered) {
			const job = desired.get(id);
			if (job === undefined || this.registered.get(id) !== commandName(job)) {
				this.host.removeCommand(id);
				this.registered.delete(id);
			}
		}

		for (const [id, job] of desired) {
			if (this.registered.has(id)) continue;
			const name = commandName(job);
			this.host.addCommand({
				id,
				name,
				callback: () => this.onRun(job.id),
			});
			this.registered.set(id, name);
		}
	}

	clear(): void {
		for (const [id] of this.registered) this.host.removeCommand(id);
		this.registered.clear();
	}
}
