// Consumer-owned example, not a public package export. One owner per application.
export function ownRuntime<T extends { close(): Promise<void> }>(open: () => Promise<T>) {
  let opening: Promise<T> | undefined;
  let closing = false;
  let closeOperation: Promise<void> | undefined;

  function ready(): Promise<T> {
    if (closing) return Promise.reject(new Error("Flag runtime is closing."));
    if (opening === undefined) {
      // Reserve the promise before invoking a factory that can synchronously reenter.
      const operation = Promise.resolve().then(open);
      opening = operation;
      void operation.catch(() => {
        if (opening === operation) opening = undefined;
      });
    }
    return opening.then((runtime) => {
      if (closing) throw new Error("Flag runtime is closing.");
      return runtime;
    });
  }

  function close(): Promise<void> {
    if (closeOperation !== undefined) return closeOperation;
    closing = true;
    const pending = opening;
    closeOperation = Promise.resolve().then(async () => {
      if (pending !== undefined) await (await pending).close();
    });
    return closeOperation;
  }

  return { ready, close };
}
