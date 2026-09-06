import type { CronService, JobView } from "../obsidian/cron-service";
import type { Diagnostic } from "../obsidian/diagnostics";

export interface JobStore {
	readonly views: JobView[];
	readonly diagnostics: Diagnostic[];
	readonly blocked: boolean;
}

/**
 * Mirrors the service's state into runes.
 *
 * Must be called during component setup: the `$effect` both subscribes and
 * returns the unsubscribe, so the listener goes away with the component. The
 * service arrives as a getter so reading it here does not capture a prop.
 */
export function createJobStore(getService: () => CronService): JobStore {
	const service = getService();

	let views = $state<JobView[]>(service.getViews());
	let diagnostics = $state<Diagnostic[]>(service.getDiagnostics());
	let blocked = $state<boolean>(service.isBlocked());

	$effect(() =>
		service.subscribe(() => {
			views = service.getViews();
			diagnostics = service.getDiagnostics();
			blocked = service.isBlocked();
		})
	);

	return {
		get views() {
			return views;
		},
		get diagnostics() {
			return diagnostics;
		},
		get blocked() {
			return blocked;
		},
	};
}

export function formatLastRun(ranAt: number): string {
	const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ranAt));
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}
