<script lang="ts">
	import type { Diagnostic } from "../obsidian/diagnostics";

	interface Props {
		diagnostics: Diagnostic[];
	}

	let { diagnostics }: Props = $props();

	/** Details are prose, and a blank line in one means a paragraph break. */
	function paragraphs(detail: string): string[] {
		return detail
			.split(/\n{2,}/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph !== "");
	}
</script>

{#each diagnostics as diagnostic (diagnostic.message)}
	<div class="cron-callout cron-{diagnostic.level}">
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
			{#if diagnostic.level === "error"}
				<circle cx="12" cy="12" r="10" />
				<path d="M12 8v4" />
				<path d="M12 16h.01" />
			{:else}
				<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
				<path d="M12 9v4" />
				<path d="M12 17h.01" />
			{/if}
		</svg>

		<div class="cron-callout-body">
			<div class="cron-callout-title">{diagnostic.message}</div>
			{#if diagnostic.detail}
				{#each paragraphs(diagnostic.detail) as paragraph (paragraph)}
					<p>{paragraph}</p>
				{/each}
			{/if}
		</div>
	</div>
{/each}

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

	.cron-warning {
		--cron-accent: var(--text-warning);
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
</style>
