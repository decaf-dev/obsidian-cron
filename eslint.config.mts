import js from '@eslint/js';
import obsidianmd from 'eslint-plugin-obsidianmd';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelteParser from 'svelte-eslint-parser';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'reload-plugin.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'bun.lock',
		'tsconfig.json',
	]),
	js.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json', '.svelte'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// These timers belong to the plugin rather than to any window, and both
		// modules are unit tested outside Obsidian, where `window` does not exist.
		files: ['src/obsidian/exec.ts', 'src/obsidian/script-scanner.ts'],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
	{
		// Tests exercise the pure modules directly; the plugin-review rules
		// target runtime code and only produce noise here.
		files: ['tests/**/*.ts'],
		rules: {
			'obsidianmd/hardcoded-config-path': 'off',
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
	...svelte.configs.recommended,
	{
		files: ['src/**/*.ts', 'src/**/*.svelte.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tseslint.parser,
			},
		},
	},
	{
		files: ['**/*.ts', '**/*.mts', '**/*.svelte', '**/*.svelte.ts'],
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		rules: {
			'no-unused-vars': 'off',
			'no-prototype-builtins': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-empty-function': 'off',
		},
	},
);
