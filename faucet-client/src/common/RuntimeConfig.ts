export const NETWORKS = {
  devnet: {
    networkId: 'devnet',
    identity: 'net2',
    chainId: '424243',
    rpcUrl: 'https://rpc.net2.test-qms.com',
    chainName: 'QMS Devnet',
    explorerUrl: 'https://explorer.net2.test-qms.com',
    explorerName: 'QMS Explorer',
    dexApiUrl: 'https://dex-api.net2.test-qms.com',
    nativeCurrencyName: 'QMS',
    nativeCurrencySymbol: 'QMS',
    nativeCurrencyDecimals: '18',
    testnet: true,
  },
  stagenet: {
    networkId: 'stagenet',
    identity: 'net1',
    chainId: '424242',
    rpcUrl: 'https://rpc.net1.test-qms.com',
    chainName: 'QMS Stagenet',
    explorerUrl: 'https://explorer.net1.test-qms.com',
    explorerName: 'QMS Explorer',
    dexApiUrl: 'https://dex-api.net1.test-qms.com',
    nativeCurrencyName: 'QMS',
    nativeCurrencySymbol: 'QMS',
    nativeCurrencyDecimals: '18',
    testnet: true,
  },
  testnet: {
    networkId: 'testnet',
    identity: 'net3',
    chainId: '19480',
    rpcUrl: 'https://rpc.testnet.qms.finance',
    chainName: 'QMS Testnet',
    explorerUrl: 'https://testnet.qmsscan.io',
    explorerName: 'QMS Explorer',
    dexApiUrl: 'https://dex-api.net3.test-qms.com',
    nativeCurrencyName: 'QMS',
    nativeCurrencySymbol: 'QMS',
    nativeCurrencyDecimals: '18',
    testnet: true,
  },
} as const;

export type DeployedNetwork = typeof NETWORKS[keyof typeof NETWORKS];

export function getNetworkLabel(network?: DeployedNetwork): string {
  return network ? network.networkId.charAt(0).toUpperCase() + network.networkId.slice(1) : 'Testnet';
}

export async function loadRuntimeConfig(): Promise<{ network?: DeployedNetwork; chainId?: string; requestAmount: number; requestCircle: number }>
{
  let response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok)
    throw new Error('Could not load frontend runtime config');
  let config = await response.json();
  let limits = {
    requestAmount: config.requestAmount ?? 4,
    requestCircle: config.requestCircle ?? 24,
  };
  if (config.network) {
    if (!Object.prototype.hasOwnProperty.call(NETWORKS, config.network))
      throw new Error('Unknown frontend network: ' + config.network);
    let network = NETWORKS[config.network as keyof typeof NETWORKS];
    return { ...limits, network, chainId: network.chainId };
  }
  if (typeof config.chainId === 'string' && /^[0-9]+$/.test(config.chainId))
    return { ...limits, chainId: config.chainId };
  return limits;
}
