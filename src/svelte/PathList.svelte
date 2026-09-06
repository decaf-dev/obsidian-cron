<script lang="ts">
	import type { JobStore } from "./store.svelte";

	interface Props {
		store: JobStore;
	}

	let { store }: Props = $props();

	const entries = $derived(
		store.resolvedPath === null
			? []
			: store.resolvedPath.split(":").filter((entry) => entry !== "")
	);
</script>

{#if entries.length === 0}
	<div class="cron-path-empty">Not probed yet.</div>
{:else}
	<details class="cron-path-details">
		<summary>
			<svg
				class="cron-path-chevron"
				xmlns="http://www.w3.org/2000/svg"
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="m9 18 6-6-6-6" />
			</svg>
			{entries.length}
			{entries.length === 1 ? "directory" : "directories"}
		</summary>

		<!-- Ordered because cron resolves a command against these in order. -->
		<ol class="cron-path">
			{#each entries as entry, index (`${index}:${entry}`)}
				<li>{entry}</li>
			{/each}
		</ol>
	</details>
{/if}

<style>
	.cron-path-details {
		margin-top: 6px;
	}

	summary {
		display: flex;
		align-items: center;
		gap: 4px;
		width: fit-content;
		cursor: var(--cursor);
		list-style: none;
		color: var(--text-accent);
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:hover {
		color: var(--text-accent-hover);
	}

	.cron-path-chevron {
		flex-shrink: 0;
		transition: transform 100ms ease-in-out;
	}

	.cron-path-details[open] .cron-path-chevron {
		transform: rotate(90deg);
	}

	.cron-path {
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cron-path li {
		font-family: var(--font-monospace);
		font-size: var(--font-ui-smaller);
		color: var(--text-normal);
		overflow-wrap: anywhere;
	}

	.cron-path-empty {
		margin-top: 6px;
		font-style: italic;
	}
</style>
