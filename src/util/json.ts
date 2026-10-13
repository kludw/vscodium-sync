/** Fixed locale, so every machine produces the same order (a differing order would look like a change). */
const compareKeys = (a: string, b: string): number => a.localeCompare(b, "en");

/** Copy of `value` with object keys sorted alphabetically at every level. Arrays keep their order. */
export const sortKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map(sortKeys);
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => compareKeys(a, b))
				.map(([key, inner]) => [key, sortKeys(inner)]),
		);
	}

	return value;
};

/** Pretty JSON with sorted keys and a trailing newline. */
export const toSortedJson = (
	value: unknown,
	indent: string | number = 2,
	eol = "\n",
): string =>
	`${JSON.stringify(sortKeys(value), null, indent)}\n`.replaceAll("\n", eol);

/** True if both values contain the same data, ignoring object key order. */
export const sameJson = (a: unknown, b: unknown): boolean =>
	JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
