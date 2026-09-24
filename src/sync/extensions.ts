export interface ExtensionsDiff {
	toInstall: string[];
	toUninstall: string[];
}

export function computeExtensionDiff(
	currentContent: string,
	targetContent: string | undefined,
): ExtensionsDiff {
	const current = new Set<string>(JSON.parse(currentContent));
	const target = new Set<string>(
		targetContent ? JSON.parse(targetContent) : [],
	);

	return {
		toInstall: [...target].filter((id) => !current.has(id)),
		toUninstall: [...current].filter((id) => !target.has(id)),
	};
}
