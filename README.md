# Cron

Schedule cron jobs on your machine from inside [Obsidian](https://obsidian.md).

Point the plugin at a folder of shell scripts and it manages the corresponding cron jobs for you, so you can create, edit, and remove schedules without leaving your vault.

---

## How it works

Put your shell scripts in the `cron` folder inside your vault's config folder:

```
<your vault>/.obsidian/cron/
```

The plugin picks up every `.sh` file it finds there, **including the ones in subfolders**, and lists them under **Settings > Cron**. A newly discovered script starts out **disabled**, so nothing runs until you give it a schedule and turn it on. Enabling a job writes it to your crontab; disabling it takes it back out.

```
<your vault>/.obsidian/cron/
├── nightly-backup.sh          ->  "Nightly backup"
├── backup/
│   └── nightly-sync.sh        ->  "Backup / Nightly sync"
└── lib/
    └── _shared.sh             ->  "Lib / Shared"
```

A nested script is named after the folders it sits in, so two scripts called `backup.sh` in different folders are still told apart in the command palette. The name is only a starting point — rename a job and the plugin leaves your name alone from then on.

Each job has:

-   a **name**, which is yours to change and is only used for display and for the command palette
-   a **schedule**, written as a standard five-field cron expression (`0 3 * * *`) or a macro (`@daily`)
-   an **enable toggle**

Every job also gets a **Run script: \<name\>** command in the command palette, so you can run it immediately instead of waiting for its schedule. A manual run goes through the same runner as a scheduled one, so the two behave identically.

### Ordering the list

Jobs are listed in the order you put them in. Drag a job by the handle on the left of its card, or focus the handle and use the arrow keys, and the list stays that way — the order lives in the plugin's `data.json` and comes back the next time you open Obsidian. A newly discovered script is added at the **bottom**, so an arrangement you have already made never shifts underneath you.

The order is cosmetic as far as cron is concerned, but the plugin follows it everywhere. Moving an **enabled** job rewrites the managed block so its lines read in the same order as the settings pane; lines outside the block are still never touched. The **Run script** commands are re-registered in the new order too, though the command palette applies its own recency and fuzzy ranking on top of that.

### Folders

Subfolders are scanned up to eight levels deep. A few things are skipped:

-   `logs/`, `locks/` and `_runner.sh` at the **top level**, which are the plugin's own. The same names further down are yours, so `backup/logs/rotate.sh` is picked up like anything else
-   anything whose name starts with a `.`, at any depth
-   whatever the two ignore settings match

Symlinked folders are followed, and a link pointing back at a folder above it is recognised rather than walked in circles.

#### Ignoring folders and files

**Ignored folders** and **Ignored files** in the settings are comma-separated lists. An entry decides how much it matches by whether it contains a slash:

| Setting | Entry | Skips | Leaves alone |
| --- | --- | --- | --- |
| Ignored folders | `lib` | `lib/`, `backup/lib/`, `a/b/lib/` | a file called `lib` |
| Ignored folders | `archive/2024` | `archive/2024/` and everything under it | `archive/2025/`, `backup/archive/2024/` |
| Ignored files | `_shared.sh` | `_shared.sh`, `tools/_shared.sh` | a folder called `_shared.sh` |
| Ignored files | `tools/wip.sh` | exactly `tools/wip.sh` | `other/wip.sh`, `a/tools/wip.sh` |

Matching ignores case, so `Lib` and `lib` are the same entry.

Ignoring a folder that holds an **enabled** job takes that job out of your crontab and marks it as excluded. The job itself is kept, with its name and schedule, and comes back the moment you remove the entry.

A folder the plugin cannot read stops the scan rather than being treated as empty — an unreadable folder and a folder whose scripts have all been deleted look the same from the outside, and acting on the second reading would silently unschedule your jobs. The error names the folder; add it to **Ignored folders** to skip past it.

### Moving a script

Moving a script to another folder keeps its job — its name, its schedule, its enable state and its log — as long as the move is unambiguous: exactly one job lost that filename and exactly one new script turned up with it. If two scripts with the same filename move at once, or if you rename a script rather than move it, the old job is marked missing and the script arrives as a new, disabled job.

### Your existing cron jobs are safe

Everything this plugin writes lives inside a delimited block:

```
# BEGIN obsidian-cron
...
# END obsidian-cron
```

Lines outside that block are never touched. If the block is ever damaged — say the `# END` line gets deleted — the plugin refuses to write anything at all and tells you, rather than guessing where the block ends.

To remove the block yourself at any time, use **Remove all managed jobs now** in the settings. That also turns every job off, so the block does not come back the next time something changes.

### Writing a script

Scripts need the executable bit set. If one is missing it, the settings tab says so and offers a **Make executable** button.

```bash
#!/bin/sh
echo "Backing up..."
```

Each run gets:

-   the **vault root** as its working directory
-   `OBSIDIAN_VAULT_PATH` and `OBSIDIAN_CRON_JOB_ID` in its environment
-   a log at `.obsidian/cron/logs/<job id>.log`, trimmed once it passes the size limit in settings

If a scheduled run comes around while the previous one is still going, it is skipped rather than run twice.

### PATH and your shell

Jobs run under your **login shell**, which reads `.zprofile` (or `.bash_profile`) but **not** `.zshrc` — that file is only read by interactive shells. Homebrew's installer writes to `.zprofile`, so `/opt/homebrew/bin` is normally on the path. Tools you set up in `.zshrc` will not be.

If something is missing, either add its directory to **Extra PATH entries** in settings or use an absolute path in your script. The settings tab shows the exact `PATH` your scheduled jobs will see.

### macOS: scheduled jobs and protected folders

macOS blocks `cron` from reaching `~/Desktop`, `~/Documents`, `~/Downloads` and iCloud Drive, and the failure is **silent** — the job simply never does anything. The plugin warns you when your vault is in one of these folders.

**The simplest fix is to keep your vault somewhere else**, such as `~/Vaults` or `~/Notes`. Those paths are not protected, so nothing needs granting and scheduled jobs work immediately.

If the vault has to stay where it is, the alternative is to grant Full Disk Access to cron:

1. Open **System Settings > Privacy & Security > Full Disk Access**
2. Click **+**, press **Cmd-Shift-G**, and enter `/usr/sbin/cron`
3. Enable the entry

Weigh that up before doing it. The grant goes to `/usr/sbin/cron` itself and is inherited by **every** job in **every** crontab, not only this plugin's, including ones added later. Full Disk Access is also wider than the folders you are trying to reach: it covers Mail, Messages, Safari data, Time Machine backups and other apps' sandboxed containers.

Note that using `launchd` instead does not avoid this. A LaunchAgent inherits launchd's own permissions, not those of whatever loaded it, and hits the same denial.

Running a job from the command palette works either way, because it inherits Obsidian's own permissions. So "works when I press Run now, never runs on schedule" is almost always this.

### Quitting versus disabling

Jobs keep running when Obsidian is closed — that is the point of using system cron. Quitting the app leaves your crontab alone.

Disabling or uninstalling the plugin removes its block from your crontab. You can turn that off with **Remove jobs when the plugin is disabled**.

---

## Security

Your scripts run with your full user privileges, exactly as if you had typed them into a terminal. A few things follow from that.

**New scripts never run on their own.** A script the plugin discovers is added **disabled**, with no schedule in your crontab, until you turn it on yourself.

**A vault that syncs is a code delivery channel.** If you use Obsidian Sync, iCloud, Dropbox or git, then whatever can write to your vault can put a script in `.obsidian/cron` **or in any folder inside it**. It will not run until you enable it, but two cases deserve care:

-   changing the **contents** of a script that is already enabled changes what runs, with no further confirmation
-   `.obsidian/plugins/cron/data.json` holds the enabled flags, so editing that file directly can schedule a job

Treat `.obsidian/cron` and everything under it as trusted code, the same way you would treat anything else you run on a schedule. A symlinked folder inside it extends that trust to wherever the link points, which may be outside the vault entirely.

**The ignore lists are convenience, not a boundary.** They keep scripts out of the job list and out of your crontab. They are not a sandbox, and they do nothing about a script you run some other way.

**Only jobs you enable reach your crontab**, inside a delimited block, and your own cron jobs are never modified.

---

## Platform support

macOS and Linux only. Windows is not supported, as it has no `cron`.

This is a desktop plugin. It does not run on Obsidian mobile.

Requires Obsidian 1.14.0 or newer.

---

## Development

### Requirements

-   [Bun](https://bun.sh/) — installs dependencies and runs the build scripts
-   Node.js v22 — recommended

Check what you have installed:

```bash
bun --version
node --version
```

### Getting started

1. Install dependencies:

    ```bash
    bun install
    ```

2. Start a watch build. It compiles into `dist/` and rebuilds whenever you save:

    ```bash
    bun run dev
    ```

    For a one-off production build, run `bun run build`.

   Run the test suite with `bun test`. It covers the crontab splicing, the cron expression validator, the folder scan and its ignore rules, job reconciliation, per-job diagnostics, and the generated runner script end to end.

3. Link `dist/` into your vault so Obsidian can load the plugin. The folder name must match the `id` in `manifest.json`:

    ```bash
    ln -s ~/Desktop/public-repos/obsidian-cron/dist ~/Desktop/obsidian-development/.obsidian/plugins/cron
    ```

4. Open Obsidian, go to **Community plugins**, and enable Cron

### Reloading after each build

Obsidian does not pick up new plugin files on its own. If you have the official [Obsidian CLI](https://obsidian.md/help/cli) enabled, the build reloads the plugin for you.

1. Turn the CLI on in Obsidian under **Settings → General → Command line interface** (needs the 1.12.7 installer or newer), then follow the prompt to add it to your PATH. Check it with:

    ```bash
    obsidian version
    ```

2. Copy the example env file and fill in the vault you develop against:

    ```bash
    cp .env.example .env
    ```

    ```bash
    OBSIDIAN_VAULT=obsidian-development
    ```

    Run `obsidian vaults` to list the vault names Obsidian knows about.

Every successful build now reloads the plugin in that vault, whether it came from `bun run dev` or `bun run build`. To reload without rebuilding:

```bash
bun run reload
```

The plugin to reload comes from the `id` field in `manifest.json`. If the folder you linked into `.obsidian/plugins` is named something else, set `OBSIDIAN_PLUGIN_ID` in `.env` to match the folder.

Reloading is entirely optional. With no `.env`, or without the CLI installed, the build prints a short note once and carries on. Note that the CLI starts Obsidian if it is not already running.

### Releases

The included [workflow](.github/workflows/release.yml) builds the plugin and attaches the files to a GitHub release whenever you push a tag.

First, give the workflow permission to create releases:

1. Open the repository on GitHub
2. Go to **Settings → Actions → General**
3. Under **Workflow permissions**, select **Read and write permissions**
4. Click **Save**

Then tag a version and push it:

```bash
git tag 0.1.0
git push origin 0.1.0
```

Tags are bare version numbers, with no `v` prefix (see `.npmrc`).

---

## Credits

Built from the [Obsidian Svelte plugin starter](https://github.com/decaf-dev/obsidian-svelte-plugin-starter), an extension of the official [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin).

## License

[MIT](LICENSE)
