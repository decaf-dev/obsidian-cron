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
 * Created once per settings tab and shared by the components, so there is a
 * single subscription rather than one per component. `subscribe` returns its
 * own unsubscribe, which the caller owns.
 */
export function createJobStore(service: CronService): JobStore & { dispose(): void } {
	let views = $state<JobView[]>(service.getViews());
	let diagnostics = $state<Diagnostic[]>(service.getDiagnostics());
	let blocked = $state<boolean>(service.isBlocked());

	const unsubscribe = service.subscribe(() => {
		views = service.getViews();
		diagnostics = service.getDiagnostics();
		blocked = service.isBlocked();
	});

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
		dispose: unsubscribe,
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
