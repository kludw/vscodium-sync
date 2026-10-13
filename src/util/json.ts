/** JSON.stringify with object keys sorted, so equal values serialize identically regardless of key order. */
export const stableStringify = (value: unknown): string =>
	JSON.stringify(value, (_key, inner: unknown) =>
		inner && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)),
				)
			: inner,
	);

/** True if both values contain the same data, ignoring object key order. */
export const sameJson = (a: unknown, b: unknown): boolean =>
	stableStringify(a) === stableStringify(b);
