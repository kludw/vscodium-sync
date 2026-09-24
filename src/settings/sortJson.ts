/**
 * Alphabetises object keys recursively so the synced settings.json reads consistently
 * both locally and in the gist. Falls back to the original content unchanged if it isn't
 * valid JSON (e.g. settings.json using VS Code's JSONC comment support) rather than
 * failing the sync - comments would be silently lost by a parse/stringify round-trip,
 * so this only sorts content it can safely round-trip.
 */
export function sortJsonKeys(content: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return content;
	}
	return `${JSON.stringify(sortValueKeys(parsed), null, 2)}\n`;
}

function sortValueKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValueKeys);
	if (value !== null && typeof value === "object") {
		const sortedEntries = Object.entries(value as Record<string, unknown>).sort(
			([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
		);
		return Object.fromEntries(
			sortedEntries.map(([key, entryValue]) => [
				key,
				sortValueKeys(entryValue),
			]),
		);
	}
	return value;
}
