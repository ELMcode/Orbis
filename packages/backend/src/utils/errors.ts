import { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/** Normalized error response. */
export function sendError(reply: FastifyReply, statusCode: number, message: string, details?: unknown) {
  return reply.code(statusCode).send({
    error: true,
    statusCode,
    message,
    details,
  });
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof HttpError) {
    return sendError(reply, err.statusCode, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return sendError(reply, 400, formatZodMessage(err), err.flatten());
  }
  if (isPrismaKnownError(err) && err.code === 'P2002') {
    return sendError(reply, 409, 'Cette valeur existe déjà dans ce périmètre.');
  }
  console.error('[Erreur non gérée]', err);
  return sendError(reply, 500, 'Erreur interne du serveur');
}

function isPrismaKnownError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

function formatZodMessage(err: ZodError): string {
  const issue = err.issues[0];
  const field = issue?.path.join('.');
  if (!issue) return 'Certains champs sont invalides';
  if (issue.message && issue.message !== 'Required' && issue.message !== 'Invalid input') {
    return issue.message;
  }
  if (field) {
    return `Le champ "${humanizeField(field)}" est invalide`;
  }
  return 'Certains champs sont invalides';
}

function humanizeField(field: string): string {
  const labels: Record<string, string> = {
    name: 'nom',
    email: 'email',
    password: 'mot de passe',
    description: 'description',
    location: 'emplacement',
    parentId: 'site parent',
    siteId: 'site',
    type: 'type',
    status: 'statut',
    totalUnits: 'nombre d’U',
    startUnit: 'position de départ',
    units: 'hauteur',
  };
  return labels[field] ?? field;
}
