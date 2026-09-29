import { getNetworkLabel } from '../../common/RuntimeConfig';
import { LoadingIcon } from '../shared/LoadingIcon';
import React from 'react';
import { IFaucetConfig } from '../../common/FaucetConfig';
import { getPanels, IRegisteredPanel } from '../../sdk/slots';
import { IFaucetContext } from '../../common/FaucetContext';
import { FaucetCaptcha } from '../shared/FaucetCaptcha';
import { AuthenticatoorLogin } from './authenticatoor/AuthenticatoorLogin';
import { GithubLogin } from './github/GithubLogin';
import { ZupassLogin } from './zupass/ZupassLogin';
import VoucherInput, { IVoucherInputRef } from './voucher/VoucherInput';
import { ClaimInput } from '../claim/ClaimInput';
import { toReadableAmount } from '../../utils/ConvertHelpers';

export interface IFaucetInputProps {
  faucetContext: IFaucetContext;
  faucetConfig: IFaucetConfig
  submitInputs(inputs: any, claimData?: any): Promise<void>;
}

export interface IFaucetInputState {
  submitting: boolean;
  reviewing: boolean;
  addressCopied: boolean;
  targetAddr: string;
  /** the module a session would be started with, "" = mine only */
  /** the module a session would be started with, "" for mining alone */
  startModule: string;
  /** what goes in the start request's `params.mode`; opaque here */
  startMode: string;
}

export class FaucetInput extends React.PureComponent<IFaucetInputProps, IFaucetInputState> {
  private faucetCaptcha = React.createRef<FaucetCaptcha>();
  private authenticatoorLogin = React.createRef<AuthenticatoorLogin>();
  private githubLogin = React.createRef<GithubLogin>();
  private zupassLogin = React.createRef<ZupassLogin>();
  private voucherInput = React.createRef<IVoucherInputRef>();

  constructor(props: IFaucetInputProps) {
    super(props);

    this.state = {
      submitting: false,
      reviewing: false,
      addressCopied: false,
      targetAddr: "",
      startModule: "",
      startMode: "",
		};
  }

	public render(): React.ReactElement<IFaucetInputProps> {
    let needAuthenticatoor = !!this.props.faucetConfig.modules.authenticatoor;
    let needGithubAuth = !!this.props.faucetConfig.modules.github;
    let needZupassAuth = !!this.props.faucetConfig.modules.zupass && !!this.props.faucetConfig.modules.zupass.event;
    let needVoucher = !!this.props.faucetConfig.modules.voucher;
    let requestCaptcha = !!this.props.faucetConfig.modules.captcha?.requiredForStart;
    let panels = getPanels("mining").filter((panel) => panel.modes && panel.modes.length > 0);
    let hasMining = !!this.props.faucetConfig.modules.pow;
    let playing = !!this.state.startModule;
    let invalidAddress = !playing && !hasMining &&
      (!/^0x[0-9a-fA-F]{40}$/.test(this.state.targetAddr) || /^0x0{40}$/i.test(this.state.targetAddr));

    let submitBtnCaption: string;
    // "does this session still mine" is the core's own question, and the mode the
    // player picked answers it - the panel said so when it registered. The core
    // does not know what the mode *means*, only that one.
    let picked = this.pickedMode(panels);
    if(playing && picked && !picked.withMining) {
      submitBtnCaption = "Start " + (picked.label || "Playing");
    }
    else if(playing) {
      submitBtnCaption = "Start Mining & " + (picked && picked.label ? picked.label : "Playing");
    }
    else if(hasMining) {
      submitBtnCaption = "Start Mining";
    }
    else {
      submitBtnCaption = "Send " + toReadableAmount(this.props.faucetConfig.maxClaim, this.props.faucetConfig.faucetCoinDecimals) + " " + getNetworkLabel(this.props.faucetConfig.network) + " " + this.props.faucetConfig.faucetCoinSymbol;
    }

    return (
      <>
      <div className="faucet-inputs qms-faucet-inputs" style={this.state.reviewing ? { display: 'none' } : undefined}>
        <label className="qms-faucet-inputs__label" htmlFor="faucet-wallet-address">Wallet address</label>
        <div className="qms-faucet-inputs__wallet">
          <input
            id="faucet-wallet-address"
            className="form-control"
            value={this.state.targetAddr}
            placeholder={this.props.faucetConfig.modules.ensname?.required ? "name.eth" : "0x…"}
            onChange={(evt) => this.setState({ targetAddr: evt.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="qms-faucet-inputs__paste" type="button" onClick={() => this.onPasteAddress()}>Paste</button>
        </div>
        {needAuthenticatoor ?
          <AuthenticatoorLogin
            faucetConfig={this.props.faucetConfig}
            faucetContext={this.props.faucetContext}
            ref={this.authenticatoorLogin}
          />
        : null}
        {needGithubAuth ?
          <GithubLogin
            faucetConfig={this.props.faucetConfig}
            faucetContext={this.props.faucetContext}
            ref={this.githubLogin}
          />
        : null}
        {needZupassAuth ? 
          <React.Suspense fallback={<div>loading...</div>}>
            <ZupassLogin 
              faucetConfig={this.props.faucetConfig} 
              faucetContext={this.props.faucetContext} 
              ref={this.zupassLogin}
            />
          </React.Suspense>
        : null}
        {needVoucher ?
          <VoucherInput
            faucetConfig={this.props.faucetConfig}
            faucetContext={this.props.faucetContext}
            ref={this.voucherInput}
          />
        : null}
        {panels.length > 0 ? this.renderStartModes(panels, hasMining) : null}
        {requestCaptcha && (playing || hasMining) ?
          <FaucetCaptcha
            faucetConfig={this.props.faucetConfig}
            ref={this.faucetCaptcha}
            variant='session'
          />
        : null}
        <div className="faucet-actions center">
          <button 
            className="btn btn-success start-action" 
            onClick={(evt) => this.onSubmitBtnClick()} 
            disabled={this.state.submitting || invalidAddress}>
              {this.state.submitting ?
              <span className='inline-spinner'>
                <LoadingIcon />
              </span>
              : null}
              {invalidAddress ? 'Please enter a valid EVM address' : !playing && !hasMining ? 'Review' : submitBtnCaption}
          </button>
        </div>
        <p className="qms-card__limit">LIMIT: 4 REQUESTS / 24H</p>
      </div>
      {this.state.reviewing ? this.renderReview(submitBtnCaption) : null}
      </>
    );
	}

  private renderReview(caption: string): React.ReactElement {
    let amount = toReadableAmount(this.props.faucetConfig.maxClaim, this.props.faucetConfig.faucetCoinDecimals);
    let address = this.state.targetAddr;
    let images = this.props.faucetContext.faucetUrls.imagesUrl || '/images';
    return (
      <div className="qms-claim__content">
        <div className="qms-card__top">
          <button className="qms-card__back" onClick={() => this.setState({ reviewing: false })} disabled={this.state.submitting}><img src={images + '/qms-chevron.svg'} alt="" width="12" height="12" />CHANGE ADDRESS</button>
          <span>STEP 2 OF 3</span>
        </div>
        <div className="qms-card__amount"><p>YOU’RE CLAIMING</p><strong>{amount}</strong><span>{getNetworkLabel(this.props.faucetConfig.network)} {this.props.faucetConfig.faucetCoinSymbol}</span></div>
        <div className="qms-card__details">
          <div><span>Wallet</span><span className="qms-card__wallet"><span title={address}>{address ? address.slice(0, 8) + '…' + address.slice(-6) : '—'}</span><button aria-label={this.state.addressCopied ? 'Wallet address copied' : 'Copy wallet address'} onClick={() => this.copyAddress()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {this.state.addressCopied ? <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="m16 9-5.5 5.5L8 12" /></> : <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>}
            </svg>
          </button></span></div>
          <div><span>Network</span><span>{this.props.faucetConfig.network?.chainName || 'Testnet'}{this.props.faucetConfig.chainId ? <span className="qms-card__muted"> · {this.props.faucetConfig.chainId}</span> : null}</span></div>
        </div>
        {this.props.faucetConfig.modules.captcha?.requiredForStart ?
          <FaucetCaptcha
            faucetConfig={this.props.faucetConfig}
            ref={this.faucetCaptcha}
            variant='session'
          />
        : null}
        <ClaimInput faucetConfig={this.props.faucetConfig} caption={caption} submitInputs={(claimData) => this.onSubmitBtnClick(claimData)} />
      </div>
    );
  }

  private async copyAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.state.targetAddr);
      this.setState({ addressCopied: true });
    } catch {
      this.setState({ addressCopied: false });
    }
  }

  /** the mode the player has chosen, or null when they are mining alone */
  private pickedMode(panels: IRegisteredPanel[]) {
    if(!this.state.startModule)
      return null;
    let panel = panels.filter((entry) => entry.module === this.state.startModule)[0];
    if(!panel || !panel.modes)
      return null;
    return panel.modes.filter((mode) => mode.key === this.state.startMode)[0] || null;
  }

  /**
   * How to start: mining alone, or one of the ways a registered panel offers.
   *
   * The core used to write these out - "Mine + Play", "Play only", and a config
   * flag saying whether the second was allowed - which is the platform knowing
   * that playing is a thing, that a module might replace mining with it, and
   * what to call it. A panel declares its own now, and a session starts with
   * `{ module, params: { mode } }` where the core has never read `mode`.
   *
   * A mode whose `withMining` is true needs something to mine with, so it is not
   * offered on a faucet with no pow module.
   */
  private renderStartModes(panels: IRegisteredPanel[], hasMining: boolean): React.ReactElement {
    let options: { key: string; module: string; mode: string; label: string; hint: string }[] = [];
    panels.forEach((panel) => {
      let prefix = panels.length > 1 ? (panel.title || panel.module) + ": " : "";
      (panel.modes || []).forEach((mode) => {
        if(mode.withMining && !hasMining)
          return;
        options.push({
          key: panel.module + ":" + mode.key,
          module: panel.module,
          mode: mode.key,
          label: prefix + mode.label,
          hint: mode.hint || "",
        });
      });
    });
    if(options.length === 0)
      return null;

    return (
      <div className="faucet-start-modes">
        <div className="start-modes-label">How do you want to earn?</div>
        <div className="start-modes-options">
          {hasMining ?
            <button
              type="button"
              className={"btn btn-sm start-mode" + (this.state.startModule === "" ? " btn-primary active" : " btn-outline-primary")}
              onClick={() => this.setState({ startModule: "", startMode: "" })}
              title="Mining only"
            >
              Mine
            </button>
          : null}
          {options.map((option) => {
            let selected = this.state.startModule === option.module && this.state.startMode === option.mode;
            return (
              <button
                type="button"
                key={option.key}
                className={"btn btn-sm start-mode" + (selected ? " btn-primary active" : " btn-outline-primary")}
                onClick={() => this.setState({ startModule: option.module, startMode: option.mode })}
                title={option.hint}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  private async onSubmitBtnClick(claimData?: any) {
    if(!this.props.faucetConfig.modules.pow && !this.state.startModule && !this.state.reviewing) {
      if(!/^0x[0-9a-fA-F]{40}$/.test(this.state.targetAddr) || /^0x0{40}$/i.test(this.state.targetAddr))
        return;
      this.setState({ reviewing: true, addressCopied: false });
      return;
    }
    if(this.state.reviewing && this.props.faucetConfig.modules.captcha?.requiredForClaim && !claimData?.captchaToken) {
      this.props.faucetContext.showNotification("warning", "Complete the claim captcha before sending. It may have expired.");
      return;
    }
    this.setState({
      submitting: true
    });

    try {
      let inputData: any = {};

      inputData.addr = this.state.targetAddr;
      if(this.props.faucetConfig.modules.captcha?.requiredForStart) {
        inputData.captchaToken = await this.faucetCaptcha.current?.getToken();
        if(this.state.reviewing && !inputData.captchaToken) {
          this.faucetCaptcha.current?.resetToken();
          this.props.faucetContext.showNotification("warning", "Complete the captcha before sending. It may have expired.");
          return;
        }
      }
      if(this.props.faucetConfig.modules.authenticatoor) {
        inputData.authToken = this.authenticatoorLogin.current?.getToken() || undefined;
      }
      if(this.props.faucetConfig.modules.github) {
        inputData.githubToken = await this.githubLogin.current?.getToken();
      }
      if(this.props.faucetConfig.modules.zupass && this.props.faucetConfig.modules.zupass.event) {
        inputData.zupassToken = await this.zupassLogin.current?.getToken();
      }
      if (this.props.faucetConfig.modules.voucher) {
        inputData.voucherCode = this.voucherInput.current?.getCode();
      }
      if(this.state.startModule) {
        // `params` is the module's to fill and the core's to forward untouched
        // `mode` is a key the panel gave us and we have never
        // read; the module's server half is the only thing that knows it.
        inputData.module = this.state.startModule;
        inputData.params = { mode: this.state.startMode };
      }

      await this.props.submitInputs(inputData, claimData);
    } catch(ex) {
      if(this.faucetCaptcha.current)
        this.faucetCaptcha.current.resetToken();
      throw ex;
    } finally {
      this.setState({
        submitting: false
      });
    }
  }

  private async onPasteAddress(): Promise<void> {
    try {
      let targetAddr = await navigator.clipboard.readText();
      this.setState({ targetAddr: targetAddr.trim() });
    } catch {
      this.props.faucetContext.showNotification("warning", "Clipboard access was denied. Paste your wallet address manually.");
    }
  }

}
