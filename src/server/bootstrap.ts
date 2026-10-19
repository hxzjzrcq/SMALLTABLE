import { CredentialStore } from './credentials.js';
import { createSmalltable } from './app.js';
import type { Config } from './config.js';
export async function openSmalltable(
  cfg: Config,
  initial: { roomPassword?: string; dmPassword?: string },
) {
  const credentials = await CredentialStore.open(cfg.dataDir, initial);
  try {
    const service = await createSmalltable(cfg, credentials);
    let closing: Promise<void> | undefined;
    return {
      ...service,
      close: () =>
        (closing ??= (async () => {
          try {
            await service.close();
          } finally {
            await credentials.close();
          }
        })()),
    };
  } catch (error) {
    await credentials.close();
    throw error;
  }
}
