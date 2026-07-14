import { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import ipaddr from 'ipaddr.js';
import { prisma } from '../db/client.js';
import { DeviceType, DeviceStatus, DeviceLifecycleStatus } from '@prisma/client';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';
import {
  assertCanAccessDevice,
  assertCanAccessSite,
  assertInOrg,
  getDescendantSiteIds,
  getVisibleSiteIds,
  scopedSiteFilter,
  siteFilter,
} from '../services/scope.js';
import { assertTenantQuota } from '../services/tenantLimits.js';
import { dispatchOutboundWebhook } from '../services/outboundWebhooks.js';

const deviceFields = {
  name: z.string().min(1).max(120),
  type: z.nativeEnum(DeviceType).optional(),
  status: z.nativeEnum(DeviceStatus).optional(),
  siteId: z.string().optional().nullable(),
  diagramId: z.string().optional().nullable(),
  diagramNodeId: z.string().optional().nullable(),
  brand: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  serial: z.string().max(120).optional().nullable(),
  assetTag: z.string().max(120).optional().nullable(),
  ip: z
    .string()
    .max(120)
    .refine((value) => ipaddr.isValid(value), 'Adresse IP invalide')
    .optional()
    .nullable(),
  mac: z.string().max(120).optional().nullable(),
  vlan: z.string().max(120).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  purchaseDate: z.coerce.date().optional().nullable(),
  warrantyEnd: z.coerce.date().optional().nullable(),
  supportEnd: z.coerce.date().optional().nullable(),
  replacementDue: z.coerce.date().optional().nullable(),
  lifecycleStatus: z.nativeEnum(DeviceLifecycleStatus).optional(),
  owner: z.string().max(120).optional().nullable(),
  cost: z.number().nonnegative().optional().nullable(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional().nullable(),
};

const createSchema = z.object(deviceFields);
const updateSchema = z.object(deviceFields).partial();
const MAX_IMPORT_ROWS = 500;

export default async function devicesRoutes(app: FastifyInstance) {
  // ─── List with filters and search (scoped) ───────────────
  app.get(
    '/',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const q = req.query as Record<string, string | undefined>;
        const pagination = parsePagination(req.query);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );
        const where: any = {
          organizationId,
          ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)),
        };
        if (q.type) where.type = q.type;
        if (q.status) where.status = q.status;
        if (q.search) {
          where.OR = [
            { name: { contains: q.search, mode: 'insensitive' } },
            { brand: { contains: q.search, mode: 'insensitive' } },
            { model: { contains: q.search, mode: 'insensitive' } },
            { ip: { contains: q.search, mode: 'insensitive' } },
            { mac: { contains: q.search, mode: 'insensitive' } },
            { serial: { contains: q.search, mode: 'insensitive' } },
            { location: { contains: q.search, mode: 'insensitive' } },
          ];
        }
        const [devices, total] = await Promise.all([
          prisma.device.findMany({
            where,
            orderBy: { name: 'asc' },
            skip: pagination.skip,
            take: pagination.take,
            include: {
              site: { select: { id: true, name: true } },
              _count: { select: { ports: true, images: true, attachments: true } },
            },
          }),
          prisma.device.count({ where }),
        ]);
        return reply.send({ devices, pagination: paginationMeta(pagination, total) });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.get(
    '/:id',
    {
      preHandler: [app.authenticate, app.requireOrg],
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

        // The IDOR guard verifies the organization and the device site visibility.
        await assertCanAccessDevice(id, organizationId, visibleIds);

        const device = await prisma.device.findFirst({
          where: { id, organizationId },
          include: {
            site: true,
            ports: { orderBy: { label: 'asc' } },
            images: { orderBy: { sortOrder: 'asc' } },
            attachments: { orderBy: { createdAt: 'desc' } },
            rackSlot: { include: { rack: true } },
          },
        });
        if (!device) throw new HttpError(404, 'Équipement introuvable');

        return reply.send({ device });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post(
    '/',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const body = createSchema.parse(req.body);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        if (body.siteId) {
          await assertCanAccessSite(body.siteId, organizationId, visibleIds);
        }
        await assertTenantQuota(organizationId, 'devices');

        const device = await prisma.device.create({
          data: { ...body, organizationId, editedById: req.user!.sub } as any,
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'device.create',
          target: 'Device',
          targetId: device.id,
          ip: req.ip,
        });
        await dispatchOutboundWebhook(organizationId, 'device.created', { device });
        return reply.code(201).send({ device });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post(
    '/import',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );
        const data = await req.file();
        if (!data) throw new HttpError(400, 'Fichier requis');

        const filename = data.filename.toLowerCase();
        if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx')) {
          throw new HttpError(415, 'Format attendu : CSV ou XLSX');
        }

        const buffer = await data.toBuffer();
        const rows = await parseImportWorkbook(buffer, filename);
        const sites = await prisma.site.findMany({
          where: { organizationId },
          select: { id: true, name: true },
        });
        const siteById = new Map(sites.map((site) => [site.id, site]));
        const siteByName = new Map(sites.map((site) => [site.name.trim().toLowerCase(), site]));
        const errors: Array<{ row: number; message: string }> = [];
        const created: string[] = [];
        await assertTenantQuota(organizationId, 'devices', rows.length);

        for (const [index, row] of rows.entries()) {
          try {
            const mapped = mapImportRow(row, index + 2, siteById, siteByName);
            if (mapped.siteId) {
              await assertCanAccessSite(mapped.siteId, organizationId, visibleIds);
            } else if (visibleIds !== null) {
              throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
            }

            const device = await prisma.device.create({
              data: { ...mapped, organizationId, editedById: req.user!.sub } as any,
              select: { id: true },
            });
            created.push(device.id);
          } catch (err: any) {
            errors.push({ row: index + 2, message: err?.message ?? 'Ligne invalide' });
          }
        }

        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'device.import',
          target: 'Device',
          ip: req.ip,
          meta: { filename: data.filename, created: created.length, errors: errors.length },
        });

        return reply.code(201).send({
          created: created.length,
          skipped: errors.length,
          errors,
        });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.put(
    '/:id',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const body = updateSchema.parse(req.body);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        await assertInOrg('device', id, organizationId);
        await assertCanAccessDevice(id, organizationId, visibleIds);

        // When moving the device to a new site, verify access to that site.
        if (body.siteId) {
          await assertCanAccessSite(body.siteId, organizationId, visibleIds);
        }

        const device = await prisma.device.update({
          where: { id },
          data: { ...body, editedById: req.user!.sub } as any,
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'device.update',
          target: 'Device',
          targetId: id,
          ip: req.ip,
        });
        await dispatchOutboundWebhook(organizationId, 'device.updated', { device });
        return reply.send({ device });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.delete(
    '/:id',
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
        await assertInOrg('device', id, organizationId);
        await assertCanAccessDevice(id, organizationId, visibleIds);

        const device = await prisma.device.delete({ where: { id } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'device.delete',
          target: 'Device',
          targetId: id,
          ip: req.ip,
        });
        await dispatchOutboundWebhook(organizationId, 'device.deleted', { device });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Dashboard stats (scoped + site filter) ──────────────
  app.get(
    '/stats/overview',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const q = req.query as { siteId?: string };
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        // Intersect the user's visible IDs with the selected site.
        // resolvedIds === null means the full visible scope without a site filter.
        // resolvedIds === [...] means the result is limited to that subset.
        let resolvedIds: string[] | null = visibleIds;
        if (q.siteId) {
          // If the user cannot access the site, force an empty result.
          if (visibleIds !== null && !visibleIds.includes(q.siteId)) {
            return reply.send({
              total: 0,
              byType: [],
              byStatus: [],
              sitesCount: 0,
              diagramsCount: 0,
              warnings: [],
            });
          }
          // Restrict to the site and descendants, resolved within the organization.
          resolvedIds = await getDescendantSiteIds(q.siteId, organizationId);
        }

        const deviceWhere = { organizationId, ...siteFilter(resolvedIds) };
        const siteWhere = {
          organizationId,
          ...(resolvedIds === null ? {} : { id: { in: resolvedIds } }),
        };
        const diagramWhere = {
          organizationId,
          ...(resolvedIds === null ? {} : { siteId: { in: resolvedIds } }),
        };

        const [total, byType, byStatus, sitesCount, diagramsCount, warnings] = await Promise.all([
          prisma.device.count({ where: deviceWhere }),
          prisma.device.groupBy({ by: ['type'], _count: true, where: deviceWhere }),
          prisma.device.groupBy({ by: ['status'], _count: true, where: deviceWhere }),
          prisma.site.count({ where: siteWhere }),
          prisma.diagram.count({ where: diagramWhere }),
          prisma.device.findMany({
            where: { ...deviceWhere, status: { in: ['WARNING', 'OFFLINE', 'MAINTENANCE'] } },
            select: { id: true, name: true, type: true, status: true, siteId: true },
            orderBy: { status: 'asc' },
          }),
        ]);
        return reply.send({ total, byType, byStatus, sitesCount, diagramsCount, warnings });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}

async function parseImportWorkbook(
  buffer: Buffer,
  filename: string,
): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  if (!filename.endsWith('.xlsx')) return parseCsvImport(buffer.toString('utf8'));
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, 'Le fichier ne contient aucune feuille exploitable');

  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((value) => asString(value));
  if (headers.length === 0 || headers.every((header) => !header)) {
    throw new HttpError(400, 'La première ligne doit contenir les en-têtes de colonnes');
  }

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || rows.length >= MAX_IMPORT_ROWS) return;
    const values = (row.values as unknown[]).slice(1);
    if (values.every((value) => asString(value) === '')) return;
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  });
  return rows;
}

function parseCsvImport(content: string): Record<string, unknown>[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const split = (line: string) => {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) {
        values.push(value.trim());
        value = '';
      } else value += char;
    }
    values.push(value.trim());
    return values;
  };
  const headers = split(lines[0]);
  if (headers.every((header) => !header))
    throw new HttpError(400, 'La première ligne doit contenir les en-têtes de colonnes');
  return lines.slice(1, MAX_IMPORT_ROWS + 1).map((line) => {
    const values = split(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function mapImportRow(
  row: Record<string, unknown>,
  rowNumber: number,
  siteById: Map<string, { id: string; name: string }>,
  siteByName: Map<string, { id: string; name: string }>,
) {
  const normalized = normalizeRow(row);
  const name = asString(normalized.name);
  if (!name) throw new HttpError(400, `Ligne ${rowNumber}: name est requis`);

  const type = normalizeEnum<DeviceType>(normalized.type, DeviceType, 'SWITCH');
  const status = normalizeEnum<DeviceStatus>(normalized.status, DeviceStatus, 'UNKNOWN');
  const siteRef = asString(normalized.siteid) || asString(normalized.site);
  const site = siteRef ? (siteById.get(siteRef) ?? siteByName.get(siteRef.toLowerCase())) : null;
  if (siteRef && !site)
    throw new HttpError(400, `Ligne ${rowNumber}: site introuvable (${siteRef})`);

  return {
    name,
    type,
    status,
    siteId: site?.id ?? null,
    brand: asNullableString(normalized.brand),
    model: asNullableString(normalized.model),
    serial: asNullableString(normalized.serial),
    ip: asNullableString(normalized.ip),
    mac: asNullableString(normalized.mac),
    vlan: asNullableString(normalized.vlan),
    location: asNullableString(normalized.location),
    owner: asNullableString(normalized.owner),
    notes: asNullableString(normalized.notes),
    cost: asNumber(normalized.cost),
    tags: asString(normalized.tags)
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.toLowerCase().replace(/[^a-z0-9]/g, '')] = value;
  }
  return out;
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNullableString(value: unknown): string | null {
  const text = asString(value);
  return text || null;
}

function asNumber(value: unknown): number | null {
  const text = asString(value);
  if (!text) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeEnum<T extends string>(
  value: unknown,
  enumObject: Record<string, string>,
  fallback: T,
): T {
  const text = asString(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!text) return fallback;
  const allowed = Object.values(enumObject);
  if (!allowed.includes(text)) throw new HttpError(400, `Valeur invalide: ${value}`);
  return text as T;
}
