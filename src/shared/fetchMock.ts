import { spyOn } from "bun:test";

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

// biome-ignore lint/suspicious/noExplicitAny: bun-types' `typeof fetch` carries a static `preconnect` member a mock fn has no need to satisfy
export function mockFetch(): any {
	return spyOn(global, "fetch");
}
