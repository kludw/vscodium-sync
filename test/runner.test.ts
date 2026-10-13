import { expect, test } from "bun:test";
import { SerialRunner } from "@util/runner";
import { sleep } from "./helpers";

test("a burst of triggers during a run queues exactly one more run, never overlapping", async () => {
	let runs = 0;
	let active = 0;
	let maxActive = 0;
	const runner = new SerialRunner(
		async () => {
			runs++;
			active++;
			maxActive = Math.max(maxActive, active);
			await sleep(20);
			active--;
		},
		() => {},
	);

	runner.run();
	for (let i = 0; i < 10; i++) {
		runner.run();
	}
	await sleep(100);

	expect(runs).toBe(2);
	expect(maxActive).toBe(1);

	runner.run();
	await sleep(40);
	expect(runs).toBe(3);
});

test("a failing task is reported and doesn't block later runs", async () => {
	const errors: unknown[] = [];
	let runs = 0;
	const runner = new SerialRunner(
		async () => {
			runs++;
			throw new Error("boom");
		},
		(error) => errors.push(error),
	);

	runner.run();
	await sleep(5);
	runner.run();
	await sleep(5);

	expect(runs).toBe(2);
	expect(errors).toHaveLength(2);
});
