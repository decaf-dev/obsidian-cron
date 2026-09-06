<script lang="ts">
	import type { CronService } from "../obsidian/cron-service";
	import DiagnosticsPanel from "./DiagnosticsPanel.svelte";
	import JobRow from "./JobRow.svelte";
	import type { JobStore } from "./store.svelte";

	interface Props {
		service: CronService;
		store: JobStore;
	}

	let { service, store }: Props = $props();
	const folder = $derived(service.getPaths()?.folder ?? null);
</script>

<div class="cron-job-list">
	<DiagnosticsPanel diagnostics={store.diagnostics} />

	{#if store.views.length === 0}
		<div class="cron-empty">
			<p>No scripts yet.</p>
			<p class="cron-empty-hint">
				Put a shell script in the cron folder and it will show up here, disabled until you
				give it a schedule and turn it on.
			</p>
			{#if folder}
				<code>{folder}</code>
			{/if}
		</div>
	{:else}
		{#each store.views as view (view.job.id)}
			<JobRow {view} {service} blocked={store.blocked} />
		{/each}
	{/if}

	<div class="cron-list-footer">
		<button type="button" onclick={() => void service.refreshFromDisk()}>Rescan folder</button>
	</div>
</div>

<style>
	.cron-job-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
	}

	.cron-empty {
		border: 1px dashed var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 16px;
		text-align: center;
		color: var(--text-muted);
	}

	.cron-empty p {
		margin: 0 0 4px;
	}

	.cron-empty-hint {
		font-size: var(--font-ui-smaller);
	}

	.cron-empty code {
		font-size: var(--font-ui-smaller);
		overflow-wrap: anywhere;
	}

	.cron-list-footer {
		display: flex;
		justify-content: flex-end;
	}
</style>
