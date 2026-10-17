import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));
const { transformSync } = require('@babel/core');
const React = require('react');
const ReactRouter = require('react-router');
const { renderToString } = require('react-dom/server');

// A browser location whose hash follows `href = "#/..."` assignments, as a real one does.
const fakeLocation = {
  origin: 'https://faucet.example', pathname: '/', search: '', hash: '',
  set href(value) { this.hash = value.startsWith('#') ? value : ''; },
  get href() { return 'https://faucet.example/' + this.hash; },
};
const fakeWindow = {
  location: fakeLocation,
  history: { state: null, replaceState() {}, pushState() {}, go() {} },
  addEventListener() {}, removeEventListener() {},
};
fakeWindow.document = { defaultView: fakeWindow, querySelector: () => null };
globalThis.document = fakeWindow.document;
globalThis.window = fakeWindow;
const context = vm.createContext({ console: { log() {}, error() {} }, location: fakeLocation });

const marker = name => () => React.createElement('span', null, name);
const stubs = {
  'react': { default: React },
  'react-router': ReactRouter,
  '../common/FaucetApi': { FaucetApi: class {} },
  '../common/RuntimeConfig': { getNetworkLabel: () => 'Testnet' },
  './shared/FaucetNotification': { FaucetNotification: () => null },
  './shared/FaucetDialog': { FaucetDialog: () => null },
  './frontpage/FrontPage': { default: marker('FRONT-PAGE') },
  './mining/MiningPage': { default: marker('MINING-PAGE') },
  './claim/ClaimPage': { default: marker('CLAIM-PAGE') },
  './details/DetailsPage': { default: marker('DETAILS-PAGE') },
  './status/FaucetStatusPage': { default: marker('STATUS-PAGE') },
  './status/QueueStatusPage': { default: marker('QUEUE-PAGE') },
  '../sdk/flags': { getCoreFlags: () => ({}) },
  '../sdk/slots': { getRoutes: () => [] },
  '../sdk/sdk': { publishFaucetConfig() {}, publishFaucetContext() {} },
  '../sdk/hooks': { emitHookSafe() {} },
  '../sdk/SlotOutlet': { SlotOutlet: () => null },
  './shared/SiteLoader': { markSplashShellReady() {} },
  '../types/PoWMinerSrc': { getPoWMinerDefaultSrc: () => ({}) },
  '../utils/QueryUtils': { joinUrl: (a, b) => a.replace(/\/$/, '') + b },
};

async function loadFaucetPage() {
  const filename = new URL('../src/components/FaucetPage.tsx', import.meta.url);
  const { code, ast } = transformSync(readFileSync(filename, 'utf8'), {
    filename: filename.pathname,
    presets: [require.resolve('@babel/preset-typescript'), [require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
    ast: true,
  });
  const module = new vm.SourceTextModule(code, { context });
  await module.link(specifier => {
    const declaration = ast.program.body.find(node => node.type === 'ImportDeclaration' && node.source.value === specifier);
    const names = declaration.specifiers.map(node => node.type === 'ImportDefaultSpecifier' ? 'default' : node.imported.name);
    const exports = stubs[specifier] || {};
    return new vm.SyntheticModule(names, function() {
      for(const name of names)
        this.setExport(name, exports[name]);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

const { FaucetPage } = await loadFaucetPage();

function renderAt(hash, before) {
  fakeLocation.hash = hash;
  const page = new FaucetPage({});
  if(before)
    before(page);
  page.state = { initializing: false, faucetConfig: { faucetTitle: 'QMS Faucet', modules: {} }, faucetStatus: [], statusAlerts: [], dialogs: [], notifications: [] };
  return renderToString(page.render());
}

test('the front page still renders at the root URL', () => {
  assert.match(renderAt(''), /FRONT-PAGE/);
});

test('a page opened at /#/status renders the faucet status page', () => {
  const html = renderAt('#/status');
  assert.match(html, /STATUS-PAGE/);
  assert.doesNotMatch(html, /FRONT-PAGE/);
});

test('a page opened at /#/queue renders the queue status page', () => {
  assert.match(renderAt('#/queue'), /QUEUE-PAGE/);
});

test('ten clicks on the header network pill route to the status page', () => {
  const html = renderAt('', page => {
    for(let i = 0; i < 10; i++)
      page.onFaucetStatusClick();
    assert.equal(fakeLocation.hash, '#/status');
  });
  assert.match(html, /STATUS-PAGE/);
});
