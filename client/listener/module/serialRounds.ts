/** [changmen 扩展] One execution body at a time; stopping skips queued work and drains the current body. */
export class SerialRounds {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  run(work: () => Promise<void>): Promise<void> {
    const generation = this.generation;
    const result = this.tail.then(async () => { if (generation === this.generation) await work(); });
    this.tail = result.catch(() => {});
    return result;
  }
  cancel(): Promise<void> { this.generation += 1; return this.tail; }
}
