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

test('a finished active session without recovery state starts a new request', async () => {
  const { page, calls } = setup({ ...original, status: 'finished' });
  await page.onSubmitInputs({ addr: address });
  assert.equal(calls.started, 1);
  assert.deepEqual(calls.navigated, ['/claim/new']);
});

test('failed or missing sessions do not resume Review', async () => {
  for(const status of ['failed', undefined]) {
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

test('a same-address claiming session opens its existing claim without starting or claiming again', async () => {
  const { page, calls, faucetContext } = setup({ ...original, status: 'claiming' });
  faucetContext.faucetApi.claimReward = async () => assert.fail('must not claim again');
  await page.onSubmitInputs({ addr: address }, { captchaToken: 'unused' });
  assert.equal(calls.started, 0);
  assert.deepEqual(calls.navigated, ['/claim/original']);
});

test('a persisted finished session opens its existing claim', async () => {
  const { page, calls } = setup({ ...original, status: 'finished' }, false);
  await page.onSubmitInputs({ addr: address });
  assert.equal(calls.started, 0);
  assert.deepEqual(calls.navigated, ['/claim/original']);
});

test('a claiming session with a different target does not resume', async () => {
  const { page, calls } = setup({ ...original, status: 'claiming', target: '0x' + 'a'.repeat(40) });
  await page.onSubmitInputs({ addr: address });
  assert.equal(calls.started, 1);
  assert.deepEqual(calls.navigated, ['/claim/new']);
});

test('a lost claim response retries by opening the existing claiming or finished session', async () => {
  for(const status of ['claiming', 'finished']) {
    const { page, calls, faucetContext } = setup();
    const target = '0x' + 'a'.repeat(40);
    faucetContext.faucetApi.getSessionStatus = async id => {
      calls.checked++;
      assert.equal(id, 'new');
      return { ...original, session: 'new', target, status };
    };
    let claims = 0;
    faucetContext.faucetApi.claimReward = async () => {
      claims++;
      throw new Error('Lost response');
    };
    await assert.rejects(page.onSubmitInputs({ addr: target }, { captchaToken: 'claim-token' }), /Lost response/);
    await page.onSubmitInputs({ addr: target }, { captchaToken: 'claim-token' });
    assert.equal(calls.started, 1);
    assert.equal(claims, 1);
    assert.deepEqual(calls.navigated, ['/claim/new']);
  }
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

const { FaucetInput } = await loadComponent('../src/components/frontpage/FaucetInput.tsx', {
  default: require('react'), getPanels: () => [], getNetworkLabel: () => 'Testnet', toReadableAmount: () => '10',
});

function setupInput() {
  const calls = [];
  const input = new FaucetInput({
    faucetContext: { faucetUrls: {}, showNotification() {} },
    faucetConfig: { modules: { captcha: { requiredForStart: true } } },
    submitInputs: async (...args) => calls.push(args),
  });
  input.setState = update => Object.assign(input.state, update);
  return { input, calls };
}

test('a valid first click opens local Review without submitting or retrieving captcha', async () => {
  const { input, calls } = setupInput();
  input.state.targetAddr = address;
  input.faucetCaptcha.current = { getToken() { throw new Error('Must not check captcha'); } };
  await input.onSubmitBtnClick();
  assert.equal(input.state.reviewing, true);
  assert.equal(calls.length, 0);
});

test('Review accepts a custom captcha token without an onChange callback', async () => {
  const { input, calls } = setupInput();
  input.state.targetAddr = address;
  await input.onSubmitBtnClick();
  input.faucetCaptcha.current = { async getToken() { return 'custom-start-token'; }, resetToken() {} };
  await input.onSubmitBtnClick({ captchaToken: 'claim-token' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].captchaToken, 'custom-start-token');
  assert.equal(calls[0][0].addr, address);
  assert.equal(calls[0][1].captchaToken, 'claim-token');
});

test('Review Send starts then claims, and navigates only after claiming', async () => {
  const { page, calls, faucetContext } = setup();
  faucetContext.faucetApi.claimReward = async input => {
    assert.equal(input.session, 'new');
    assert.equal(input.captchaToken, 'claim-token');
    assert.equal(calls.started, 1);
    assert.equal(calls.navigated.length, 0);
    return { ...original, status: 'claiming' };
  };
  await page.onSubmitInputs({ addr: '0x' + 'a'.repeat(40), captchaToken: 'start-token' }, { captchaToken: 'claim-token' });
  assert.deepEqual(calls.navigated, ['/claim/new']);
  assert.equal(FaucetSession.recoverSessionInfo(), null);
});

test('Review Send resumes and claims an existing session', async () => {
  const { page, calls, faucetContext } = setup();
  let claimed = false;
  faucetContext.faucetApi.claimReward = async input => {
    assert.equal(input.session, 'original');
    claimed = true;
    return { ...original, status: 'claiming' };
  };
  await page.onSubmitInputs({ addr: address }, {});
  assert.equal(calls.started, 0);
  assert.equal(claimed, true);
});

test('failed Review claim retains session for retry and does not navigate', async () => {
  const { page, calls, faucetContext } = setup();
  faucetContext.faucetApi.claimReward = async () => { throw new Error('Network unavailable'); };
  await assert.rejects(page.onSubmitInputs({ addr: '0x' + 'a'.repeat(40) }, {}), /Network unavailable/);
  assert.equal(FaucetSession.recoverSessionInfo().id, 'new');
  assert.equal(calls.navigated.length, 0);
});

test('direct first step renders no captcha; Review renders the start captcha', () => {
  const { input } = setupInput();
  input.props.faucetConfig.maxClaim = 10n;
  input.props.faucetConfig.faucetCoinDecimals = 0;
  const form = input.render().props.children[0];
  assert.equal(form.props.children.some(child => child?.props?.variant === 'session'), false);
  input.state.reviewing = true;
  const review = input.renderReview('Send');
  assert.equal(review.props.children[3].props.variant, 'session');
});

test('an expired authoritative captcha stays in Review and sends no request', async () => {
  const { input, calls } = setupInput();
  input.state.reviewing = true;
  input.state.targetAddr = address;
  let resets = 0;
  input.faucetCaptcha.current = { async getToken() { return null; }, resetToken() { resets++; } };
  await input.onSubmitBtnClick({});
  assert.equal(calls.length, 0);
  assert.equal(resets, 1);
  assert.equal(input.state.reviewing, true);
  assert.equal(input.state.targetAddr, address);
});

test('submission errors reset captcha without leaving Review or losing address', async () => {
  const { input } = setupInput();
  input.state.reviewing = true;
  input.state.targetAddr = address;
  input.faucetCaptcha.current = { async getToken() { return 'token'; }, resetToken() {} };
  input.props.submitInputs = async () => { throw new Error('Expired captcha'); };
  await assert.rejects(input.onSubmitBtnClick({}), /Expired captcha/);
  assert.equal(input.state.reviewing, true);
  assert.equal(input.state.targetAddr, address);
  assert.equal(input.state.submitting, false);
});

test('first-step frontend validation blocks blank, whitespace, malformed, and zero addresses', async () => {
  const { input, calls } = setupInput();
  input.props.faucetConfig.maxClaim = 10n;
  input.props.faucetConfig.faucetCoinDecimals = 0;
  input.props.faucetConfig.faucetCoinSymbol = 'QMS';
  const notifications = [];
  input.props.faucetContext.showNotification = (level, message) => notifications.push({ level, message });
  for(const value of ['', '   ', 'invalid address', '0x1234', '0x' + '0'.repeat(40), address]) {
    input.state.targetAddr = value;
    const form = input.render().props.children[0];
    const actions = form.props.children.find(child => child?.props?.className === 'faucet-actions center');
    const button = actions.props.children;
    assert.equal(button.props.disabled, false);
    assert.equal(button.props.children[1], 'Send 10 Testnet QMS');
    assert.equal(notifications.length, 0);
    await input.onSubmitBtnClick();
    assert.equal(input.state.reviewing, value === address);
    assert.deepEqual(notifications, value === address ? [] : [{
      level: 'warning',
      message: value.trim() ? 'Please enter a valid EVM address' : 'Please enter your wallet address',
    }]);
    notifications.length = 0;
    input.state.reviewing = false;
  }
  assert.equal(calls.length, 0);
});
