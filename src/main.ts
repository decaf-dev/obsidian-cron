import { Notice, Plugin } from "obsidian";
import { CronService } from "./obsidian/cron-service";
import { fileUrl } from "./obsidian/vault-paths";
import { DEFAULT_SETTINGS } from "./obsidian/settings";
import type { CronSettings } from "./obsidian/settings";
import { CronSettingTab } from "./obsidian/settings-tab";

export default class CronPlugin extends Plugin {
	settings: CronSettings = { ...DEFAULT_SETTINGS };
	service!: CronService;

	/**
	 * onunload fires on app quit as well as on a real disable. Cron jobs are
	 * meant to keep running while Obsidian is closed, so quitting must not
	 * tear down the crontab.
	 */
	private quitting = false;

	async onload() {
		await this.loadSettings();

		this.service = new CronService(this);

		this.registerDomEvent(window, "beforeunload", () => {
			this.quitting = true;
		});

		this.addCommand({
			id: "rescan-scripts",
			name: "Rescan script folder",
			callback: () => void this.service.rescan(),
		});

		this.addCommand({
			id: "open-script-folder",
			name: "Open script folder",
			callback: () => {
				const paths = this.service.getPaths();
				if (paths === null) {
					new Notice("This vault is not stored on the local file system.");
					return;
				}
				window.open(fileUrl(paths.folder));
			},
		});

		this.addSettingTab(new CronSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			// initialize records its own failures as diagnostics; the catch is
			// here so an unforeseen one still cannot stop polling, which is what
			// recovers the plugin once the underlying problem goes away.
			void this.service
				.initialize()
				.catch((error: unknown) => {
					new Notice(`Cron could not start: ${error instanceof Error ? error.message : String(error)}`);
				})
				.finally(() => {
					this.service.startPolling((id) => this.registerInterval(id));
				});
		});
	}

	onunload() {
		// Quitting Obsidian leaves the crontab alone, so jobs keep running.
		// Disabling or uninstalling the plugin clears its block.
		if (!this.quitting) {
			this.service.teardownCrontabSync();
		}
		this.service.dispose();
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<CronSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
