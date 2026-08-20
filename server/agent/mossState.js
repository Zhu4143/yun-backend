import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_STATE = { status: 'READY', currentTask: null, activeTool: null, lastToolResult: null, lastError: null, updatedAt: null };

export function createRuntimeStateStore(filePath) {
  let state = { ...DEFAULT_STATE };
  let loaded = false;
  async function ensureLoaded() {
    if (loaded) return;
    try { state = { ...DEFAULT_STATE, ...JSON.parse(await readFile(filePath, 'utf8')) }; } catch { state = { ...DEFAULT_STATE }; }
    loaded = true;
  }
  return {
    async get() { await ensureLoaded(); return { ...state }; },
    async update(patch) {
      await ensureLoaded();
      state = { ...state, ...patch, updatedAt: new Date().toISOString() };
      await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      return { ...state };
    },
  };
}
