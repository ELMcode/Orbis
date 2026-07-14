import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { assertSafeOutboundUrl } from '../src/services/outboundUrl.js';

const mutableConfig = config as { integrations: { allowPrivateOutboundUrls: boolean } };
const originalAllowPrivate = config.integrations.allowPrivateOutboundUrls;

afterEach(() => {
  mutableConfig.integrations.allowPrivateOutboundUrls = originalAllowPrivate;
});

describe('Outbound URL safety', () => {
  it('refuses non HTTP(S) destinations and embedded credentials', async () => {
    await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toMatchObject({ statusCode: 400 });
    await expect(assertSafeOutboundUrl('https://user:secret@example.com/hooks')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('blocks loopback and private targets when private destinations are disabled', async () => {
    mutableConfig.integrations.allowPrivateOutboundUrls = false;
    await expect(assertSafeOutboundUrl('https://127.0.0.1/internal')).rejects.toMatchObject({ statusCode: 400 });
    await expect(assertSafeOutboundUrl('https://[::1]/internal')).rejects.toMatchObject({ statusCode: 400 });
    await expect(assertSafeOutboundUrl('https://10.0.0.12/internal')).rejects.toMatchObject({ statusCode: 400 });
  });
});
