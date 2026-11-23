console.log('[coop] Starting Node', process.version);

try {
  const {SITE_ORIGIN, COOP_REGION, PORT = '10000'} = process.env;
  if (!SITE_ORIGIN || !COOP_REGION) {
    throw Error('Environment must include SITE_ORIGIN and COOP_REGION');
  }
  const port = Number(PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Error('PORT must be an integer between 1 and 65535');
  }
  const origin = new URL(SITE_ORIGIN).origin;
  console.log('[coop] Loading relay for region', COOP_REGION);
  const {createRelay} = await import('./relay.mjs');
  const server = createRelay({origin, region: COOP_REGION});
  server.on('error', error => {
    console.error('[coop] Server failed:', error);
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log('[coop] Listening on 0.0.0.0:' + port + ' | health endpoint: /health');
  });
} catch (error) {
  console.error('[coop] Startup failed:', error);
  process.exit(1);
}
