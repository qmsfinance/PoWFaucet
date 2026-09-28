import { LoadingIcon } from '../shared/LoadingIcon';
import { IFaucetConfig, LOCAL_CLAIM_INTERVAL_SECONDS } from '../../common/FaucetConfig';
import { FaucetConfigContext, FaucetPageContext } from '../FaucetPage';
import React, { useContext } from 'react';
import { useParams, useNavigate, NavigateFunction } from "react-router";
import { IFaucetContext } from '../../common/FaucetContext';
import { FaucetSession, IFaucetSessionStatus } from '../../common/FaucetSession';
import { toReadableAmount } from '../../utils/ConvertHelpers';
import { renderTimespan } from '../../utils/DateUtils';
import { ClaimInput } from './ClaimInput';
import { SlotOutlet } from '../../sdk/SlotOutlet';
import { emitHook, emitHookSafe } from '../../sdk/hooks';
import { ClaimNotificationClient, IClaimNotificationUpdateData } from './ClaimNotificationClient';

import './ClaimPage.css'
import { QmsLayout } from '../shared/QmsLayout';

// Component that preserves DOM elements by only setting innerHTML once
class ResultSharingHtml extends React.Component<{ html: string }> {
  private divRef = React.createRef<HTMLDivElement>();
  private htmlSet = false;

  componentDidMount() {
    if (this.divRef.current && !this.htmlSet) {
      this.divRef.current.innerHTML = this.props.html;
      this.htmlSet = true;
    }
  }

  shouldComponentUpdate() {
    // Never update once rendered - preserves iframe and all DOM elements
    return false;
  }

  render() {
    return <div className="sh-html" ref={this.divRef} />;
  }
}

export interface IClaimPageProps {
  pageContext: IFaucetContext;
  faucetConfig: IFaucetConfig;
  navigateFn: NavigateFunction;
  sessionId: string;
}

export interface IClaimPageState {
  sessionStatus: IFaucetSessionStatus;
  sessionDetails: {data: any, claim: any};
  loadingStatus: boolean;
  loadingError: string|boolean;
  isTimedOut: boolean;
  claimProcessing: boolean;
  refreshIndex: number;
  claimNotification: IClaimNotificationUpdateData;
  claimNotificationConnected: boolean;
  addressCopied: boolean;
  lastSuccessfulClaim: number;
}


export class ClaimPage extends React.PureComponent<IClaimPageProps, IClaimPageState> {
  private updateTimer: NodeJS.Timeout;
  private copyResetTimer: ReturnType<typeof setTimeout>;
  private loadingStatus: boolean;
  private isTimedOut: boolean;
  private notificationClient: ClaimNotificationClient;
  private notificationClientActive: boolean;
  private lastStatusPoll: number;

  constructor(props: IClaimPageProps) {
    super(props);

    let claimWsEndpoint: string;
    if(this.props.pageContext.faucetUrls.wsBaseUrl) 
      claimWsEndpoint = this.props.pageContext.faucetUrls.wsBaseUrl + "/claim";
    else
      claimWsEndpoint = "/ws/claim";
    if(claimWsEndpoint.match(/^\//))
      claimWsEndpoint = location.origin.replace(/^http/, "ws") + claimWsEndpoint;
    this.notificationClient = new ClaimNotificationClient({
      claimWsUrl: claimWsEndpoint,
      sessionId: this.props.sessionId,
    });
    this.notificationClient.on("update", (message) => {
      this.setState({
        claimNotification: message.data,
      });
    });
    this.notificationClient.on("open", () => {
      this.setState({
        claimNotificationConnected: true,
      });
    });
    this.notificationClient.on("close", () => {
      this.setState({
        claimNotificationConnected: false,
      });
    });

    this.state = {
      sessionStatus: null,
      sessionDetails: null,
      loadingStatus: false,
      loadingError: false,
      isTimedOut: false,
      claimProcessing: false,
      refreshIndex: 0,
      claimNotification: null,
      claimNotificationConnected: false,
			addressCopied: false,
      lastSuccessfulClaim: 0,
		};
  }

  public componentDidMount() {
    this.refreshSessionStatus();
  }

  public componentWillUnmount() {
    clearTimeout(this.copyResetTimer);
    if(this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    if(this.notificationClientActive) {
      this.notificationClientActive = false;
      this.notificationClient.stop();
    }
  }

  private async refreshSessionStatus() {
    if(this.loadingStatus)
      return;
    
    this.loadingStatus = true;
    this.setState({
      loadingStatus: true,
    });

    try {
      let sessionStatus = await this.props.pageContext.faucetApi.getSessionStatus(this.props.sessionId, !this.state.sessionDetails);
      if(sessionStatus.details) {
        this.setState({
          sessionDetails: sessionStatus.details,
        })
      }
      this.setState({
        loadingStatus: false,
        sessionStatus: sessionStatus,
        lastSuccessfulClaim: this.cacheSuccessfulClaim(sessionStatus),
      }, () => {
        this.setUpdateTimer();
      });
    }
    catch(err) {
      this.setState({
        loadingStatus: false,
        loadingError: err.error?.toString() || err.toString() || true,
      });
    }
    this.loadingStatus = false;
  }

  private cacheSuccessfulClaim(status: IFaucetSessionStatus): number {
    let key = 'qms:successful-claims:' + this.props.pageContext.faucetUrls.apiUrl + ':' + (this.props.faucetConfig.chainId || '') + ':' + status.target.toLowerCase();
    try {
      let claims: { [session: string]: number } = JSON.parse(localStorage.getItem(key) || '{}');
      if(status.status === 'finished' && !claims[status.session]) {
        claims[status.session] = this.props.pageContext.faucetApi.getFaucetTime().getSyncedTime();
        localStorage.setItem(key, JSON.stringify(claims));
      }
      return Math.max(0, ...Object.values(claims).filter((time) => typeof time === 'number' && Number.isFinite(time)));
    }
    catch(error) {
      return status.status === 'finished' ? this.state.lastSuccessfulClaim || this.props.pageContext.faucetApi.getFaucetTime().getSyncedTime() : 0;
    }
  }

  private setUpdateTimer() {
    if(this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    let exactNow = (new Date()).getTime();

    let timeLeft = (1000 - (exactNow % 1000)) + 2;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.setState({
        refreshIndex: this.state.refreshIndex + 1,
      });
      this.setUpdateTimer();
    }, timeLeft);
  }

	public render(): React.ReactElement<IClaimPageProps> {
    let exactNow = (new Date()).getTime();
    let now = this.props.pageContext.faucetApi.getFaucetTime().getSyncedTime();

    if(this.state.sessionStatus) {
      let claimTimeout = (this.state.sessionStatus.start + this.props.faucetConfig.sessionTimeout) - now;
      if(claimTimeout < 0 && this.state.sessionStatus.status === "claimable" && !this.isTimedOut) {
        this.isTimedOut = true;
        this.setState({
          isTimedOut: true
        });
        
        this.props.pageContext.showDialog({
          title: "Claim expired",
          body: (
            <div className='alert alert-danger'>
              Sorry, your reward ({toReadableAmount(BigInt(this.state.sessionStatus.balance), this.props.faucetConfig.faucetCoinDecimals, this.props.faucetConfig.faucetCoinSymbol)}) has not been claimed in time.
            </div>
          ),
          closeButton: {
            caption: "Close"
          },
          closeFn: () => {
            this.refreshSessionStatus();
          }
        });
      }

      if(this.state.sessionStatus.status === "claiming") {
        if(!this.notificationClientActive) {
          this.notificationClientActive = true;
          this.notificationClient.start();
        }

        if(exactNow - this.lastStatusPoll > 30 * 1000 || this.state.sessionStatus.claimIdx <= (this.state.claimNotification?.confirmedIdx || 0)) {
          this.lastStatusPoll = exactNow;
          this.refreshSessionStatus();
        }
      }
      else {
        if(this.notificationClientActive) {
          this.notificationClientActive = false;
          this.notificationClient.stop();
        }
      }
    }

    return (
      <QmsLayout faucetConfig={this.props.faucetConfig}>
        <div className='qms-card qms-claim'>
          <SlotOutlet slot="claim.before" faucetConfig={this.props.faucetConfig}
            sessionId={this.props.sessionId} navigate={(path) => this.props.navigateFn(path)} />
          {this.renderClaim()}
          <SlotOutlet slot="claim.after" faucetConfig={this.props.faucetConfig}
            sessionId={this.props.sessionId} navigate={(path) => this.props.navigateFn(path)} />
        </div>
      </QmsLayout>
    )
	}

  private renderClaim(): React.ReactElement {
    if(this.state.loadingError) {
      return (
        <div className='alert alert-danger'>
          No claimable reward found: {typeof this.state.loadingError == "string" ? this.state.loadingError : ""}
        </div>
      );
    }
    else if(!this.state.sessionStatus) {
      return (
        <div className="qms-claim__content" role="status" aria-label="Loading review" aria-busy="true">
          <div className="qms-card__top" aria-hidden="true">
            <span className="qms-review-skeleton qms-review-skeleton--label" />
            <span>STEP 2 OF 3</span>
          </div>
          <div className="qms-card__amount" aria-hidden="true">
            <p>YOU’RE CLAIMING</p>
            <span className="qms-review-skeleton qms-review-skeleton--amount" />
            <span>Testnet {this.props.faucetConfig.faucetCoinSymbol}</span>
          </div>
          <div className="qms-card__details" aria-hidden="true">
            {['Wallet', 'Network', 'Next request available'].map(label => <div key={label}><span>{label}</span><span className="qms-review-skeleton qms-review-skeleton--value" /></div>)}
          </div>
          <div className="qms-review-skeleton qms-review-skeleton--button" aria-hidden="true" />
        </div>
      );
    }
    else if(this.state.isTimedOut) {
      return (
        <div className='alert alert-danger'>
          Sorry, your reward ({toReadableAmount(BigInt(this.state.sessionStatus.balance), this.props.faucetConfig.faucetCoinDecimals, this.props.faucetConfig.faucetCoinSymbol)}) has not been claimed in time.
        </div>
      );
    }
    
    let status = this.state.sessionStatus;
    let finished = status.status === 'finished';
    let submitted = finished || status.status === 'claiming';
    let sending = !!status.claimHash || (status.claimIdx > 0 && status.claimIdx <= (this.state.claimNotification?.processedIdx || 0));
    let claimStep = finished ? 2 : sending ? 1 : 0;
    let claimSteps = ['QUEUED', 'SENDING', 'SENT'];
    let amount = toReadableAmount(BigInt(status.balance), this.props.faucetConfig.faucetCoinDecimals);
    let images = this.props.pageContext.faucetUrls.imagesUrl || '/images';
    let explorerTemplate = this.props.faucetConfig.network ? this.props.faucetConfig.network.explorerUrl + '/tx/{txid}' : this.props.faucetConfig.ethTxExplorerLink;
    let explorer = status.claimHash && explorerTemplate?.replace('{txid}', status.claimHash);
    let shorten = (value: string) => value ? value.slice(0, 8) + '…' + value.slice(-6) : '—';
    let nextRequestDate = finished && this.state.lastSuccessfulClaim > 0
      ? new Date((this.state.lastSuccessfulClaim + LOCAL_CLAIM_INTERVAL_SECONDS) * 1000)
      : new Date(Date.now() + LOCAL_CLAIM_INTERVAL_SECONDS * 1000);
    let remaining = Math.max(0, Math.floor((nextRequestDate.getTime() - Date.now()) / 1000));
    return (
      <div className="qms-claim__content">
        <div className="qms-card__top">
          {submitted ? <span className={finished ? 'qms-card__sent' : 'qms-card__pending'}>{finished ? <img src={images + '/qms-dot.svg'} alt="" width="6" height="6" /> : null}{claimSteps[claimStep]}</span> :
            <button className="qms-card__back" onClick={() => this.props.navigateFn('/')}><img src={images + '/qms-chevron.svg'} alt="" width="12" height="12" />CHANGE ADDRESS</button>}
          <span>STEP {submitted ? '3' : '2'} OF 3</span>
        </div>
        {submitted ? <div className="qms-card__result">
          {finished ? <div className="qms-card__success"><img src={images + '/qms-check.svg'} alt="" width="24" height="24" /></div> : null}
          <h2>{amount} Testnet {this.props.faucetConfig.faucetCoinSymbol} {finished ? 'sent' : sending ? 'sending' : 'queued'}</h2>
          <p>{finished ? 'The tokens are now in your wallet.' : sending ? 'Your transaction is awaiting confirmation.' : 'Your request is waiting to be sent.'}</p>
        </div> : <div className="qms-card__amount"><p>YOU’RE CLAIMING</p><strong>{amount}</strong><span>Testnet {this.props.faucetConfig.faucetCoinSymbol}</span></div>}
        {submitted ? <div className="qms-card__progress" aria-label={'Transaction ' + claimSteps[claimStep].toLowerCase()} aria-live="polite">
          {claimSteps.map((step, index) => <div key={step} className={finished || index < claimStep ? 'is-complete' : index === claimStep ? 'is-active' : 'is-pending'} aria-current={!finished && index === claimStep ? 'step' : undefined}>
            <span>{finished || index < claimStep ? <img src={images + '/qms-check-small.svg'} alt="Completed" width="12" height="12" /> : index === claimStep ?
              <LoadingIcon /> : null}</span><p>{step}</p>
          </div>)}
        </div> : null}
        <div className="qms-card__details">
          {submitted ? <div><span>Amount</span><span>{amount} Testnet {this.props.faucetConfig.faucetCoinSymbol}</span></div> : null}
          <div><span>Wallet</span><span className="qms-card__wallet"><span title={status.target}>{shorten(status.target)}</span><button aria-label={this.state.addressCopied ? 'Wallet address copied' : 'Copy wallet address'} onClick={() => this.copyAddress()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {this.state.addressCopied ? <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="m16 9-5.5 5.5L8 12" /></> : <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>}
            </svg>
          </button></span></div>
          {finished ? <div><span>Transaction</span>{explorer ? <a href={explorer} target="_blank" rel="noopener noreferrer" title={status.claimHash}>{shorten(status.claimHash)}<img src={images + '/qms-external.svg'} alt="" width="12" height="12" /></a> : <span title={status.claimHash}>{shorten(status.claimHash)}</span>}</div> : <div className="qms-card__text-row"><span>Network</span><span>{this.props.faucetConfig.network?.chainName || 'Testnet'}{this.props.faucetConfig.chainId ? <span className="qms-card__muted"> · {this.props.faucetConfig.chainId}</span> : null}</span></div>}
          <div className="qms-card__text-row"><span>Next request available</span><span>{remaining > 0 ? <>{nextRequestDate.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} <span className="qms-card__muted">· in {Math.ceil(remaining / 3600)}h</span></> : 'Now'}</span></div>
        </div>
        {status.status === 'claimable' ? this.renderClaimForm() : null}
        {status.status === 'failed' ? this.renderSessionFailed() : null}
        {finished ? <div className="qms-card__actions">
          {explorer ? <a className="qms-card__primary" href={explorer} target="_blank" rel="noopener noreferrer">View on explorer</a> : null}
          <button className="qms-card__secondary" onClick={() => this.props.navigateFn('/')}>Back to faucet</button>
        </div> : null}
        {finished && Object.values(this.props.faucetConfig.resultSharing || {}).some(Boolean) ? this.renderResultSharing() : null}
      </div>
    );
  }

  private async copyAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.state.sessionStatus.target);
      clearTimeout(this.copyResetTimer);
      this.setState({ addressCopied: true });
      this.copyResetTimer = setTimeout(() => this.setState({ addressCopied: false }), 2000);
    } catch {
      this.setState({ addressCopied: false });
    }
  }

  private renderClaimForm(): React.ReactElement {
    return (
      <ClaimInput 
        faucetConfig={this.props.faucetConfig}
        caption={'Send ' + toReadableAmount(BigInt(this.state.sessionStatus.balance), this.props.faucetConfig.faucetCoinDecimals) + ' Testnet ' + this.props.faucetConfig.faucetCoinSymbol}
        submitInputs={(claimData) => this.submitClaim(claimData)}
      />
    );
  }

  private renderSessionFailed(): React.ReactElement {
    return (
      <div className='claim-status'>
        <div className='alert alert-danger'>
          Claim failed: {this.state.sessionStatus.failedReason || this.state.sessionStatus.claimMessage} {this.state.sessionStatus.failedCode ? " [" + this.state.sessionStatus.failedCode + "]" : ""}
        </div>
      </div>
    )
  }

  private renderResultSharing(): React.ReactElement {
    let shareEls: React.ReactElement[] = [];

    if(this.props.faucetConfig.resultSharing?.twitter) {
      let tweetMsg = this.replaceShareMessagePlaceholders(this.props.faucetConfig.resultSharing.twitter);
      let tweetUrl = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(tweetMsg);
      shareEls.push(
        <span key='tw' className='sh-link sh-tw'>
          <a href='#' target='_blank' data-url={tweetUrl} rel='noopener noreferrer' onClick={function(evt) {
            let a = document.createElement('a');
            a.target = '_blank';
            a.href = tweetUrl;
            a.click();

            evt.preventDefault();
          }}><i /><span>Tweet</span></a>
        </span>
      );
    }
    if(this.props.faucetConfig.resultSharing?.mastodon) {
      let tweetMsg = this.replaceShareMessagePlaceholders(this.props.faucetConfig.resultSharing.mastodon);

      let tweetUrl = "/share?text=" + encodeURIComponent(tweetMsg);
      shareEls.push(
        <span  key='md' className='sh-link sh-md'>
          <a href={'https://mastodon.social' + tweetUrl} target='_blank' data-url={tweetUrl} rel='noopener noreferrer' onClick={function(evt) {

            var mastodonUrl = evt.currentTarget.getAttribute("data-instance");
            if(!mastodonUrl)
              mastodonUrl = prompt("Please enter the URL of the mastodon instance you'd like to share to:", "https://mastodon.social");
            if(mastodonUrl) {
              evt.currentTarget.setAttribute("href", mastodonUrl.replace(/\/$/, "") + tweetUrl);
              evt.currentTarget.setAttribute("data-instance", mastodonUrl);
            }
            else
              evt.preventDefault();
          }}><i /><span>Post</span></a>
        </span>
      );
    }

    let resultSharingCaption = this.props.faucetConfig.resultSharing.caption || "Support this faucet with a ";
    return (
      <div className='result-sharing'>
        {this.props.faucetConfig.resultSharing.preHtml && !this.props.faucetConfig.resultSharing.preHtml.includes("ghbtns.com/github-btn.html") ?
          <ResultSharingHtml key="pre-html" html={this.replaceShareMessagePlaceholders(this.props.faucetConfig.resultSharing.preHtml)} />
        : null}
        {shareEls.length > 0 ?
          <div className='sh-opt'>
            <span className='sh-label'>{resultSharingCaption}</span>
            {shareEls}
          </div>
        : null}
        {this.props.faucetConfig.resultSharing.postHtml ?
          <ResultSharingHtml key="post-html" html={this.replaceShareMessagePlaceholders(this.props.faucetConfig.resultSharing.postHtml)} />
        : null}
      </div>
    )
  }

  private replaceShareMessagePlaceholders(message: string): string {
    message = message.replace(/{sessionid}/ig, this.state.sessionStatus.session);
    message = message.replace(/{target}/ig, this.state.sessionStatus.target);
    message = message.replace(/{token}/ig, this.props.faucetConfig.faucetCoinSymbol);

    message = message.replace(/{amount}/ig, toReadableAmount(BigInt(this.state.sessionStatus.balance), this.props.faucetConfig.faucetCoinDecimals));
    let safeUrl = location.protocol + "//" + location.hostname + location.pathname;
    message = message.replace(/{url}/ig, safeUrl);

    let claimableTime = this.state.sessionDetails.data['close.time'] || this.props.pageContext.faucetApi.getFaucetTime().getSyncedTime();
    let duration = claimableTime - this.state.sessionStatus.start;
    message = message.replace(/{duration}/ig, renderTimespan(duration));

    message = message.replace(/{hashrate}/ig, () => {
      let hashrate = duration > 0 ? (this.state.sessionDetails.data['pow.lastNonce'] || 0) / duration : 0;
      return (Math.round(hashrate * 100) / 100).toString()
    });

    return message;
  }

  private async submitClaim(claimData: any): Promise<void> {
    try {
      claimData = Object.assign({
        session: this.props.sessionId
      }, claimData ||{});

      // a module may refuse the claim here with a reason, before the request leaves the page
      await emitHook("session.claim", { sessionId: this.props.sessionId, input: claimData });
      let sessionStatus = await this.props.pageContext.faucetApi.claimReward(claimData);
      if(sessionStatus.status === "failed")
        throw sessionStatus;
      emitHookSafe("session.claimed", { sessionId: this.props.sessionId, status: sessionStatus });
      
      this.lastStatusPoll = new Date().getTime();
      this.setState({
        sessionStatus: sessionStatus,
      });
      FaucetSession.persistSessionInfo(null);
    } catch(ex) {
      let errMsg: string;
      if(ex && ex.failedCode)
        errMsg = "[" + ex.failedCode + "] " + ex.failedReason;
      else
        errMsg = ex.toString();
      this.props.pageContext.showDialog({
        title: "Claim failed",
        body: (
          <div className='alert alert-danger'>
            Could not claim rewards: {errMsg}
          </div>
        ),
        closeButton: {
          caption: "Close"
        }
      });
      throw errMsg;
    }
  }

}

export default (props) => {
  let params = useParams();
  return (
    <ClaimPage 
      key={params.session}
      {...props}
      pageContext={useContext(FaucetPageContext)}
      faucetConfig={useContext(FaucetConfigContext)}
      navigateFn={useNavigate()}
      sessionId={params.session}
    />
  );
};
