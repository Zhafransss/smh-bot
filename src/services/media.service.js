const fs = require('fs/promises');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Temporary storage for images customers send over WhatsApp. The unit photo is uploaded to the
 * website (POST /api/home-service `gambar`) when a registration completes; files are only a
 * short-lived buffer and are deleted after upload or by the periodic cleanup.
 */

const MEDIA_TTL_MS = 24 * 60 * 60 * 1000; // longer than the 2h registration draft TTL
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

let cleanupTimer = null;

function getMediaDir() {
  return path.resolve(process.env.WA_MEDIA_PATH || './storage/wa_media');
}

/**
 * Save an image buffer and return its absolute path.
 * @param {Buffer} buffer
 * @param {{ phoneNumber: string, messageId: string, mimetype?: string }} meta
 */
async function saveImage(buffer, { phoneNumber, messageId, mimetype }) {
  const ext = MIME_EXTENSIONS[(mimetype || '').split(';')[0].trim()] || 'jpg';
  const dir = getMediaDir();
  await fs.mkdir(dir, { recursive: true });
  const safeId = String(messageId).replace(/[^A-Za-z0-9_-]/g, '');
  const filePath = path.join(dir, `${phoneNumber}_${safeId}.${ext}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function deleteFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn({ err, filePath }, 'Failed to delete media file');
  }
}

/**
 * Delete media files older than MEDIA_TTL_MS (photos never used for a registration).
 */
async function cleanupOldMedia() {
  const dir = getMediaDir();
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return; // directory not created yet
  }

  const cutoff = Date.now() - MEDIA_TTL_MS;
  let removed = 0;
  for (const name of entries) {
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        removed++;
      }
    } catch {
      // file vanished meanwhile — ignore
    }
  }
  if (removed > 0) logger.info({ removed }, 'Old WhatsApp media files cleaned up');
}

function startMediaCleanup() {
  if (cleanupTimer) return;
  cleanupOldMedia();
  cleanupTimer = setInterval(cleanupOldMedia, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

module.exports = {
  saveImage,
  fileExists,
  deleteFile,
  cleanupOldMedia,
  startMediaCleanup,
};
