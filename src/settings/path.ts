import { join as joinPosix } from "node:path/posix";
import { join as joinWin32 } from "node:path/win32";

export function resolveSettingsPath(
	platform: NodeJS.Platform,
	homedir: string,
): string {
	switch (platform) {
		case "darwin":
			return joinPosix(
				homedir,
				"Library",
				"Application Support",
				"VSCodium",
				"User",
				"settings.json",
			);
		case "win32":
			return joinWin32(
				homedir,
				"AppData",
				"Roaming",
				"VSCodium",
				"User",
				"settings.json",
			);
		default:
			return joinPosix(homedir, ".config", "VSCodium", "User", "settings.json");
	}
}
