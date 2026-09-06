import { PluginSettingTab } from "obsidian";
import type { App, Setting, SettingDefinitionItem } from "obsidian";
import { mount, unmount } from "svelte";
import DiagnosticsPanel from "../svelte/DiagnosticsPanel.svelte";
import JobList from "../svelte/JobList.svelte";
import type CronPlugin from "../main";
import { validateCronExpression } from "./cron-expression";
import { createJobStore } from "../svelte/store.svelte";
import { fileUrl } from "./vault-paths";

/** Keys handled by getControlValue / setControlValue below. */
type ControlKey =
	| "defaultSchedule"
	| "loginShellOverride"
	| "extraPath"
	| "logMaxBytes"
	| "removeJobsOnDisable";

export class CronSettingTab extends PluginSettingTab {
	/** One subscription shared by every component this tab mounts. */
	private store: ReturnType<typeof createJobStore> | null = null;

	constructor(
		app: App,
		private readonly plugin: CronPlugin
	) {
		super(app, plugin);
	}

	hide(): void {
		this.store?.dispose();
		this.store = null;
		super.hide();
	}

	private getStore(): ReturnType<typeof createJobStore> {
		this.store ??= createJobStore(this.plugin.service);
		return this.store;
	}

	/**
	 * Controls persist through the plugin's own settings rather than the
	 * default vault config store.
	 */
	getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		switch (key as ControlKey) {
			case "defaultSchedule":
				return settings.defaultSchedule;
			case "loginShellOverride":
				return settings.loginShellOverride ?? "";
			case "extraPath":
				return settings.extraPath.join(":");
			case "logMaxBytes":
				return Math.round(settings.logMaxBytes / 1024);
			case "removeJobsOnDisable":
				return settings.removeJobsOnDisable;
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const service = this.plugin.service;
		switch (key as ControlKey) {
			case "defaultSchedule":
				await service.updateSettings({ defaultSchedule: String(value) });
				return;
			case "loginShellOverride": {
				const shell = String(value).trim();
				await service.updateSettings({ loginShellOverride: shell === "" ? null : shell });
				return;
			}
			case "extraPath":
				await service.updateSettings({
					extraPath: String(value)
						.split(":")
						.map((entry) => entry.trim())
						.filter((entry) => entry !== ""),
				});
				return;
			case "logMaxBytes":
				await service.updateSettings({ logMaxBytes: Math.max(1, Number(value)) * 1024 });
				return;
			case "removeJobsOnDisable":
				await service.updateSettings({ removeJobsOnDisable: Boolean(value) });
				return;
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const service = this.plugin.service;

		return [
			{
				type: "group",
				heading: "Jobs",
				items: [
					{
						name: "Scheduled scripts",
						desc: "Every shell script in the cron folder, with the schedule it runs on.",
						searchable: false,
						render: (setting: Setting) => mountInto(setting, JobList, { service, store: this.getStore() }),
					},
				],
			},
			{
				type: "group",
				heading: "Defaults",
				items: [
					{
						name: "Default schedule",
						desc: "Given to newly discovered scripts. They stay disabled until you turn them on.",
						control: {
							type: "text",
							key: "defaultSchedule" satisfies ControlKey,
							defaultValue: "0 * * * *",
							validate: (value: string) => {
								const result = validateCronExpression(value);
								return result.ok ? undefined : result.error;
							},
						},
					},
				],
			},
			{
				type: "group",
				heading: "Environment",
				items: [
					{
						name: "Login shell",
						desc: "Shell used to run your scripts. Leave empty to use the shell this account logs in with.",
						control: {
							type: "text",
							key: "loginShellOverride" satisfies ControlKey,
							defaultValue: "",
						},
					},
					{
						name: "Extra PATH entries",
						desc: "Colon-separated directories prepended to PATH. Useful because a login shell reads .zprofile but not .zshrc, so tools set up there are invisible to cron.",
						control: {
							type: "text",
							key: "extraPath" satisfies ControlKey,
							defaultValue: "",
						},
					},
					{
						name: "Log size limit",
						desc: "Kilobytes to keep per job. A log past this size is trimmed to half of it before the next run.",
						control: {
							type: "number",
							key: "logMaxBytes" satisfies ControlKey,
							defaultValue: 1024,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Crontab",
				items: [
					{
						name: "Remove jobs when the plugin is disabled",
						desc: "Jobs always survive quitting Obsidian. This controls whether disabling or uninstalling the plugin also clears them from your crontab.",
						control: {
							type: "toggle",
							key: "removeJobsOnDisable" satisfies ControlKey,
							defaultValue: true,
						},
					},
					{
						name: "Remove all managed jobs now",
						desc: "Turns every job off and clears this plugin's block from your crontab. Your own cron jobs are left untouched.",
						action: () => void service.removeAllManagedJobs(),
					},
					{
						name: "Open cron folder",
						desc: service.getPaths()?.folder ?? "Unavailable for this vault.",
						action: () => {
							const paths = service.getPaths();
							if (paths !== null) window.open(fileUrl(paths.folder));
						},
						disabled: () => service.getPaths() === null,
					},
				],
			},
			{
				type: "group",
				heading: "Diagnostics",
				items: [
					{
						name: "Status",
						searchable: false,
						render: (setting: Setting) => mountInto(setting, DiagnosticsPanel, { store: this.getStore() }),
					},
				],
			},
		];
	}
}

/**
 * Hosts a Svelte component inside a setting row.
 *
 * The row is a flex layout meant for a label and a control, so it is emptied
 * and reset to a plain block first. The returned cleanup runs when Obsidian
 * tears the row down, including on every `update()`.
 */
function mountInto<Props extends Record<string, unknown>>(
	setting: Setting,
	component: Parameters<typeof mount<Props, Record<string, unknown>>>[0],
	props: Props
): () => void {
	setting.settingEl.empty();
	setting.settingEl.addClass("cron-svelte-host");
	const view = mount(component, { target: setting.settingEl, props });
	return () => {
		void unmount(view);
	};
}
