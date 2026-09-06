# Cron

Schedule cron jobs on your machine from inside [Obsidian](https://obsidian.md).

Point the plugin at a folder of shell scripts and it manages the corresponding cron jobs for you, so you can create, edit, and remove schedules without leaving your vault.

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
