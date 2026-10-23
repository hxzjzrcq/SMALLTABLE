// Deployment defaults live here; effective limits are supplied by the server.
export const DEFAULT_CAPABILITIES = {
  maxSeats: 15,
  maxDMs: 1,
  maxMaps: 10,
  maxMusic: 10,
  resourceBytes: 64 * 1024 * 1024,
  musicBytes: 4 * 1024 * 1024,
  maxTokens: 255,
  maxNotesBytes: 65535,
  maxInitiative: 255,
  maxDrawings: 255,
  maxRolls: 255,
  maxNames: 255,
  mapBytes: 10 * 1024 * 1024,
  mapPixels: 16_000_000,
  mapEdge: 8192,
  tokenBytes: 256 * 1024,
  tokenEdge: 256,
  idleMs: 30 * 60000,
};
export type Capabilities = typeof DEFAULT_CAPABILITIES;
