import { getNetworkLabel } from '../../common/RuntimeConfig';
import React from 'react';
import { IFaucetConfig } from '../../common/FaucetConfig';
import { toReadableAmount } from '../../utils/ConvertHelpers';
import '../frontpage/FrontPage.scss';

export function QmsLayout(props: { faucetConfig: IFaucetConfig; children: React.ReactNode }): React.ReactElement {
  let amount = toReadableAmount(props.faucetConfig.maxClaim, props.faucetConfig.faucetCoinDecimals);
  return (
    <div className="qms-flow">
      <section className="qms-flow__main">
        <div className="qms-flow__intro">
          <p>{props.faucetConfig.network?.chainName || 'QMS TESTNET'}{props.faucetConfig.chainId ? <> · CHAIN ID {props.faucetConfig.chainId}</> : null}</p>
          <h1>Get {getNetworkLabel(props.faucetConfig.network)} {props.faucetConfig.faucetCoinSymbol}</h1>
          <span>Free testnet tokens for building and testing on {props.faucetConfig.faucetCoinSymbol}. They have no real-world value.</span>
        </div>
        {props.children}
      </section>
      <section className="qms-flow__notes">
        <div className="qms-flow__notes-header">
          <div><p>NOTES</p><h2>Good to know</h2></div>
          <span>Need help? Ask on <a className="qms-flow__help" href="https://discord.com/invite/qmsnetwork" target="_blank" rel="noopener noreferrer">Discord</a>.</span>
        </div>
        <div className="qms-flow__notes-grid">
          {[
            `Each request sends ${amount} ${getNetworkLabel(props.faucetConfig.network)} ${props.faucetConfig.faucetCoinSymbol} to your wallet.`,
            `${getNetworkLabel(props.faucetConfig.network)} ${props.faucetConfig.faucetCoinSymbol} has no real-world value.`,
            'Double-check your address.',
            `Limit: ${props.faucetConfig.requestAmount ?? 4} requests per address or device every ${props.faucetConfig.requestCircle ?? 24} hours.`,
          ].map((note, index) => <div key={index}><p>{('0' + (index + 1)).slice(-2)}</p><span>{note}</span></div>)}
        </div>
      </section>
    </div>
  );
}
