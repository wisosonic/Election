/** §5.6 / CLAUDE.md: "never run against prod." A single, easily-testable guard
 * rather than scattering NODE_ENV checks around the generator itself. */
export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the seed generator against a production environment (NODE_ENV=production).');
  }
}
