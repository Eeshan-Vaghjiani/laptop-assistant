import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const defaultPreferences = { model: 'gpt-6-astra', effort: 'max', access: 'ask', lastChat: null };
export function validatePreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings.');
  const result = {};
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (key === 'model' && typeof value === 'string' && value.length <= 100 && /^[\w.-]+$/.test(value)) result.model = value;
    else if (key === 'effort' && ['auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)) result.effort = value;
    else if (key === 'access' && ['ask', 'full'].includes(value)) result.access = value;
    else if (key === 'lastChat' && (value === null || (typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)))) result.lastChat = value;
    else throw new Error(`Invalid setting: ${key}`);
  }
  return result;
}
export async function createPreferences(dataDir) {
  const target = path.join(dataDir, 'preferences.json');
  let current = { ...defaultPreferences }, writing = Promise.resolve();
  try { current = { ...current, ...validatePreferences(JSON.parse(await readFile(target, 'utf8'))) }; }
  catch (error) { if (error.code !== 'ENOENT') console.error('Could not load preferences; using defaults.'); }
  return {
    get: () => ({ ...current }),
    update(input) {
      const patch = validatePreferences(input);
      const next = writing.catch(() => {}).then(async () => {
        const value = { ...current, ...patch };
        await writeFile(`${target}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
        await rename(`${target}.tmp`, target);
        current = value;
        return { ...current };
      });
      writing = next;
      return next;
    },
    flush: () => writing,
  };
}

export function modelOptions(models) {
  return models.filter(m => m.policy?.state !== 'disabled').map(m => ({
    id: m.id, name: m.name,
    efforts: m.supportedReasoningEfforts || [], defaultEffort: m.defaultReasoningEffort,
    vision: !!m.capabilities?.supports?.vision,
  }));
}
export function selectEffort(model, requested) {
  if (!model?.efforts.length || requested === 'auto') return undefined;
  if (model.efforts.includes(requested)) return requested;
  return model.defaultEffort || model.efforts.at(-1);
}
