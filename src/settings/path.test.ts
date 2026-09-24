import { describe, expect, test } from "bun:test";
import { resolveKeybindingsPath, resolveSettingsPath } from "./path";

describe("resolveSettingsPath", () => {
	test("darwin", () => {
		expect(resolveSettingsPath("darwin", "/Users/kam")).toBe(
			"/Users/kam/Library/Application Support/VSCodium/User/settings.json",
		);
	});

	test("win32", () => {
		expect(resolveSettingsPath("win32", "C:\\Users\\kam")).toBe(
			"C:\\Users\\kam\\AppData\\Roaming\\VSCodium\\User\\settings.json",
		);
	});

	test("linux falls back to XDG config path", () => {
		expect(resolveSettingsPath("linux", "/home/kam")).toBe(
			"/home/kam/.config/VSCodium/User/settings.json",
		);
	});
});

describe("resolveKeybindingsPath", () => {
	test("darwin", () => {
		expect(resolveKeybindingsPath("darwin", "/Users/kam")).toBe(
			"/Users/kam/Library/Application Support/VSCodium/User/keybindings.json",
		);
	});

	test("win32", () => {
		expect(resolveKeybindingsPath("win32", "C:\\Users\\kam")).toBe(
			"C:\\Users\\kam\\AppData\\Roaming\\VSCodium\\User\\keybindings.json",
		);
	});

	test("linux falls back to XDG config path", () => {
		expect(resolveKeybindingsPath("linux", "/home/kam")).toBe(
			"/home/kam/.config/VSCodium/User/keybindings.json",
		);
	});
});
