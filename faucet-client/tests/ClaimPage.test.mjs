import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));
const { transformSync } = require('@babel/core');

// The page reads the clock through Date and schedules through setTimeout: both are this
// file's, so a test can move time and fire timers without waiting.
const clock = { now: 1_800_000_000_000 };
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock.now])); }
  static now() { return clock.now; }
}
let timers = [];
let fetchImpl = null;
const context = vm.createContext({
  console: { log() {}, warn() {} },
  Date: FakeDate,
  JSON,
  setTimeout: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return timers.length; },
  clearTimeout: id => { if(timers[id - 1]) timers[id - 1].cancelled = true; },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: (...args) => fetchImpl(...args),
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
const { FaucetApi, FaucetApiError } = await loadComponent('../src/common/FaucetApi.ts', {
  loadRuntimeConfig: async () => ({}), FaucetTime: class { getSyncedTime() { return Math.floor(clock.now / 1000); } },
});
const ui = {
  default: React, useContext: React.useContext, LoadingIcon: Null, SlotOutlet: Null, ClaimInput: Null, QmsLayout: Null,
  FaucetConfigContext: React.createContext(null), FaucetPageContext: React.createContext(null),
  useParams: () => ({}), useNavigate: () => () => {}, toReadableAmount: () => '4', renderTimespan: () => '1s',
  renderDate: () => 'now', getNetworkLabel: () => 'Testnet', Button: Null, Collapse: Null, FaucetApiError,
};
let notifications;
class ClaimNotificationClient {
  constructor() { this.handlers = {}; this.started = 0; notifications = this; }
  on(event, fn) { (this.handlers[event] ||= []).push(fn); return this; }
  emit(event, message) { for(const fn of this.handlers[event] || []) fn(message); }
  start() { this.started++; }
  stop() {}
}
const { ClaimPage } = await loadComponent('../src/components/claim/ClaimPage.tsx', {
  ...ui, FaucetSession: { persistSessionInfo() {} }, emitHook: async () => {}, emitHookSafe() {}, ClaimNotificationClient,
});
const { DetailsPage } = await loadComponent('../src/components/details/DetailsPage.tsx', ui);

const flush = () => new Promise(resolve => setImmediate(resolve));
const claiming = { session: 's', status: 'claiming', start: 1, tasks: [], balance: '4', target: '0x' + '1'.repeat(40), claimIdx: 5 };
const finished = { ...claiming, status: 'finished', claimHash: '0xab', claimBlock: 7 };

function setup(Page, responses) {
  timers = [];
  const calls = { status: 0 };
  const faucetApi = {
    async getSessionStatus() {
      const next = responses[Math.min(calls.status++, responses.length - 1)];
      // FaucetApiError extends the vm context's Error, not this file's
      if(next instanceof Error || next instanceof FaucetApiError) throw next;
      return { ...next };
    },
    getFaucetTime: () => ({ getSyncedTime: () => Math.floor(clock.now / 1000) }),
  };
  const page = new Page({
    pageContext: { faucetApi, faucetUrls: { wsBaseUrl: 'ws://faucet.test/ws', apiUrl: '/api' } },
    faucetConfig: { modules: {}, sessionTimeout: 3600 }, navigateFn() {}, sessionId: 's',
  });
  page.setState = (update, callback) => {
    const prev = { ...page.state };
    Object.assign(page.state, typeof update === 'function' ? update(page.state) : update);
    page.componentDidUpdate?.(page.props, prev);
    callback?.();
  };
  return { page, calls };
}

// the page's one-second timer, as setUpdateTimer arms it
async function tick(page, ms) {
  clock.now += ms;
  page.pollClaimStatus();
  await flush();
}

test('renders never request the status, even when the confirmed index covers a pending claim', async () => {
  const { page, calls } = setup(ClaimPage, [claiming]);
  page.componentDidMount();
  await flush();
  page.setState({ claimNotification: { processedIdx: 6, confirmedIdx: 6 } });
  for(let i = 0; i < 20; i++) {
    clock.now += 50;
    page.render();
    await flush();
  }
  assert.equal(calls.status, 1);
  assert.equal(notifications.started, 1);
});

test('a settled update asks for the status once, however often it arrives before the answer is final', async () => {
  const { page, calls } = setup(ClaimPage, [claiming, claiming, finished]);
  page.componentDidMount();
  await flush();
  notifications.emit('update', { data: { processedIdx: 5, confirmedIdx: 5, settled: true } });
  await flush();
  notifications.emit('update', { data: { processedIdx: 5, confirmedIdx: 5, settled: true } });
  await flush();
  assert.equal(calls.status, 2);
  await tick(page, 5_000);
  assert.equal(calls.status, 3, 'a settled claim whose status is not final yet is asked again after 5 s');
  assert.equal(page.state.sessionStatus.status, 'finished');
});

test('the socket closing on a settled claim asks for the status', async () => {
  const { page, calls } = setup(ClaimPage, [claiming, finished]);
  page.componentDidMount();
  await flush();
  notifications.emit('error', { data: { reason: 'claim settled' } });
  await flush();
  assert.equal(calls.status, 2);
});

test('without the socket the status is asked every 30 seconds, and every 5 after a failure', async () => {
  const { page, calls } = setup(ClaimPage, [claiming, new FaucetApiError(429, 'HTTP 429'), claiming]);
  page.componentDidMount();
  await flush();
  await tick(page, 29_000);
  assert.equal(calls.status, 1);
  await tick(page, 1_000);
  assert.equal(calls.status, 2);
  assert.equal(page.state.sessionStatus.status, 'claiming', 'a failed poll keeps the status the page has');
  assert.equal(page.state.loadingError, false);
  await tick(page, 4_000);
  assert.equal(calls.status, 2);
  await tick(page, 1_000);
  assert.equal(calls.status, 3);
});

test('a first load retries a transient failure with backoff, and only that', async () => {
  const { page, calls } = setup(ClaimPage, [new FaucetApiError(429, 'HTTP 429'), claiming]);
  page.componentDidMount();
  await flush();
  assert.deepEqual(timers.filter(t => !t.cancelled).map(t => t.ms), [2000]);
  timers[0].fn();
  await flush();
  assert.equal(calls.status, 2);
  assert.equal(page.state.loadingError, false);

  const notFound = setup(ClaimPage, [new FaucetApiError(404, 'HTTP 404')]);
  notFound.page.componentDidMount();
  await flush();
  assert.equal(timers.length, 0, 'a 404 is not retried');
  assert.ok(notFound.page.state.loadingError);
});

test('leaving the page cancels the retry, and a failure after leaving schedules none', async () => {
  const { page } = setup(ClaimPage, [new FaucetApiError(503, 'HTTP 503')]);
  page.componentDidMount();
  await flush();
  page.componentWillUnmount();
  assert.equal(timers[0].cancelled, true);

  let reject;
  const late = setup(ClaimPage, [claiming]);
  late.page.props.pageContext.faucetApi.getSessionStatus = () => new Promise((_, fail) => { reject = fail; });
  late.page.componentDidMount();
  late.page.componentWillUnmount();
  reject(new FaucetApiError(503, 'HTTP 503'));
  await flush();
  assert.equal(timers.length, 0);
});

test('the details page keeps its status when a later poll fails', async () => {
  const { page } = setup(DetailsPage, [claiming, new FaucetApiError(429, 'HTTP 429')]);
  page.props.pageContext.setPageHeader = () => {};
  await page.refreshSessionStatus();
  await page.refreshSessionStatus();
  assert.equal(page.state.sessionStatus.status, 'claiming');
  assert.ok(!page.state.loadingError);
});

test('an html answer becomes a FaucetApiError that names the status', async () => {
  fetchImpl = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => '<html><body>429 Too Many Requests</body></html>' });
  const api = new FaucetApi('/api');
  await assert.rejects(api.getSessionStatus('s'), error => error instanceof FaucetApiError && error.status === 429 && error.isTransient());
});
