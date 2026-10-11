// A stand-in for the Workers runtime module, for the tests (see vitest.config.mjs).
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
