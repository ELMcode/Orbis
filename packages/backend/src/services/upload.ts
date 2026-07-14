import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';

// ─────────────────────────────────────────────────────────────
// Allowed MIME types and their corresponding magic-byte signatures.
// Validate the actual file content, not only the client-supplied Content-Type,
// which can be forged.
// ─────────────────────────────────────────────────────────────

interface FileKind {
  mime: string;
  ext: string;
  /** Signature binaire (magic bytes). null pour les types textuels/SVG. */
  magic: ((buf: Buffer) => boolean) | null;
  /** Whether the file must be served as an attachment (SVG XSS protection). */
  forceDownload?: boolean;
}

const KINDS: FileKind[] = [
  {
    mime: 'image/png',
    ext: 'png',
    magic: (b) =>
      b.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    magic: (b) =>
      b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    magic: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/avif',
    ext: 'avif',
    magic: (b) =>
      b.length >= 12 &&
      b.subarray(4, 12).includes(Buffer.from('ftyp')) &&
      b.subarray(8, 12).toString('ascii').startsWith('avif'),
  },
  // SVG : textuel, on validera le contenu (<svg ou <?xml), et on forcera le download
  {
    mime: 'image/svg+xml',
    ext: 'svg',
    magic: (b) => /<\?xml|<svg/i.test(b.subarray(0, 256).toString('utf8')),
    forceDownload: true,
  },
  {
    mime: 'application/pdf',
    ext: 'pdf',
    magic: (b) => b.length >= 4 && b.subarray(0, 4).toString('ascii') === '%PDF',
  },
  { mime: 'text/plain', ext: 'txt', magic: null },
  { mime: 'text/csv', ext: 'csv', magic: null },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    magic: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    magic: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  },
];

const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
]);

export async function ensureUploadDir() {
  const abs = path.resolve(process.cwd(), config.upload.dir);
  await fs.mkdir(path.join(abs, 'images'), { recursive: true });
  await fs.mkdir(path.join(abs, 'attachments'), { recursive: true });
}

/**
 * Validate a file: the declared MIME type must be allowed.
 * ET les magic bytes doivent correspondre (anti type-bypass).
 */
function detectKind(declaredMime: string, buffer: Buffer, allowImageOnly: boolean): FileKind {
  const candidates = KINDS.filter((k) => (allowImageOnly ? IMAGE_MIMES.has(k.mime) : true));
  const kind = candidates.find((k) => k.mime === declaredMime);
  if (!kind) {
    throw new HttpError(415, `Type de fichier non supporté : ${declaredMime}`);
  }
  // Verify magic bytes, except for textual types without a signature.
  if (kind.magic && !kind.magic(buffer)) {
    throw new HttpError(
      415,
      `Le contenu du fichier ne correspond pas à son type déclaré (${declaredMime})`,
    );
  }
  return kind;
}

export function validateImage(mimetype: string, buffer: Buffer): FileKind {
  return detectKind(mimetype, buffer, true);
}

export function validateAttachment(mimetype: string, buffer: Buffer): FileKind {
  return detectKind(mimetype, buffer, false);
}

export async function saveFile(
  buffer: Buffer,
  mimetype: string,
  kind: 'images' | 'attachments',
): Promise<{ path: string; mimeType: string; size: number }> {
  await ensureUploadDir();
  const fileKind =
    kind === 'images' ? validateImage(mimetype, buffer) : validateAttachment(mimetype, buffer);
  const name = `${randomUUID().slice(0, 8)}.${fileKind.ext}`;
  const abs = path.resolve(process.cwd(), config.upload.dir, kind, name);
  await fs.writeFile(abs, buffer);
  return { path: `${kind}/${name}`, mimeType: fileKind.mime, size: buffer.length };
}

export async function deleteFile(filePath: string) {
  try {
    const abs = resolveUploadPath(filePath);
    if (!abs) return; // Ignore paths outside the upload root (defense in depth).
    await fs.unlink(abs);
  } catch {
    // Be tolerant when the file has already been removed.
  }
}

/**
 * Resolve a relative upload path to an absolute path and verify that it stays
 * inside UPLOAD_DIR (path traversal protection). Return null on escape attempts.
 */
export function resolveUploadPath(relPath: string): string | null {
  const root = path.resolve(process.cwd(), config.upload.dir);
  const abs = path.resolve(root, relPath);
  // Verify that the resolved path remains under the upload root.
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null; // tentative de traversal
  }
  return abs;
}

/** Whether the MIME type must be served as a forced download (XSS protection). */
export function shouldForceDownload(mimeType: string): boolean {
  const kind = KINDS.find((k) => k.mime === mimeType);
  return kind?.forceDownload ?? mimeType === 'image/svg+xml';
}
