import { PluginSettingTab } from "obsidian";
import type { App, Setting, SettingDefinitionItem } from "obsidian";
import { mount, unmount } from "svelte";
import JobList from "../svelte/JobList.svelte";
import PathList from "../svelte/PathList.svelte";
import type CronPlugin from "../main";
import { hasParentSegment, parseIgnoreList } from "./ignore-rules";
import { createJobStore } from "../svelte/store.svelte";
import { fileUrl } from "./vault-paths";

/** Keys handled by getControlValue / setControlValue below. */
type ControlKey =
	| "loginShellOverride"
	| "extraPath"
	| "logMaxBytes"
	| "ignoredFolders"
	| "ignoredFiles";

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
			case "loginShellOverride":
				return settings.loginShellOverride ?? "";
			case "extraPath":
				return settings.extraPath.join(":");
			case "logMaxBytes":
				return Math.round(settings.logMaxBytes / 1024);
			case "ignoredFolders":
				return settings.ignoredFolders.join(", ");
			case "ignoredFiles":
				return settings.ignoredFiles.join(", ");
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const service = this.plugin.service;
		switch (key as ControlKey) {
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
			case "ignoredFolders":
				await service.updateSettings({ ignoredFolders: parseIgnoreList(String(value)) });
				return;
			case "ignoredFiles":
				await service.updateSettings({ ignoredFiles: parseIgnoreList(String(value)) });
				return;
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const service = this.plugin.service;

		return [
			{
				type: "group",
				heading: "Scripts",
				// The cards carry their own borders, so the group's panel is
				// stripped back to nothing in JobList's stylesheet. The class is
				// the only handle it has on this group.
				cls: "cron-scripts-group",
				items: [
					{
						name: "Scripts",
						desc: "Every shell script in the cron folder, with the schedule it runs on.",
						searchable: false,
						render: (setting: Setting) => mountInto(setting, JobList, { service, store: this.getStore() }),
					},
				],
			},
			{
				type: "group",
				heading: "Scanning",
				items: [
					{
						name: "Rescan cron folder",
						desc: "Picks up scripts added, renamed or removed outside Obsidian.",
						render: (setting: Setting) => {
							setting.addButton((button) =>
								button
									.setButtonText("Rescan")
									.onClick(() => void service.rescan())
							);
						},
					},
					{
						name: "Ignored folders",
						desc: "Comma-separated folders inside the cron folder that are not scanned. A name on its own, like lib, skips every folder called that at any depth. A path, like archive/2024, skips only that one.",
						control: {
							type: "text",
							key: "ignoredFolders" satisfies ControlKey,
							defaultValue: "",
							validate: rejectParentSegments,
						},
					},
					{
						name: "Ignored files",
						desc: "Comma-separated scripts that are not turned into jobs. A name on its own, like _shared.sh, skips it wherever it appears. A path, like tools/wip.sh, skips only that one.",
						control: {
							type: "text",
							key: "ignoredFiles" satisfies ControlKey,
							defaultValue: "",
							validate: rejectParentSegments,
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
						name: "Effective PATH",
						desc: "Where a scheduled job looks for the commands it runs, in order.",
						searchable: false,
						render: (setting: Setting) =>
							mountUnderDesc(setting, PathList, { store: this.getStore() }),
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
				heading: "Maintenance",
				items: [
					{
						name: "Open cron folder",
						desc: service.getPaths()?.folder ?? "Unavailable for this vault.",
						render: (setting: Setting) => {
							setting.addButton((button) =>
								button
									.setButtonText("Open folder")
									.setDisabled(service.getPaths() === null)
									.onClick(() => {
										const paths = service.getPaths();
										if (paths !== null) window.open(fileUrl(paths.folder));
									})
							);
						},
					},
					{
						name: "Remove all managed jobs",
						desc: "Turns every job off and clears this plugin's block from your crontab. Your own cron jobs are left untouched.",
						render: (setting: Setting) => {
							setting.addButton((button) =>
								button
									.setButtonText("Remove all")
									.setDestructive()
									.onClick(() => void service.removeAllManagedJobs())
							);
						},
					},
				],
			},
		];
	}
}

/**
 * The scan only ever compares these entries against paths it already found, so
 * a `..` cannot reach outside the cron folder. It is still refused rather than
 * quietly dropped, because an entry written that way means something the
 * setting cannot do.
 */
function rejectParentSegments(value: string): string | void {
	if (hasParentSegment(value)) return "An entry cannot contain \"..\".";
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
	return mountAt(setting.settingEl, component, props);
}

/**
 * Hosts a Svelte component under a setting row's description, keeping the
 * row's own name, description and layout above it. For content too wide to
 * sit in the control column.
 */
function mountUnderDesc<Props extends Record<string, unknown>>(
	setting: Setting,
	component: Parameters<typeof mount<Props, Record<string, unknown>>>[0],
	props: Props
): () => void {
	return mountAt(setting.descEl.createDiv(), component, props);
}

function mountAt<Props extends Record<string, unknown>>(
	target: HTMLElement,
	component: Parameters<typeof mount<Props, Record<string, unknown>>>[0],
	props: Props
): () => void {
	const view = mount(component, { target, props });
	return () => {
		void unmount(view);
	};
}
