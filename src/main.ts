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
			callback: () => void this.service.refreshFromDisk(),
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
			void this.service.initialize().then(() => {
				this.service.startPolling((id) => this.registerInterval(id));
			});
		});
	}

	onunload() {
		if (!this.quitting && this.settings.removeJobsOnDisable) {
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
