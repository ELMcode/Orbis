import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import { prisma } from '../db/client.js';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { config } from '../config.js';
import {
  deleteFile,
  resolveUploadPath,
  saveFile,
  shouldForceDownload,
} from '../services/upload.js';
import { assertCanAccessDevice, assertInOrg, getVisibleSiteIds } from '../services/scope.js';

// ─── Gallery images (DeviceImage) ──────────────────────────
export default async function mediaRoutes(app: FastifyInstance) {
  // Upload an image for a device (multipart).
  app.post(
    '/devices/:id/images',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        // IDOR guard: verify device access before saving the file.
        await assertCanAccessDevice(id, organizationId, visibleIds);

        const data = await req.file();
        if (!data) throw new HttpError(400, 'Fichier requis');

        const buffer = await data.toBuffer();
        if (buffer.length > config.upload.maxBytes)
          throw new HttpError(413, 'Fichier trop volumineux');

        // saveFile validates the MIME type and magic bytes internally.
        const saved = await saveFile(buffer, data.mimetype, 'images');
        const count = await prisma.deviceImage.count({ where: { deviceId: id } });
        const image = await prisma.deviceImage.create({
          data: {
            deviceId: id,
            path: saved.path,
            mimeType: saved.mimeType,
            caption: null,
            sortOrder: count,
          },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'image.create',
          target: 'Device',
          targetId: id,
          ip: req.ip,
          meta: { path: saved.path },
        });
        return reply.code(201).send({ image });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // Caption and display order.
  app.patch(
    '/images/:imageId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { imageId } = req.params as { imageId: string };
        const body = z
          .object({ caption: z.string().max(280).optional(), sortOrder: z.number().optional() })
          .parse(req.body);
        await assertInOrg('deviceImage', imageId, organizationId);

        const image = await prisma.deviceImage.update({ where: { id: imageId }, data: body });
        return reply.send({ image });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.delete(
    '/images/:imageId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { imageId } = req.params as { imageId: string };
        await assertInOrg('deviceImage', imageId, organizationId);

        const image = await prisma.deviceImage.findUnique({ where: { id: imageId } });
        if (image) await deleteFile(image.path);
        await prisma.deviceImage.delete({ where: { id: imageId } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'image.delete',
          target: 'DeviceImage',
          targetId: imageId,
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Attachments ─────────────────────────────────────────
  app.post(
    '/devices/:id/attachments',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        await assertCanAccessDevice(id, organizationId, visibleIds);

        const data = await req.file();
        if (!data) throw new HttpError(400, 'Fichier requis');

        const buffer = await data.toBuffer();
        if (buffer.length > config.upload.maxBytes)
          throw new HttpError(413, 'Fichier trop volumineux');

        const saved = await saveFile(buffer, data.mimetype, 'attachments');
        const filename = data.filename ?? 'document';
        const attachment = await prisma.attachment.create({
          data: {
            deviceId: id,
            filename,
            path: saved.path,
            mimeType: saved.mimeType,
            size: saved.size,
          },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'attachment.create',
          target: 'Device',
          targetId: id,
          ip: req.ip,
          meta: { filename },
        });
        return reply.code(201).send({ attachment });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.delete(
    '/attachments/:attachmentId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { attachmentId } = req.params as { attachmentId: string };
        await assertInOrg('attachment', attachmentId, organizationId);

        const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
        if (att) await deleteFile(att.path);
        await prisma.attachment.delete({ where: { id: attachmentId } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'attachment.delete',
          target: 'Attachment',
          targetId: attachmentId,
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Serve an uploaded file (AUTHENTICATED) ──────────────
  // Uploads are no longer public: the requester must belong to the organization
  // that owns the file's device. Do not reveal files outside that organization.
  app.get(
    '/media/file/:kind/:name',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { kind, name } = req.params as { kind: string; name: string };
        // Validate the format and prevent path traversal through the filename.
        if (!['images', 'attachments'].includes(kind) || !/^[a-z0-9-]+\.[a-z0-9]+$/i.test(name)) {
          throw new HttpError(404, 'Fichier introuvable');
        }
        const relPath = `${kind}/${name}`;
        const abs = resolveUploadPath(relPath);
        if (!abs) throw new HttpError(404, 'Fichier introuvable');

        // Verify that the file exists.
        try {
          await fs.access(abs);
        } catch {
          throw new HttpError(404, 'Fichier introuvable');
        }

        // Verify access: the file must belong to a device in the active organization.
        const { organizationId } = req.membership!;
        const owned =
          kind === 'images'
            ? await prisma.deviceImage.findFirst({
                where: { path: relPath, device: { organizationId } },
                select: { mimeType: true },
              })
            : await prisma.attachment.findFirst({
                where: { path: relPath, device: { organizationId } },
                select: { mimeType: true },
              });

        if (!owned) throw new HttpError(404, 'Fichier introuvable');

        // Security headers.
        const mimeType = owned.mimeType;
        const isAttachment = shouldForceDownload(mimeType) || kind === 'attachments';
        const headers: Record<string, string> = {
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        };
        if (isAttachment) {
          headers['Content-Disposition'] = `attachment; filename="${name}"`;
          // CSP sandbox for SVG files (stored XSS protection).
          if (mimeType === 'image/svg+xml') {
            headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
          }
        }
        return reply
          .type(mimeType)
          .headers(headers)
          .send(await fs.readFile(abs));
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}
