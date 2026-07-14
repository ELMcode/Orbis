import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';

describe('Authentification — primitives', () => {
  it('hash et vérifie un mot de passe avec bcrypt', async () => {
    const password = 'superSecret123!';
    const hash = await bcrypt.hash(password, 10);
    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare('mauvais', hash)).toBe(false);
  });

  it('produit un hash SHA-256 déterministe pour les refresh tokens', () => {
    const token = 'mon-token-refresh-abc';
    const h1 = createHash('sha256').update(token).digest('hex');
    const h2 = createHash('sha256').update(token).digest('hex');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(createHash('sha256').update('autre').digest('hex')).not.toBe(h1);
  });

  it('valide le format email basique', () => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    expect(re.test('admin@orbis.local')).toBe(true);
    expect(re.test('bad-email')).toBe(false);
    expect(re.test('a@b')).toBe(false);
  });
});
