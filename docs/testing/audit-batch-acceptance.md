# Chained audit batch evidence

Local acceptance, 2026-10-23, 2.0.0-alpha.28. No public release or power-loss
certification is implied. Contract: ../library/audit-chain.md.

- Queue tests cover FIFO grouping, count/byte reservations, arrivals during I/O,
  group rejection, progress after failure, one-time flush accounting and oversized
  singleton handling. Plain file queue semantics remain covered by queue-bytes tests.
- Real file tests cover 65 requests split into 64+1 with two manifest publications,
  confirmation blocked until metadata publication completes, exact encoded-byte
  splitting, singleton opt-out and rotation/retention across a group.
- Injected manifest replacement failure rejects all grouped callers without retry.
  Restart verifies/adopts multiple records in either the current suffix or a new
  rotation orphan. A later failed chunk preserves the committed prefix and prevents
  subsequent segment writes. Partial or corrupt evidence remains untouched.
- Recovery tests accept 64 contiguous records and reject 65, partial final lines,
  corrupt middle records and oversized suffixes without changing committed metadata.
- Two independent Node processes submit five-record bursts against the same owner
  lock; full verification confirms ten records without sequence/hash divergence.

On Windows with Node 24.14.0, three alternating runs of 128 concurrent requests
compared the same writer with batchSize 1 versus 64. Median durable completion was
2526.4 ms versus 69.0 ms (36.6x faster in this local burst workload). All 768 output
records were checked for event order and fully chain-verified. This does not predict
production throughput, isolated sequential writes, network filesystems or power-loss
behavior; storage and workload determine the gain. No hosted runner was added.

Validation: full check (Node 24.14.0), focused 38-test audit regression suite,
and full library suite on Node 22.23.3 (503 passed, 8 Windows-specific skips).
The actual alpha.28 tarball installed and passed TypeScript 5.9.3 full library
and 7.0.2 consumer surface checks on Node 24.14.0. API exports remain 114/32
(root exports/runtime values) and 26/7 (core); only optional chained sink options
were added. Formatting/lint passed with two pre-existing informational lint notes.
No DB, dependencies, hosted runner or repository hygiene policy changed. Portable
core runtime tests were not repeated because core and its declaration surface did
not change. Real power-loss, network filesystems and cloud runtime faults were
not injected; their persistence semantics remain an operational limitation.
