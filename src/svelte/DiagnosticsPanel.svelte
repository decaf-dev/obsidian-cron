<script lang="ts">
	import type { CronService } from "../obsidian/cron-service";
	import { createJobStore } from "./store.svelte";

	interface Props {
		service: CronService;
	}

	let { service }: Props = $props();
	const store = createJobStore(() => service);
</script>

<div class="cron-diagnostics">
	{#if store.diagnostics.length === 0}
		<p class="cron-ok">Everything looks ready.</p>
	{:else}
		{#each store.diagnostics as diagnostic (diagnostic.message)}
			<div class="cron-diagnostic cron-{diagnostic.level}">
				<div class="cron-diagnostic-message">{diagnostic.message}</div>
				{#if diagnostic.detail}
					<div class="cron-diagnostic-detail">{diagnostic.detail}</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.cron-diagnostics {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}

	.cron-ok {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.cron-diagnostic {
		border-left: 3px solid var(--background-modifier-border);
		padding: 4px 0 4px 10px;
		font-size: var(--font-ui-small);
	}

	.cron-diagnostic-detail {
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.cron-error {
		border-left-color: var(--text-error);
	}

	.cron-error .cron-diagnostic-message {
		color: var(--text-error);
	}

	.cron-warning {
		border-left-color: var(--text-warning);
	}

	.cron-warning .cron-diagnostic-message {
		color: var(--text-warning);
	}

	.cron-info {
		border-left-color: var(--background-modifier-border);
	}
</style>
