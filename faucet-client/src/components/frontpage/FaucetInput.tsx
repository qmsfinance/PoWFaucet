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
import { toReadableAmount } from '../../utils/ConvertHelpers';

export interface IFaucetInputProps {
  faucetContext: IFaucetContext;
  faucetConfig: IFaucetConfig
  submitInputs(inputs: any): Promise<void>;
}

export interface IFaucetInputState {
  submitting: boolean;
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
    let invalidAddress = !playing && !hasMining && this.state.targetAddr.length > 0 &&
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
    if(invalidAddress) {
      submitBtnCaption = "Please enter a valid EVM address";
    }

    return (
      <div className="faucet-inputs qms-faucet-inputs">
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
        {requestCaptcha ? 
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
              {submitBtnCaption}
          </button>
        </div>
        <p className="qms-card__limit">LIMIT: 4 REQUESTS / 24H</p>
      </div>
    );
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

  private async onSubmitBtnClick() {
    this.setState({
      submitting: true
    });

    try {
      let inputData: any = {};

      inputData.addr = this.state.targetAddr;
      if(this.props.faucetConfig.modules.captcha?.requiredForStart) {
        inputData.captchaToken = await this.faucetCaptcha.current?.getToken();
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

      await this.props.submitInputs(inputData);
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
