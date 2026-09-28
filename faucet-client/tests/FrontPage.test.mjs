import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));
const { transformSync } = require('@babel/core');
const storage = new Map();
const context = vm.createContext({
  console: { log() {} },
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  },
});

async function loadComponent(path, exports) {
  const filename = new URL(path, import.meta.url);
  const { code, ast } = transformSync(readFileSync(filename, 'utf8'), {
    filename: filename.pathname,
    presets: [require.resolve('@babel/preset-typescript'), [require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
    ast: true,
  });
  const module = new vm.SourceTextModule(code, { context });
  await module.link(specifier => {
    const declaration = ast.program.body.find(node => node.type === 'ImportDeclaration' && node.source.value === specifier);
    const names = declaration.specifiers.map(node => node.type === 'ImportDefaultSpecifier' ? 'default' : node.imported.name);
    return new vm.SyntheticModule(names, function() {
      for(const name of names)
        this.setExport(name, exports[name]);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

const { FaucetSession } = await loadComponent('../src/common/FaucetSession.ts', {});
const { FrontPage } = await loadComponent('../src/components/frontpage/FrontPage.tsx', {
  default: require('react'), FaucetSession,
  emitHook: async () => {}, emitHookSafe() {}, hasPlayableTask: () => false,
});
const address = '0x1234567890abcdef1234567890abcdef12345678';
const original = { session: 'original', status: 'claimable', target: address, start: 1, balance: '10', tasks: [] };

function setup(status = original, active = true) {
  storage.clear();
  const calls = { started: 0, checked: 0, navigated: [], dialogs: [] };
  const faucetContext = {
    faucetApi: {
      async getSessionStatus(id) { assert.equal(id, 'original'); calls.checked++; return status; },
      async startSession(input) { calls.started++; return { ...original, session: 'new', target: input.addr }; },
    },
    showDialog: dialog => calls.dialogs.push(dialog),
  };
  const session = new FaucetSession(faucetContext, 'original', original);
  if(active) faucetContext.activeSession = session;
  else FaucetSession.persistSessionInfo(session);
  const page = new FrontPage({ faucetContext, faucetConfig: { modules: {} }, navigateFn: path => calls.navigated.push(path) });
  return { page, calls, faucetContext };
}

test('back from Review resumes same-address session without starting another', async () => {
  const { page, calls } = setup();
  await page.onSubmitInputs({ addr: address.toUpperCase() });
  assert.equal(calls.started, 0);
  assert.deepEqual(calls.navigated, ['/claim/original']);
  assert.equal(calls.dialogs.length, 0);
});

test('reload resumes persisted unclaimed session', async () => {
  const { page, calls } = setup(original, false);
  await page.onSubmitInputs({ addr: address });
  assert.equal(calls.started, 0);
  assert.deepEqual(calls.navigated, ['/claim/original']);
});

test('different address starts and persists a new session', async () => {
  const { page, calls } = setup();
  await page.onSubmitInputs({ addr: '0x' + 'a'.repeat(40) });
  assert.equal(calls.checked, 0);
  assert.equal(calls.started, 1);
  assert.equal(FaucetSession.recoverSessionInfo().id, 'new');
});

test('submitted, finished, failed, or missing sessions do not resume Review', async () => {
  for(const status of ['claiming', 'finished', 'failed', undefined]) {
    const { page, calls } = setup({ ...original, status });
    await page.onSubmitInputs({ addr: address });
    assert.equal(calls.started, 1);
    assert.deepEqual(calls.navigated, ['/claim/new']);
  }
});

test('server target must match before resuming', async () => {
  const { page, calls } = setup({ ...original, target: '0x' + 'a'.repeat(40) });
  await page.onSubmitInputs({ addr: address });
  assert.equal(calls.started, 1);
});

test('recurring-limit failures still surface for a completed session', async () => {
  const { page, calls, faucetContext } = setup({ ...original, status: 'finished' });
  faucetContext.faucetApi.startSession = async () => ({ status: 'failed', failedCode: 'RECURRING_LIMIT', failedReason: 'Wait before claiming again' });
  await assert.rejects(page.onSubmitInputs({ addr: address }), error => String(error).includes('RECURRING_LIMIT'));
  assert.equal(calls.navigated.length, 0);
  assert.equal(calls.dialogs.length, 1);
});

test('a failed status lookup does not create a duplicate session', async () => {
  const { page, calls, faucetContext } = setup();
  faucetContext.faucetApi.getSessionStatus = async () => { throw new Error('Network unavailable'); };
  await assert.rejects(page.onSubmitInputs({ addr: address }), /Network unavailable/);
  assert.equal(calls.started, 0);
});
