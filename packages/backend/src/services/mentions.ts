import { prisma } from '../db/client.js';

const mentionPattern = /(^|\s)@([\p{L}\p{N}._-]{2,80})/gu;

export async function notifyMentions(input: {
  organizationId: string;
  authorId: string;
  body: string;
  target: string;
  targetId: string;
}) {
  const identifiers = [...input.body.matchAll(mentionPattern)].map((match) => match[2].toLocaleLowerCase());
  if (identifiers.length === 0) return;
  const memberships = await prisma.membership.findMany({
    where: { organizationId: input.organizationId, status: 'ACTIVE', user: { active: true } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  const users = memberships.map((membership) => membership.user).filter((user) => user.id !== input.authorId);
  const mentioned = users.filter((user) => {
    const name = user.name.toLocaleLowerCase().replace(/\s+/g, '.');
    const emailLocal = user.email.split('@')[0].toLocaleLowerCase();
    return identifiers.includes(name) || identifiers.includes(emailLocal);
  });
  if (!mentioned.length) return;
  await prisma.userNotification.createMany({ data: mentioned.map((user) => ({
    organizationId: input.organizationId, userId: user.id, type: 'MENTION',
    title: 'Vous avez été mentionné', body: input.body.slice(0, 500), target: input.target, targetId: input.targetId,
  })) });
}
