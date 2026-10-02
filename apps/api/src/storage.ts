import { createHash, randomBytes } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function storageConfig() {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const missing = [
    ['STORAGE_ENDPOINT', endpoint],
    ['STORAGE_BUCKET', bucket],
    ['STORAGE_ACCESS_KEY', accessKeyId],
    ['STORAGE_SECRET_KEY', secretAccessKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Private object storage is not configured: ${missing.join(', ')}`);
  }
  return { endpoint: endpoint!, bucket: bucket!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! };
}

function storageClient(config: ReturnType<typeof storageConfig>) {
  return new S3Client({
    endpoint: config.endpoint,
    region: process.env.STORAGE_REGION ?? 'auto',
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'payment-proof';
}

export function validateProofFile(filename: string, mimeType: string, byteSize: number) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error('Only JPG, PNG, WEBP, or PDF payment proofs are allowed');
  if (byteSize <= 0 || byteSize > MAX_PROOF_BYTES) throw new Error('Payment proof must be between 1 byte and 10 MB');
  return safeFilename(filename);
}

export async function uploadPaymentProofFile(input: {
  paymentProofId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const config = storageConfig();
  const filename = validateProofFile(input.filename, input.mimeType, input.bytes.byteLength);
  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const key = `payment-proofs/${new Date().toISOString().slice(0, 10)}/${input.paymentProofId}/${randomBytes(8).toString('hex')}-${filename}`;
  const client = storageClient(config);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: input.bytes,
    ContentType: input.mimeType,
    ContentLength: input.bytes.byteLength,
    Metadata: { proof_id: input.paymentProofId, checksum_sha256: checksum },
  }));
  return { storageKey: key, originalFilename: filename, mimeType: input.mimeType, byteSize: input.bytes.byteLength, checksumSha256: checksum };
}

export async function createPaymentProofViewUrl(storageKey: string) {
  const config = storageConfig();
  const client = storageClient(config);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }), { expiresIn: 300 });
}

export async function runStorageSmokeTest() {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const uploaded = await uploadPaymentProofFile({
    paymentProofId: 'storage-smoke-test',
    filename: 'storage-smoke-test.png',
    mimeType: 'image/png',
    bytes,
  });
  const config = storageConfig();
  try {
    await storageClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: uploaded.storageKey }));
  } catch (error) {
    throw new Error(`Storage upload succeeded but cleanup failed: ${(error as Error).message}`);
  }
  return { status: 'PASS' as const, byteSize: uploaded.byteSize, checksumSha256: uploaded.checksumSha256 };
}
