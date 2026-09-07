# Changelog

All notable changes to this project are documented in this file, newest first.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Entries are grouped by date rather than by version.

## 2026-09-06

### Added

-   A drag handle on each job in the settings list. Drag a job to reorder it, or focus its handle and use the arrow keys. The order is kept in `data.json` and restored when Obsidian reopens, and a newly discovered script is added at the end so an arrangement already made does not shift. The managed crontab block is written in the same order, and the `Run script: <name>` commands are re-registered in it, though the command palette applies its own ranking on top
-   Cron job management. Shell scripts in `<vault>/.obsidian/cron`, and in any folder inside it up to eight levels deep, are discovered automatically and listed in the plugin settings, where each one gets a name, a cron schedule, and an enable toggle. Enabled jobs are written to the system crontab on macOS and Linux
-   A nested script is named after the folders it sits in, so `backup/nightly-sync.sh` becomes `Backup / Nightly sync` and two scripts with the same filename are still told apart in the command palette
-   **Ignored folders** and **Ignored files** settings, comma-separated. An entry without a slash matches by name at any depth, so `lib` covers `lib/` and `backup/lib/`; an entry with a slash has to match the whole path, so `archive/2024` leaves `archive/2025` alone. Matching ignores case
-   A job whose script moves to another folder follows it, keeping its name, schedule, enable state and log, as long as exactly one job lost that filename and exactly one new script has it
-   A `Run script: <name>` command per job, so a script can be run on demand without waiting for its schedule. It goes through the same runner as cron, so a manual run and a scheduled run behave identically
-   A generated `_runner.sh` that gives every job the vault as its working directory, runs it under your login shell, keeps a per-job log, records the last exit code, and skips a run when the previous one is still going
-   Diagnostics in the settings tab for the problems that otherwise fail silently: a missing `crontab`, a script without the executable bit (with a one-click fix), an invalid schedule, a script that has disappeared, a script excluded by the ignore settings, a script path that reaches outside the cron folder, and a vault in a folder macOS stops cron from reaching
-   Settings for the login shell, extra `PATH` entries, the default schedule for new scripts, the folders and files the scan skips, the per-job log size cap, and whether disabling the plugin clears its crontab entries
-   Plugin reload after each successful build, through the official Obsidian CLI. Set `OBSIDIAN_VAULT` in a local `.env` (see `.env.example`) to enable it; builds carry on unchanged without it
-   `bun run reload` script for reloading the plugin without rebuilding
-   Credit to the official Obsidian sample plugin template in the README

### Changed

-   `esbuild.config.mjs` also externalizes the `node:`-prefixed builtin module names, which `builtinModules` does not include
-   The README symlink step now recommends naming the folder under `.obsidian/plugins` after the `id` in `manifest.json`, which is what a reload targets
-   Simplified README language and reduced emoji usage

### Fixed

-   The release workflow no longer tries to upload `dist/styles.css`, which the build does not produce

### Security

-   A folder the scan cannot read stops the scan rather than being reported as empty. Treating it as empty is indistinguishable from every script inside it having been deleted, and would silently take those jobs out of the crontab
-   A job whose `fileName` reaches outside the cron folder is refused rather than run. Only a hand-edited or synced `data.json` can produce one, since `fileName` became a path when nested folders were added
-   Documented that a synced vault is a code delivery channel, and that changing the contents of an already-enabled script, or editing `data.json` directly, changes what runs
-   The macOS protected-folder warning now leads with moving the vault somewhere unprotected, and spells out the scope of a Full Disk Access grant rather than simply recommending it

## 2025-05-09

### Added

-   Release section in the README, covering the Actions permissions needed and how to tag a version

### Fixed

-   Missing `fs` and `path` imports in `esbuild.config.mjs`

### Changed

-   README wording and spacing

## 2025-05-08

### Added

-   Initial Obsidian plugin starter template with Svelte support: esbuild config with `esbuild-svelte` and `svelte-preprocess`, `src/obsidian` and `src/svelte` source layout, and a GitHub Actions release workflow
