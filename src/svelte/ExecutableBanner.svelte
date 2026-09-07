<script lang="ts">
	import type { CronService, JobView } from "../obsidian/cron-service";

	interface Props {
		service: CronService;
		views: JobView[];
	}

	let { service, views }: Props = $props();

	const offenders = $derived(
		views.filter((view) => view.diagnostics.some((d) => d.fix === "make-executable"))
	);
	/**
	 * Dismissal is tied to which scripts are offending rather than to a flag, so
	 * granting some of them, or a new script arriving without the bit, brings
	 * the banner back on its own. It lasts as long as the settings tab is open.
	 */
	const signature = $derived(offenders.map((view) => view.job.fileName).join("\n"));
	let dismissedFor = $state<string | null>(null);
	const visible = $derived(offenders.length > 0 && signature !== dismissedFor);
</script>

{#if visible}
	<div class="cron-callout cron-error">
		<svg
			class="cron-callout-icon"
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 8v4" />
			<path d="M12 16h.01" />
		</svg>

		<div class="cron-callout-body">
			<div class="cron-callout-title">
				{offenders.length === 1
					? "1 script is not executable."
					: `${offenders.length} scripts are not executable.`}
			</div>
			<p>Cron cannot run them until the executable bit is set.</p>
			<ul class="cron-callout-list">
				{#each offenders as view (view.job.id)}
					<li>{view.job.fileName}</li>
				{/each}
			</ul>
			<div class="cron-callout-buttons">
				<button
					type="button"
					class="mod-cta"
					onclick={() => void service.grantExecutePermissions()}
				>
					Grant all
				</button>
				<button type="button" onclick={() => (dismissedFor = signature)}>Dismiss</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.cron-callout {
		display: flex;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid color-mix(in srgb, var(--cron-accent) 30%, transparent);
		border-radius: var(--radius-m);
		background: color-mix(in srgb, var(--cron-accent) 8%, transparent);
		font-size: var(--font-ui-small);
	}

	.cron-error {
		--cron-accent: var(--text-error);
	}

	.cron-callout-icon {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--cron-accent);
	}

	.cron-callout-body {
		min-width: 0;
	}

	.cron-callout-title {
		font-weight: var(--font-semibold);
		color: var(--cron-accent);
	}

	.cron-callout-body p {
		margin: 6px 0 0;
		color: var(--text-muted);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.cron-callout-list {
		margin: 6px 0 0;
		padding-left: 20px;
		font-family: var(--font-monospace);
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.cron-callout-buttons {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 10px;
	}
</style>
