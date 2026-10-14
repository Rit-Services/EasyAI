// Object storage for uploaded documents, backed by Garage (self-hosted,
// S3-compatible). Callers hand us already-encrypted bytes (see fieldCrypto's
// encryptBuffer) — this module only moves opaque buffers in and out of the
// bucket, keyed by Document.storageKey. It never sees plaintext.
//
// `isEnabled` is false when GARAGE_S3_ENDPOINT is unset (local dev), in which
// case documentController falls back to the local uploads/ directory.

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../../config');

const isEnabled = Boolean(config.garage.endpoint && config.garage.bucket);

let client = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: config.garage.endpoint,
      region: config.garage.region,
      forcePathStyle: true, // Garage has no vhost-style bucket routing configured
      credentials: {
        accessKeyId: config.garage.accessKeyId,
        secretAccessKey: config.garage.secretAccessKey,
      },
    });
  }
  return client;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function putObject(key, buffer) {
  await getClient().send(new PutObjectCommand({
    Bucket: config.garage.bucket,
    Key: key,
    Body: buffer,
  }));
}

async function getObject(key) {
  const res = await getClient().send(new GetObjectCommand({
    Bucket: config.garage.bucket,
    Key: key,
  }));
  return streamToBuffer(res.Body);
}

async function headObject(key) {
  try {
    const res = await getClient().send(new HeadObjectCommand({
      Bucket: config.garage.bucket,
      Key: key,
    }));
    return { exists: true, size: res.ContentLength };
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return { exists: false };
    throw err;
  }
}

async function deleteObject(key) {
  await getClient().send(new DeleteObjectCommand({
    Bucket: config.garage.bucket,
    Key: key,
  }));
}

module.exports = { isEnabled, putObject, getObject, headObject, deleteObject };
