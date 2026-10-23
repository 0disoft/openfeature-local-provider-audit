// Writer batches and crash recovery share the same hard limits.
export const MAX_CHAIN_BATCH_RECORDS = 64;
export const MAX_CHAIN_BATCH_BYTES = 4 * 1024 * 1024;
