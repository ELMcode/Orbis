import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ApplicationDependencyStatus,
  ApplicationDependencyType,
  AssetContractStatus,
  AssetContractType,
  Criticality,
  CustomFieldTarget,
  CustomFieldType,
  SavedViewTarget,
} from '@prisma/client';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';
import { assertCanAccessDevice, getVisibleSiteIds } from '../services/scope.js';

const jsonObject = z.record(z.any());
const stringList = z.array(z.string().trim().min(1).max(60)).max(40).optional();

const dependencyFields = {
  name: z.string().min(1).max(160),
  dependencyType: z.nativeEnum(ApplicationDependencyType).optional(),
  status: z.nativeEnum(ApplicationDependencyStatus).optional(),
  criticality: z.nativeEnum(Criticality).optional(),
  sourceDeviceId: z.string().optional().nullable(),
  targetDeviceId: z.string().optional().nullable(),
  sourceName: z.string().max(160).optional().nullable(),
  targetName: z.string().max(160).optional().nullable(),
  protocol: z.string().max(40).optional().nullable(),
  port: z.number().int().min(1).max(65535).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  owner: z.string().max(160).optional().nullable(),
  tags: stringList,
  customFields: jsonObject.optional().nullable(),
};

const contractFields = {
  deviceId: z.string().optional().nullable(),
  name: z.string().min(1).max(160),
  type: z.nativeEnum(AssetContractType).optional(),
  status: z.nativeEnum(AssetContractStatus).optional(),
  vendor: z.string().max(160).optional().nullable(),
  contractNumber: z.string().max(120).optional().nullable(),
  seatsTotal: z.number().int().nonnegative().optional().nullable(),
  seatsUsed: z.number().int().nonnegative().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  renewalDate: z.coerce.date().optional().nullable(),
  owner: z.string().max(160).optional().nullable(),
  cost: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  tags: stringList,
  customFields: jsonObject.optional().nullable(),
};

const customFieldFields = {
  target: z.nativeEnum(CustomFieldTarget),
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,48}$/i, 'Clé attendue : lettres, chiffres et underscores uniquement'),
  label: z.string().min(1).max(120),
  type: z.nativeEnum(CustomFieldType).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(80).optional(),
  defaultValue: z.any().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
};

const tagFields = {
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  description: z.string().max(500).optional().nullable(),
};

const savedViewFields = {
  name: z.string().min(1).max(120),
  target: z.nativeEnum(SavedViewTarget).optional(),
  filters: jsonObject.optional(),
  columns: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  shared: z.boolean().optional(),
};

const createDependencySchema = z.object(dependencyFields);
const updateDependencySchema = z.object(dependencyFields).partial();
const createContractSchema = z.object(contractFields);
const updateContractSchema = z.object(contractFields).partial();
const createCustomFieldSchema = z.object(customFieldFields);
const updateCustomFieldSchema = z.object(customFieldFields).partial();
const createTagSchema = z.object(tagFields);
const updateTagSchema = z.object(tagFields).partial();
const createSavedViewSchema = z.object(savedViewFields);
const updateSavedViewSchema = z.object(savedViewFields).partial();

export default async function sourceOfTruthRoutes(app: FastifyInstance) {
  app.get('/dependencies', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as Record<string, string | undefined>;
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const where: any = { organizationId };
      if (q.type) where.dependencyType = q.type;
      if (q.criticality) where.criticality = q.criticality;
      if (q.search) {
        where.OR = [
          { name: { contains: q.search, mode: 'insensitive' } },
          { sourceName: { contains: q.search, mode: 'insensitive' } },
          { targetName: { contains: q.search, mode: 'insensitive' } },
          { owner: { contains: q.search, mode: 'insensitive' } },
        ];
      }
      applyDependencyVisibility(where, visibleIds);

      const [dependencies, total] = await Promise.all([
        prisma.applicationDependency.findMany({
          where,
          orderBy: [{ criticality: 'desc' }, { name: 'asc' }],
          skip: pagination.skip,
          take: pagination.take,
          include: deviceIncludes,
        }),
        prisma.applicationDependency.count({ where }),
      ]);
      return reply.send({ dependencies, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/dependencies', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = createDependencySchema.parse(req.body);
      await assertDeviceRefs(body, organizationId, req);
      const dependency = await prisma.applicationDependency.create({
        data: { ...body, organizationId } as any,
        include: deviceIncludes,
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.dependency.create', target: 'ApplicationDependency', targetId: dependency.id, ip: req.ip });
      return reply.code(201).send({ dependency });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/dependencies/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = updateDependencySchema.parse(req.body);
      await assertDependency(id, organizationId, req);
      await assertDeviceRefs(body, organizationId, req);
      const dependency = await prisma.applicationDependency.update({
        where: { id },
        data: body as any,
        include: deviceIncludes,
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.dependency.update', target: 'ApplicationDependency', targetId: id, ip: req.ip });
      return reply.send({ dependency });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/dependencies/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      await assertDependency(id, organizationId, req);
      await prisma.applicationDependency.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.dependency.delete', target: 'ApplicationDependency', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/contracts', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as Record<string, string | undefined>;
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const where: any = { organizationId };
      if (q.type) where.type = q.type;
      if (q.status) where.status = q.status;
      if (q.search) {
        where.OR = [
          { name: { contains: q.search, mode: 'insensitive' } },
          { vendor: { contains: q.search, mode: 'insensitive' } },
          { contractNumber: { contains: q.search, mode: 'insensitive' } },
          { owner: { contains: q.search, mode: 'insensitive' } },
        ];
      }
      applyContractVisibility(where, visibleIds);

      const [contracts, total] = await Promise.all([
        prisma.assetContract.findMany({
          where,
          orderBy: [{ endDate: 'asc' }, { name: 'asc' }],
          skip: pagination.skip,
          take: pagination.take,
          include: { device: { select: { id: true, name: true, siteId: true, site: { select: { id: true, name: true } } } } },
        }),
        prisma.assetContract.count({ where }),
      ]);
      return reply.send({ contracts, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/contracts', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = createContractSchema.parse(req.body);
      if (body.deviceId) await assertDeviceRefs({ sourceDeviceId: body.deviceId }, organizationId, req);
      if (body.seatsTotal != null && body.seatsUsed != null && body.seatsUsed > body.seatsTotal) {
        throw new HttpError(400, 'Le nombre de licences utilisées ne peut pas dépasser le total');
      }
      const contract = await prisma.assetContract.create({
        data: { ...body, organizationId } as any,
        include: { device: { select: { id: true, name: true, siteId: true, site: { select: { id: true, name: true } } } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.contract.create', target: 'AssetContract', targetId: contract.id, ip: req.ip });
      return reply.code(201).send({ contract });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/contracts/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = updateContractSchema.parse(req.body);
      await assertContract(id, organizationId, req);
      if (body.deviceId) await assertDeviceRefs({ sourceDeviceId: body.deviceId }, organizationId, req);
      if (body.seatsTotal != null && body.seatsUsed != null && body.seatsUsed > body.seatsTotal) {
        throw new HttpError(400, 'Le nombre de licences utilisées ne peut pas dépasser le total');
      }
      const contract = await prisma.assetContract.update({
        where: { id },
        data: body as any,
        include: { device: { select: { id: true, name: true, siteId: true, site: { select: { id: true, name: true } } } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.contract.update', target: 'AssetContract', targetId: id, ip: req.ip });
      return reply.send({ contract });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/contracts/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      await assertContract(id, organizationId, req);
      await prisma.assetContract.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.contract.delete', target: 'AssetContract', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/custom-fields', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as { target?: CustomFieldTarget };
      const fields = await prisma.customFieldDefinition.findMany({
        where: { organizationId, ...(q.target ? { target: q.target } : {}) },
        orderBy: [{ target: 'asc' }, { label: 'asc' }],
      });
      return reply.send({ fields });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/custom-fields', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = createCustomFieldSchema.parse(req.body);
      const field = await prisma.customFieldDefinition.create({ data: { ...body, organizationId } as any });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.customField.create', target: 'CustomFieldDefinition', targetId: field.id, ip: req.ip });
      return reply.code(201).send({ field });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/custom-fields/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = updateCustomFieldSchema.parse(req.body);
      await assertCustomField(id, organizationId);
      const field = await prisma.customFieldDefinition.update({ where: { id }, data: body as any });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.customField.update', target: 'CustomFieldDefinition', targetId: id, ip: req.ip });
      return reply.send({ field });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/custom-fields/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      await assertCustomField(id, organizationId);
      await prisma.customFieldDefinition.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.customField.delete', target: 'CustomFieldDefinition', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/tags', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const tags = await prisma.tagDefinition.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
      return reply.send({ tags });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/tags', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = createTagSchema.parse(req.body);
      const tag = await prisma.tagDefinition.create({ data: { ...body, organizationId } });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.tag.create', target: 'TagDefinition', targetId: tag.id, ip: req.ip });
      return reply.code(201).send({ tag });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/tags/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = updateTagSchema.parse(req.body);
      await assertTag(id, organizationId);
      const tag = await prisma.tagDefinition.update({ where: { id }, data: body });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.tag.update', target: 'TagDefinition', targetId: id, ip: req.ip });
      return reply.send({ tag });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/tags/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      await assertTag(id, organizationId);
      await prisma.tagDefinition.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.tag.delete', target: 'TagDefinition', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/saved-views', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as { target?: SavedViewTarget };
      const views = await prisma.savedView.findMany({
        where: {
          organizationId,
          ...(q.target ? { target: q.target } : {}),
          OR: [{ shared: true }, { createdById: req.user!.sub }],
        },
        orderBy: [{ target: 'asc' }, { name: 'asc' }],
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      return reply.send({ views });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/saved-views', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = createSavedViewSchema.parse(req.body);
      const view = await prisma.savedView.create({
        data: { ...body, organizationId, createdById: req.user!.sub } as any,
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.savedView.create', target: 'SavedView', targetId: view.id, ip: req.ip });
      return reply.code(201).send({ view });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/saved-views/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = updateSavedViewSchema.parse(req.body);
      await assertSavedView(id, organizationId, req.user!.sub, req.membership!.role === 'ADMIN');
      const view = await prisma.savedView.update({
        where: { id },
        data: body as any,
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.savedView.update', target: 'SavedView', targetId: id, ip: req.ip });
      return reply.send({ view });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/saved-views/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      await assertSavedView(id, organizationId, req.user!.sub, req.membership!.role === 'ADMIN');
      await prisma.savedView.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'source.savedView.delete', target: 'SavedView', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

const deviceIncludes = {
  sourceDevice: { select: { id: true, name: true, siteId: true, site: { select: { id: true, name: true } } } },
  targetDevice: { select: { id: true, name: true, siteId: true, site: { select: { id: true, name: true } } } },
};

function applyDependencyVisibility(where: any, visibleSiteIds: string[] | null) {
  if (visibleSiteIds === null) return;
  if (visibleSiteIds.length === 0) {
    where.id = '__none__';
    return;
  }
  where.AND = [
    ...(where.AND ?? []),
    {
      OR: [
        { sourceDevice: { siteId: { in: visibleSiteIds } } },
        { targetDevice: { siteId: { in: visibleSiteIds } } },
      ],
    },
  ];
}

function applyContractVisibility(where: any, visibleSiteIds: string[] | null) {
  if (visibleSiteIds === null) return;
  if (visibleSiteIds.length === 0) {
    where.id = '__none__';
    return;
  }
  where.device = { siteId: { in: visibleSiteIds } };
}

async function assertDeviceRefs(
  body: { sourceDeviceId?: string | null; targetDeviceId?: string | null },
  organizationId: string,
  req: any,
) {
  const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
  if (body.sourceDeviceId) await assertCanAccessDevice(body.sourceDeviceId, organizationId, visibleIds);
  if (body.targetDeviceId) await assertCanAccessDevice(body.targetDeviceId, organizationId, visibleIds);
}

async function assertDependency(id: string, organizationId: string, req: any) {
  const dependency = await prisma.applicationDependency.findFirst({ where: { id, organizationId } });
  if (!dependency) throw new HttpError(404, 'Dépendance introuvable');
  await assertDeviceRefs(dependency, organizationId, req);
}

async function assertContract(id: string, organizationId: string, req: any) {
  const contract = await prisma.assetContract.findFirst({ where: { id, organizationId } });
  if (!contract) throw new HttpError(404, 'Contrat introuvable');
  if (contract.deviceId) await assertDeviceRefs({ sourceDeviceId: contract.deviceId }, organizationId, req);
}

async function assertCustomField(id: string, organizationId: string) {
  const field = await prisma.customFieldDefinition.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!field) throw new HttpError(404, 'Champ personnalisé introuvable');
}

async function assertTag(id: string, organizationId: string) {
  const tag = await prisma.tagDefinition.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!tag) throw new HttpError(404, 'Tag introuvable');
}

async function assertSavedView(id: string, organizationId: string, userId: string, isAdmin: boolean) {
  const view = await prisma.savedView.findFirst({ where: { id, organizationId }, select: { id: true, createdById: true, shared: true } });
  if (!view) throw new HttpError(404, 'Vue sauvegardée introuvable');
  if (!isAdmin && !view.shared && view.createdById !== userId) {
    throw new HttpError(403, 'Accès non autorisé à cette vue');
  }
}
