/**
 * Trailing commit coalescer.
 *
 * Built for controls that fire continuously (scrubbing, volume) but must reach
 * the network once: values are *staged* locally while the user is dragging and
 * a single `flush()` on release performs exactly one side effect. `schedule()`
 * is the debounced variant for repeat-fire inputs such as a held arrow key.
 */

export interface DebouncedCommit<T> {
  /** Records the latest value and (re)starts the trailing timer. */
  schedule(value: T): void;
  /** Records the latest value *without* starting a timer — for drags. */
  stage(value: T): void;
  /** Performs the pending commit immediately, at most once. */
  flush(): void;
  /** Drops any pending value and cancels the timer. */
  cancel(): void;
  /** The value waiting to be committed, if any. */
  readonly pending: T | null;
}

export function createDebouncedCommit<T>(
  delayMs: number,
  commit: (value: T) => void,
): DebouncedCommit<T> {
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(value: T) {
      pending = value;
      clear();
      timer = setTimeout(() => {
        timer = null;
        const value_ = pending;
        pending = null;
        if (value_ !== null) commit(value_);
      }, delayMs);
    },
    stage(value: T) {
      pending = value;
    },
    flush() {
      clear();
      const value = pending;
      pending = null;
      if (value !== null) commit(value);
    },
    cancel() {
      clear();
      pending = null;
    },
    get pending() {
      return pending;
    },
  };
}
