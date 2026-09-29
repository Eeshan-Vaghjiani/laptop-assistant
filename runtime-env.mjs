export function runtimeEnv(environment = process.env) {
  const env = { ...environment, COPILOT_AUTO_UPDATE: 'false' };
  for (const key of Object.keys(env)) if (/^(OTEL_|COPILOT_OTEL_)/.test(key)) delete env[key];
  env.COPILOT_OTEL_ENABLED = 'false';
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.COPILOT_ALLOW_ALL;
  if (env.COPILOT_CLI_PATH?.endsWith('.js')) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}
