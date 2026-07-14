import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { config } from '../config.js';
import { prisma } from '../db/client.js';
import { handleError, HttpError } from '../utils/errors.js';
import { planQuotas } from '../services/tenantLimits.js';

function stripeClient(): Stripe {
  if (!config.billing.stripeSecretKey || !config.billing.stripePriceId) {
    throw new HttpError(501, 'Stripe n’est pas configuré');
  }
  return new Stripe(config.billing.stripeSecretKey);
}

export default async function billingRoutes(app: FastifyInstance) {
  app.get('/status', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, plan: true, stripeCustomerId: true },
      });
      if (!organization) throw new HttpError(404, 'Organisation introuvable');
      const [members, sites, devices, diagrams, collectors, reportSchedules, ipAddresses] = await Promise.all([
        prisma.membership.count({ where: { organizationId, status: 'ACTIVE' } }),
        prisma.site.count({ where: { organizationId } }),
        prisma.device.count({ where: { organizationId } }),
        prisma.diagram.count({ where: { organizationId } }),
        prisma.discoveryCollector.count({ where: { organizationId, status: { not: 'REVOKED' } } }),
        prisma.reportSchedule.count({ where: { organizationId } }),
        prisma.ipAddress.count({ where: { organizationId } }),
      ]);
      return reply.send({
        organization,
        configured: Boolean(config.billing.stripeSecretKey && config.billing.stripePriceId),
        quotas: planQuotas(organization.plan),
        usage: { members, sites, devices, diagrams, collectors, reportSchedules, ipAddresses },
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/checkout', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const stripe = stripeClient();
      const { organizationId } = req.membership!;
      const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (!organization) throw new HttpError(404, 'Organisation introuvable');

      let customerId = organization.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: organization.name,
          metadata: { organizationId },
        });
        customerId = customer.id;
        await prisma.organization.update({
          where: { id: organizationId },
          data: { stripeCustomerId: customerId },
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: config.billing.stripePriceId!, quantity: 1 }],
        success_url: config.billing.successUrl,
        cancel_url: config.billing.cancelUrl,
        client_reference_id: organizationId,
        metadata: { organizationId },
      });

      return reply.send({ url: session.url });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/portal', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const stripe = stripeClient();
      const { organizationId } = req.membership!;
      const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (!organization?.stripeCustomerId) throw new HttpError(400, 'Aucun client Stripe associé');

      const session = await stripe.billingPortal.sessions.create({
        customer: organization.stripeCustomerId,
        return_url: config.appUrl,
      });

      return reply.send({ url: session.url });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
