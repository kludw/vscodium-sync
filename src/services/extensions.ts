import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { LocalState, SyncItem } from "@services/sync";
import { sameJson, toSortedJson } from "@util/json";
import { JsoncFile } from "@util/jsonc-file";
import type { Logger } from "@util/log";
import { type Result, toError } from "@util/result";
import * as vscode from "vscode";

/** Extension IDs (`publisher.name`, lowercase), sorted. */
export type ExtensionList = string[];

/** The editor's registry of installed extensions, inside the extensions folder. */
const REGISTRY_FILE = "extensions.json";
/** globalState key: synced extensions that couldn't be installed here (e.g. not on Open VSX). */
const UNAVAILABLE_KEY = "extensions.unavailable";

/**
 * Installed extensions, mirrored both ways: pulls install what's missing and uninstall what's
 * extra.
 *
 * The list comes from the extensions folder's extensions.json, which the editor rewrites on every
 * install and uninstall from any window. (`vscode.extensions` only reflects what this window has
 * loaded, so it misses changes made elsewhere.) It includes disabled extensions, so disabling one
 * doesn't count as removing it.
 *
 * Extensions that fail to install are remembered as unavailable and still count as part of the
 * local list. Otherwise the gap would look like a local removal and get pushed to every machine.
 * They're retried on each pull.
 */
export class ExtensionsService implements SyncItem<"extensions"> {
	readonly key = "extensions";
	readonly label = "extensions";
	readonly fileName = "extensions.json";
	private readonly registry: JsoncFile;

	/** @param ownId This extension's ID, which is never synced. */
	constructor(
		private readonly ownId: string,
		private readonly state: vscode.Memento,
		private readonly log: Logger,
	) {
		const dir = findExtensionsDir();
		log.info(`Extensions folder: ${dir.fsPath}`);
		this.registry = new JsoncFile(
			vscode.Uri.joinPath(dir, REGISTRY_FILE),
			"[]\n",
			log,
		);
	}

	isValid(value: unknown): value is ExtensionList {
		return Array.isArray(value) && value.every((id) => typeof id === "string");
	}

	async read(): Promise<Result<LocalState<ExtensionList>>> {
		const installed = await this.installed();

		if (installed.error) {
			return { error: installed.error };
		}

		const value = withUnavailable(installed.value.ids, this.unavailable());
		this.log.debug(`${value.length} extension(s) installed or unavailable`);
		return {
			value: {
				value,
				text: toSortedJson(value),
				modifiedAt: installed.value.modifiedAt,
			},
		};
	}

	async write(
		local: LocalState<ExtensionList>,
		next: ExtensionList,
	): Promise<Result<LocalState<ExtensionList>>> {
		const current = await this.installed();

		if (current.error) {
			return { error: current.error };
		}

		const installed = new Set(current.value.ids);
		const unavailable = new Set(this.unavailable());
		const failedInstalls: string[] = [];
		const failedUninstalls: string[] = [];

		// Includes previously unavailable ones, so they're retried.
		for (const id of next.filter((id) => !installed.has(id))) {
			try {
				this.log.info(`Installing ${id}`);
				await vscode.commands.executeCommand(
					"workbench.extensions.installExtension",
					id,
				);
				installed.add(id);
				unavailable.delete(id);
			} catch (error) {
				this.log.error(`Installing ${id} failed:`, error);
				unavailable.add(id);
				failedInstalls.push(`${id} (${toError(error).message})`);
			}
		}

		for (const id of local.value.filter((id) => !next.includes(id))) {
			if (unavailable.delete(id)) {
				// Never installed here, so there's nothing to uninstall.
				continue;
			}

			try {
				this.log.info(`Uninstalling ${id}`);
				await vscode.commands.executeCommand(
					"workbench.extensions.uninstallExtension",
					id,
				);
				installed.delete(id);
			} catch (error) {
				this.log.error(`Uninstalling ${id} failed:`, error);
				failedUninstalls.push(`${id} (${toError(error).message})`);
			}
		}

		await this.state.update(UNAVAILABLE_KEY, [...unavailable].sort());

		if (failedInstalls.length > 0) {
			vscode.window.showWarningMessage(
				`VSCodium Sync: couldn't install ${failedInstalls.join(", ")}. Will retry on the next sync from the cloud.`,
			);
		}

		const value = withUnavailable([...installed], [...unavailable]);

		if (failedUninstalls.length > 0) {
			const message = `Extensions: couldn't uninstall ${failedUninstalls.join(", ")}`;

			if (sameJson(value, local.value)) {
				return { error: new Error(message) };
			}

			// Partly applied: report what actually happened, so the failed part is retried next sync.
			vscode.window.showWarningMessage(`VSCodium Sync: ${message}`);
		}

		return {
			value: { value, text: toSortedJson(value), modifiedAt: Date.now() },
		};
	}

	/** Fires on installs and uninstalls from any window, via the registry file. */
	watch(onChange: () => void): vscode.Disposable {
		return this.registry.watch(onChange);
	}

	private unavailable(): ExtensionList {
		return this.state.get<ExtensionList>(UNAVAILABLE_KEY) ?? [];
	}

	/** Installed extension IDs (excluding this one) from the registry, and when it last changed. */
	private async installed(): Promise<
		Result<{ ids: ExtensionList; modifiedAt: number }>
	> {
		const snapshot = await this.registry.read();

		if (snapshot.error) {
			return { error: snapshot.error };
		}

		const { value, modifiedAt } = snapshot.value;

		if (!Array.isArray(value)) {
			return { error: new Error(`${REGISTRY_FILE} must contain an array`) };
		}

		const ids = value
			.map((entry: unknown) => registryId(entry))
			.filter((id): id is string => id !== undefined)
			.filter((id) => id !== this.ownId.toLowerCase());
		return { value: { ids: [...new Set(ids)].sort(), modifiedAt } };
	}
}

const withUnavailable = (
	installed: ExtensionList,
	unavailable: ExtensionList,
): ExtensionList => [...new Set([...installed, ...unavailable])].sort();

/** `identifier.id` of a registry entry, lowercased; undefined if the entry is malformed. */
const registryId = (entry: unknown): string | undefined => {
	const id = (entry as { identifier?: { id?: unknown } } | null)?.identifier
		?.id;
	return typeof id === "string" ? id.toLowerCase() : undefined;
};

/**
 * The extensions folder. No API exposes it, so use the parent folder of an installed extension
 * that has the registry next to it; failing that, $VSCODE_EXTENSIONS or VSCodium's default.
 */
const findExtensionsDir = (): vscode.Uri => {
	const appRoot = vscode.env.appRoot;

	for (const extension of vscode.extensions.all) {
		if (extension.extensionUri.fsPath.startsWith(appRoot)) {
			continue; // Built-in.
		}

		const parent = vscode.Uri.joinPath(extension.extensionUri, "..");

		if (extension.extensionUri.scheme === "file" && hasRegistry(parent)) {
			return parent;
		}
	}

	return vscode.Uri.file(
		process.env.VSCODE_EXTENSIONS ?? `${homedir()}/.vscode-oss/extensions`,
	);
};

// Synchronous, since it runs once while constructing; vscode.workspace.fs has no sync API.
const hasRegistry = (dir: vscode.Uri): boolean =>
	existsSync(vscode.Uri.joinPath(dir, REGISTRY_FILE).fsPath);
