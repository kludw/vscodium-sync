import { beforeEach, expect, test } from "bun:test";
import { CloudService } from "@services/cloud";
import type { ChangeCheck } from "@services/gist";
import { SignInRequiredError } from "@services/github";
import { fake, resetFake, setFocused } from "./fake-vscode";
import { sleep, testLogger } from "./helpers";

beforeEach(resetFake);

const cloud = (hasChanged: () => Promise<ChangeCheck>) => {
	const changes: string[] = [];
	const service = new CloudService({ hasChanged }, testLogger(), () =>
		changes.push("changed"),
	);
	return { service, changes };
};

test("checks when the window gains focus and reports changes", async () => {
	let changed = false;
	const { service, changes } = cloud(async () => ({ changed }));

	setFocused(true);
	await sleep(5);
	expect(changes).toEqual([]);

	changed = true;
	setFocused(true);
	await sleep(5);
	expect(changes).toEqual(["changed"]);
	service.dispose();
});

test("doesn't overlap checks", async () => {
	let calls = 0;
	const { service } = cloud(async () => {
		calls++;
		await sleep(20);
		return { changed: false };
	});

	setFocused(true);
	setFocused(true);
	await sleep(40);

	expect(calls).toBe(1);
	service.dispose();
});

test("logs failures quietly instead of throwing; not signed in is only debug", async () => {
	let error: Error = new SignInRequiredError();
	const { service } = cloud(async () => {
		throw error;
	});

	setFocused(true);
	await sleep(5);
	error = new Error("offline");
	setFocused(true);
	await sleep(5);

	expect(fake.logs).toEqual([
		"debug Not signed in, skipping cloud check",
		"warn Cloud check failed: offline",
	]);
	expect(fake.messages).toEqual([]);
	service.dispose();
});

test("stops listening once disposed", async () => {
	let calls = 0;
	const { service } = cloud(async () => {
		calls++;
		return { changed: false };
	});

	service.dispose();
	setFocused(true);
	await sleep(5);

	expect(calls).toBe(0);
});
