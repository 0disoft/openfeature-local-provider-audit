# Bounded S3-compatible snapshot source

Status: accepted P3 implementation contract under ADR 0015.

`createS3SnapshotSource({ client, bucket, key, maxBytes?, timeoutMs?, maxAttempts?,
retryDelayMs? })` returns the existing SnapshotSource. The caller owns the real SDK
client, credentials, HTTPS endpoint/TLS policy, IAM/R2 read permissions and shutdown.
No credentials, signing implementation or SDK runtime dependency is installed.
Use the same source with AWS S3 or an SDK client configured for Cloudflare R2.

`S3SnapshotClient.getObject({ Bucket, Key, IfNoneMatch? }, { abortSignal })` is a
structural promise API compatible with the AWS SDK v3 aggregated S3 client.
S3Client users can wrap send(new GetObjectCommand(input), options). The adapter
passes the exact quoted ETag from the existing refresher and maps conditional 304
responses/exceptions to notModified. Unexpected 304, partial/error statuses and
missing/invalid bodies reject. ETags are opaque validators, not integrity digests.
Signing and durable acceptance remain the existing verifier/store/refresher's job.

Defaults/ranges match HTTPS: 10 MiB bytes (1..100 MiB), 5-second per-attempt total
deadline (1..60,000 ms), 3 attempts (1..5), exponential retry delay starting at
100 ms (0..5,000, capped at 5,000). Configure underlying SDK maxAttempts: 1 so
adapter bounds count actual SDK attempts; caller middleware/credential providers
must honor cancellation and not create additional unbounded work.

The deadline covers credential/transport wait and body consumption. Cancellation
interrupts waiting/backoff and closes available streams. Late bodies after timeout
are closed too. A custom client that ignores abort may continue its own work;
the adapter does not wait indefinitely for its promise or iterator cleanup.
Successful bytes are copied into bounded memory. Node async-iterable byte streams,
Web readable streams and Blob streams are supported, with runtime validation.
No transformToByteArray call may bypass streaming bounds. Declared length is checked
before reading and must equal final bytes when present. Compressed bodies reject.

Bucket identifiers are nonempty bounded safe labels/ARN-like strings; object keys
are well-formed Unicode of 1..1,024 UTF-8 bytes. Endpoint selection remains client
configuration, never per-evaluation input. Error messages omit bucket/key, endpoint,
credentials, SDK causes and response content. Only transient network/408/429/5xx
errors retry; authentication, not-found, body/length/schema errors fail visibly.

Compose with createSnapshotRefresher, optional pinned signed verifier and durable
store. Rejected bytes never advance the committed ETag or active snapshot. A refresh
performs object I/O; evaluations never do. Creating the source starts no request,
timer or worker. The source does not close the shared client.

Required evidence: actual AWS SDK declaration assignability and local HTTP protocol
fixtures (without credentials), correct Bucket/Key/IfNoneMatch and 200/304/errors,
stream/declared limits, stalled transport/body, cancellation, finite retries,
late-response cleanup and signed durable refresh/last-good/offline evaluation.
Production account credentials, IAM, regional routing and R2 account behavior remain
unverified without separately authorized access; no cloud resources are provisioned.

Protocol references: [AWS GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
[Cloudflare R2 SDK configuration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).
