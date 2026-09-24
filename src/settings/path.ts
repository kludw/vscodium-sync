import { join as joinPosix } from "node:path/posix";
import { join as joinWin32 } from "node:path/win32";

export function resolveKeybindingsPath(
	platform: NodeJS.Platform,
	homedir: string,
): string {
	return resolveUserFilePath(platform, homedir, "keybindings.json");
}

export function resolveSettingsPath(
	platform: NodeJS.Platform,
	homedir: string,
): string {
	return resolveUserFilePath(platform, homedir, "settings.json");
}

function resolveUserFilePath(
	platform: NodeJS.Platform,
	homedir: string,
	filename: string,
): string {
	switch (platform) {
		case "darwin":
			return joinPosix(
				homedir,
				"Library",
				"Application Support",
				"VSCodium",
				"User",
				filename,
			);
		case "win32":
			return joinWin32(
				homedir,
				"AppData",
				"Roaming",
				"VSCodium",
				"User",
				filename,
			);
		default:
			return joinPosix(homedir, ".config", "VSCodium", "User", filename);
	}
}
