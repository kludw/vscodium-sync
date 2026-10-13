/**
 * Runs an async task one at a time. Calling {@link run} while the task is running queues exactly
 * one more run, so a burst of triggers results in at most one extra run.
 */
export class SerialRunner {
	private running = false;
	private pending = false;

	constructor(
		private readonly task: () => Promise<void>,
		private readonly onError: (error: unknown) => void,
	) {}

	run(): void {
		if (this.running) {
			this.pending = true;
			return;
		}

		this.running = true;
		void (async () => {
			try {
				do {
					this.pending = false;

					try {
						await this.task();
					} catch (error) {
						this.onError(error);
					}
				} while (this.pending);
			} finally {
				this.running = false;
			}
		})();
	}
}
