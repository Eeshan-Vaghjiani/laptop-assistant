// Explicit local setup, never called by the app or release builder.
import { createPreferences } from '../preferences.mjs';
import { access } from 'node:fs/promises';
import path from 'node:path';
if (process.platform !== 'win32') throw new Error('Use Settings inside the app on this platform.');
const dataDir = path.join(process.env.APPDATA, 'Laptop Assistant', 'chats');
await access(dataDir);
const preferences = await createPreferences(dataDir);
await preferences.update({ model: 'gpt-6-astra', effort: 'max', access: 'full' });
console.log('Personal preferences: GPT-6 Astra / Max; Full control for routine actions.');
