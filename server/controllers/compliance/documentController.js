const path = require('path');
const fs = require('fs');
const { prisma } = require('../../db/db');
const ErrorResponse = require('../../utils/errorResponse');
const { uploadDir, newStorageKey } = require('../../config/upload');
const { recordAudit } = require('../../utils/audit');
const { encryptBuffer, decryptBuffer } = require('../../services/crypto/fieldCrypto');
const garageStorage = require('../../services/storage/garageStorage');

// Storage backend for the raw (already-encrypted) bytes. Garage when
// configured (production); local uploads/ directory otherwise (dev).
// Keyed by Document.storageKey either way, so the two are drop-in compatible.
const blobStore = garageStorage.isEnabled
  ? {
      write: (key, data) => garageStorage.putObject(key, data),
      read: (key) => garageStorage.getObject(key),
      exists: async (key) => (await garageStorage.headObject(key)).exists,
      remove: (key) => garageStorage.deleteObject(key),
    }
  : {
      write: (key, data) => fs.promises.writeFile(path.join(uploadDir, key), data),
      read: (key) => fs.promises.readFile(path.join(uploadDir, key)),
      exists: async (key) => fs.existsSync(path.join(uploadDir, key)),
      remove: (key) => fs.promises.unlink(path.join(uploadDir, key)),
    };

// POST /api/documents  (multipart: file + optional assessmentId / checklistItemResponseId / aiSystemId)
async function create(req, res) {
  if (!req.file) throw new ErrorResponse('A file is required', 422);

  // Encrypt with the org data key BEFORE the bytes reach storage. Evidence
  // uploads (DPIAs, incident reports, HR records) are the most sensitive
  // personal data in the product, so they never exist as plaintext at rest,
  // on disk or in the bucket.
  const { data, encrypted } = await encryptBuffer(req.organizationId, req.file.buffer);
  const storageKey = newStorageKey(req.file.originalname);
  await blobStore.write(storageKey, data);

  let doc;
  try {
    doc = await prisma.document.create({
      data: {
        organizationId: req.organizationId,
        assessmentId: req.body.assessmentId || null,
        checklistItemResponseId: req.body.checklistItemResponseId || null,
        aiSystemId: req.body.aiSystemId || null,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storageKey,
        encrypted,
        uploadedById: req.user.id,
      },
    });
  } catch (err) {
    // Don't leave an orphan blob in storage if the row could not be written.
    await blobStore.remove(storageKey).catch(() => {});
    throw err;
  }

  await recordAudit({ req, action: 'document.upload', entityType: 'Document', entityId: doc.id });
  res.status(201).json({ document: doc });
}

// GET /api/documents
async function list(req, res) {
  const documents = await prisma.document.findMany({
    where: { organizationId: req.organizationId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ documents });
}

async function findOwned(id, organizationId) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || doc.organizationId !== organizationId) throw new ErrorResponse('Document not found', 404);
  return doc;
}

// GET /api/documents/:id/download
async function download(req, res) {
  const doc = await findOwned(req.params.id, req.organizationId);
  if (!(await blobStore.exists(doc.storageKey))) throw new ErrorResponse('File is missing from storage', 404);

  const raw = await blobStore.read(doc.storageKey);
  // `encrypted: false` rows predate at-rest encryption and are served as-is.
  const body = doc.encrypted ? await decryptBuffer(req.organizationId, raw) : raw;

  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
  res.send(body);
}

// DELETE /api/documents/:id
async function remove(req, res) {
  const doc = await findOwned(req.params.id, req.organizationId);
  blobStore.remove(doc.storageKey).catch(() => {});
  await prisma.document.delete({ where: { id: doc.id } });
  await recordAudit({ req, action: 'document.delete', entityType: 'Document', entityId: doc.id });
  res.json({ message: 'Document deleted' });
}

module.exports = { create, list, download, remove };
