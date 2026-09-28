import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export function createSignIn(onSuccess) {
  let child, state = { running: false, output: '', error: null };
  return {
    status: () => ({ ...state }),
    start() {
      if (child) return { ...state };
      let executable;
      try { executable = require.resolve(`@github/copilot-${process.platform}-${process.arch}`); }
      catch { throw new Error('Bundled sign-in is available in the installer version. Run copilot login in a terminal, then Retry.'); }
      state = { running: true, output: 'Starting GitHub sign-in…\n', error: null };
      child = spawn(executable, ['login', '--device-code'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const append = chunk => { state.output = (state.output + chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')).slice(-16000); };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', error => { state.error = error.message; state.running = false; child = undefined; });
      child.on('close', async code => {
        child = undefined;
        if (code === 0) {
          try { await onSuccess(); }
          catch (error) { state.error = error.message; }
        } else state.error ||= 'Sign-in did not complete. Try again.';
        state.running = false;
      });
      return { ...state };
    },
    close() { child?.kill(); },
  };
}
