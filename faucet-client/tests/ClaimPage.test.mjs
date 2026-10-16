import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));
const { transformSync } = require('@babel/core');

// The pages read the clock through Date and schedule through setTimeout; both are this
// file's, so a test can advance time and run timers without waiting.
const clock = { now: 1_800_000_000_000 };
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock.now])); }
  static now() { return clock.now; }
}
let timers = [];
const context = vm.createContext({
  console: { log() {} },
  Date: FakeDate,
  setTimeout: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return timers.length; },
  clearTimeout: id => { if(timers[id - 1]) timers[id - 1].cancelled = true; },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
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

const React = require('react');
const Null = () => null;
const ui = {
  default: React, useContext: React.useContext, LoadingIcon: Null, SlotOutlet: Null, ClaimInput: Null, QmsLayout: Null,
  FaucetConfigContext: React.createContext(null), FaucetPageContext: React.createContext(null),
  useParams: () => ({}), useNavigate: () => () => {}, toReadableAmount: () => '4', renderTimespan: () => '1s',
  renderDate: () => 'now', getNetworkLabel: () => 'Testnet', Button: Null, Collapse: Null,
};
class ClaimNotificationClient { on() { return this; } start() {} stop() {} }
const { ClaimPage } = await loadComponent('../src/components/claim/ClaimPage.tsx', {
  ...ui, FaucetSession: { persistSessionInfo() {} }, emitHook: async () => {}, emitHookSafe() {}, ClaimNotificationClient,
});
const { DetailsPage } = await loadComponent('../src/components/details/DetailsPage.tsx', ui);

const flush = () => new Promise(resolve => setImmediate(resolve));
const claiming = { session: 's', status: 'claiming', start: 1, tasks: [], balance: '4', target: '0x' + '1'.repeat(40), claimIdx: 5 };

function setup(Page, responses) {
  timers = [];
  const calls = { status: 0 };
  const faucetApi = {
    // A fresh object per response, as the network gives: PureComponent never short-circuits.
    async getSessionStatus() {
      const next = responses[Math.min(calls.status++, responses.length - 1)];
      if(next instanceof Error) throw next;
      if(typeof next === 'function') return next();
      return { ...next };
    },
    getFaucetTime: () => ({ getSyncedTime: () => Math.floor(clock.now / 1000) }),
  };
  const page = new Page({
    pageContext: { faucetApi, faucetUrls: { wsBaseUrl: 'ws://faucet.test/ws' } },
    faucetConfig: { modules: {} }, navigateFn() {}, sessionId: 's',
  });
  page.setState = (update, callback) => {
    Object.assign(page.state, typeof update === 'function' ? update(page.state) : update);
    callback?.();
  };
  return { page, calls };
}

test('a confirmation that covers the claim polls at most once a second while the server still says claiming', async () => {
  const { page, calls } = setup(ClaimPage, [claiming]);
  page.componentDidMount();
  await flush();
  page.setState({ claimNotification: { processedIdx: 6, confirmedIdx: 6 } });
  // Every response renders again; 20 renders 50 ms apart are one second of that loop.
  for(let i = 0; i < 20; i++) {
    clock.now += 50;
    page.render();
    await flush();
  }
  // The mount's request at t, then exactly one more once a second has passed.
  assert.equal(calls.status, 2);
});

test('without a covering confirmation the status is still re-polled after 30 seconds', async () => {
  const { page, calls } = setup(ClaimPage, [claiming, { ...claiming, status: 'finished' }]);
  page.componentDidMount();
  await flush();
  page.setState({ claimNotification: { processedIdx: 4, confirmedIdx: 4 } });
  clock.now += 29_000;
  page.render();
  await flush();
  assert.equal(calls.status, 1);
  clock.now += 2_000;
  page.render();
  await flush();
  assert.equal(calls.status, 2);
  assert.equal(page.state.sessionStatus.status, 'finished');
});

test('a failed poll does not leave its error on screen once a later poll succeeds', async () => {
  const { page } = setup(ClaimPage, [claiming, new SyntaxError("Unexpected token '<'"), { ...claiming, status: 'finished' }]);
  page.componentDidMount();
  await flush();
  page.state.claimNotification = { processedIdx: 6, confirmedIdx: 6 };
  for(let i = 0; i < 3; i++) {
    clock.now += 1_500;
    page.render();
    await flush();
  }
  assert.equal(page.state.sessionStatus.status, 'finished');
  assert.equal(page.state.loadingError, false);
});

test('a failed first load is retried instead of leaving the page on the error', async () => {
  const { page, calls } = setup(ClaimPage, [new SyntaxError("Unexpected token '<'"), claiming]);
  page.componentDidMount();
  await flush();
  assert.ok(page.state.loadingError);
  assert.equal(timers.length, 1);
  timers[0].fn();
  await flush();
  assert.equal(calls.status, 2);
  assert.equal(page.state.loadingError, false);
  assert.equal(page.state.sessionStatus.status, 'claiming');
});

test('the details page clears a poll error once a later poll succeeds', async () => {
  const { page } = setup(DetailsPage, [new SyntaxError("Unexpected token '<'"), claiming]);
  await page.refreshSessionStatus();
  assert.ok(page.state.loadingError);
  await page.refreshSessionStatus();
  assert.equal(page.state.loadingError, false);
});

test('a status request still in flight is not repeated, however often the page renders', async () => {
  let release;
  const { page, calls } = setup(ClaimPage, [claiming, () => new Promise(resolve => { release = resolve; })]);
  page.componentDidMount();
  await flush();
  page.setState({ claimNotification: { processedIdx: 6, confirmedIdx: 6 } });
  for(let i = 0; i < 30; i++) {
    clock.now += 100;
    page.render();
    await flush();
  }
  assert.equal(calls.status, 2);
  release({ ...claiming, status: 'finished' });
  await flush();
  assert.equal(page.state.sessionStatus.status, 'finished');
});

test('a failed first load backs off 2, 4, 8, 16 and 32 seconds, then stops', async () => {
  const { page, calls } = setup(ClaimPage, [new SyntaxError("Unexpected token '<'")]);
  page.componentDidMount();
  await flush();
  for(let i = 0; i < 5; i++) {
    timers[i].fn();
    await flush();
  }
  assert.deepEqual(timers.map(timer => timer.ms), [2000, 4000, 8000, 16000, 32000]);
  assert.equal(calls.status, 6);
});

test('leaving the page cancels a scheduled retry', async () => {
  const { page } = setup(ClaimPage, [new SyntaxError("Unexpected token '<'")]);
  page.componentDidMount();
  await flush();
  page.componentWillUnmount();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].cancelled, true);
});

test('a first load that fails after the page has gone schedules no retry', async () => {
  let reject;
  const { page } = setup(ClaimPage, [() => new Promise((_, fail) => { reject = fail; })]);
  page.componentDidMount();
  await flush();
  page.componentWillUnmount();
  reject(new SyntaxError("Unexpected token '<'"));
  await flush();
  assert.equal(timers.length, 0);
});
