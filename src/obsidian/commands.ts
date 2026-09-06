import type { Plugin } from "obsidian";
import type { CronJob } from "./settings";

function commandId(job: CronJob): string {
	// addCommand is documented to prefix the id with the plugin's own id.
	return `run-${job.id}`;
}

/**
 * Whether `removeCommand` applies the same prefix as `addCommand` is not
 * documented, so both forms are removed. Removing an id that was never
 * registered does nothing, which makes trying both safe on either behaviour.
 */
function removeCommand(plugin: Plugin, id: string): void {
	plugin.removeCommand(id);
	plugin.removeCommand(`${plugin.manifest.id}:${id}`);
}

function commandName(job: CronJob): string {
	return `Run script: ${job.name}`;
}

/**
 * Brings the command palette in step with the job list, and returns the
 * registrations so the next call can diff against them.
 *
 * The registered name is tracked because Obsidian caches the resolved name:
 * a renamed job needs its command removed and re-added, not overwritten.
 */
export function syncJobCommands(
	plugin: Plugin,
	jobs: readonly CronJob[],
	registered: ReadonlyMap<string, string>,
	onRun: (jobId: string) => void
): Map<string, string> {
	const next = new Map(registered);

	const desired = new Map<string, CronJob>();
	for (const job of jobs) desired.set(commandId(job), job);

	for (const [id, name] of registered) {
		const job = desired.get(id);
		if (job === undefined || name !== commandName(job)) {
			removeCommand(plugin, id);
			next.delete(id);
		}
	}

	for (const [id, job] of desired) {
		if (next.has(id)) continue;
		const name = commandName(job);
		plugin.addCommand({ id, name, callback: () => onRun(job.id) });
		next.set(id, name);
	}

	return next;
}

export function removeJobCommands(plugin: Plugin, registered: ReadonlyMap<string, string>): void {
	for (const [id] of registered) removeCommand(plugin, id);
}
