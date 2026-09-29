import { IFaucetConfig, hasPlayableTask } from '../../common/FaucetConfig';
import { FaucetConfigContext, FaucetPageContext } from '../FaucetPage';
import React, { useContext } from 'react';
import { useNavigate, NavigateFunction } from "react-router";
import { FaucetInput } from './FaucetInput';
import { IFaucetContext } from '../../common/FaucetContext';
import { FaucetSession } from '../../common/FaucetSession';
import { SlotOutlet } from '../../sdk/SlotOutlet';
import { emitHook, emitHookSafe } from '../../sdk/hooks';
import { PassportInfo } from '../passport/PassportInfo';
import './FrontPage.scss';
import { QmsLayout } from '../shared/QmsLayout';

export interface IFrontPageProps {
  faucetContext: IFaucetContext;
  faucetConfig: IFaucetConfig;
  navigateFn: NavigateFunction;
}

export class FrontPage extends React.PureComponent<IFrontPageProps> {
  private faucetInput = React.createRef<FaucetInput>();
  private pendingClaimSessionId: string | undefined;

	public render(): React.ReactElement<IFrontPageProps> {
    return (
      <QmsLayout faucetConfig={this.props.faucetConfig}>
          <div className="page-frontpage qms-card qms-frontpage">
        <SlotOutlet slot="front.info" faucetConfig={this.props.faucetConfig} navigate={(path) => this.props.navigateFn(path)} />
        <FaucetInput 
          ref={this.faucetInput} 
          faucetContext={this.props.faucetContext} 
          faucetConfig={this.props.faucetConfig} 
          submitInputs={(inputData, claimData) => this.onSubmitInputs(inputData, claimData)}/>
          </div>
        <SlotOutlet slot="front.after" faucetConfig={this.props.faucetConfig} navigate={(path) => this.props.navigateFn(path)} />
      </QmsLayout>
    );
	}

  private async onSubmitInputs(inputData: any, claimData?: any): Promise<void> {
    try {
      if(!this.props.faucetConfig.modules.pow && !inputData.module) {
        let activeSession = this.props.faucetContext.activeSession;
        let recoveryInfo = activeSession ? {
          id: activeSession.getSessionId(),
          addr: activeSession.getTargetAddr(),
        } : FaucetSession.recoverSessionInfo();
        if(recoveryInfo?.addr && recoveryInfo.addr.toLowerCase() === inputData.addr?.toLowerCase()) {
          let sessionStatus = await this.props.faucetContext.faucetApi.getSessionStatus(recoveryInfo.id);
          let pendingClaim = this.pendingClaimSessionId === sessionStatus.session || FaucetSession.recoverSessionInfo()?.id === sessionStatus.session;
          if(sessionStatus.target.toLowerCase() === inputData.addr.toLowerCase() &&
            (sessionStatus.status === "claiming" || (sessionStatus.status === "finished" && pendingClaim))) {
            this.props.faucetContext.activeSession = new FaucetSession(this.props.faucetContext, sessionStatus.session, sessionStatus);
            this.pendingClaimSessionId = undefined;
            FaucetSession.persistSessionInfo(null);
            this.props.navigateFn("/claim/" + sessionStatus.session);
            return;
          }
          if(sessionStatus.status === "claimable" && sessionStatus.target.toLowerCase() === inputData.addr.toLowerCase()) {
            this.props.faucetContext.activeSession = new FaucetSession(this.props.faucetContext, sessionStatus.session, sessionStatus);
            await this.submitReviewedClaim(sessionStatus.session, claimData);
            this.props.navigateFn("/claim/" + sessionStatus.session);
            return;
          }
        }
      }
      // a module may add to `inputData.params` here, or throw to refuse the start with a reason
      await emitHook("session.start", { input: inputData });
      let sessionInfo = await this.props.faucetContext.faucetApi.startSession(inputData);
      if(sessionInfo.status !== "failed")
        emitHookSafe("session.started", { session: sessionInfo });
      if(sessionInfo.status === "failed") {
        let canStartWithScore = false;
        let requiredScore = 0;
        let ipflags: string[] = [];

        if(sessionInfo.failedCode == "IPINFO_RESTRICTION" && this.props.faucetConfig.modules["passport"] && this.props.faucetConfig.modules["passport"].guestRefresh !== false && sessionInfo.failedData && sessionInfo.failedData["ipflags"]) {
          canStartWithScore = true;
          if(sessionInfo.failedData["ipflags"][0] && this.props.faucetConfig.modules["passport"].overrideScores[0] > 0) {
            canStartWithScore = true;
            ipflags.push("hosting");
            if(this.props.faucetConfig.modules["passport"].overrideScores[0] > requiredScore)
              requiredScore = this.props.faucetConfig.modules["passport"].overrideScores[0];
          }
          if(sessionInfo.failedData["ipflags"][1] && this.props.faucetConfig.modules["passport"].overrideScores[1] > 0) {
            canStartWithScore = true;
            ipflags.push("proxy");
            if(this.props.faucetConfig.modules["passport"].overrideScores[1] > requiredScore)
              requiredScore = this.props.faucetConfig.modules["passport"].overrideScores[1];
          }
        }
        else if(sessionInfo.failedCode == "PASSPORT_SCORE" && this.props.faucetConfig.modules["passport"] && this.props.faucetConfig.modules["passport"].guestRefresh !== false) {
          requiredScore = this.props.faucetConfig.modules["passport"].overrideScores[2];
          canStartWithScore = true;
        }

        if(canStartWithScore) {
          // special case, the session is denied as the users IP is flagged as hosting/proxy range.
          // however, the faucet allows skipping this check for passport trusted wallets
          // show a dialog that shows the score & allows refreshing the passport to meet the requirement

          let errMsg: string;
          if(ipflags.length > 0) {
            errMsg = "The faucet denied starting a session because your IP Address is marked as " + ipflags.join(" and ") + " range.";
          } else {
            errMsg = "The faucet denied starting a session because your wallet does not meet the minimum passport score.";
          }

          this.props.faucetContext.showDialog({
            title: "Could not start session",
            size: "lg",
            body: (
              <div className='passport-dialog error-dialog'>
                <PassportInfo 
                  pageContext={this.props.faucetContext}
                  faucetConfig={this.props.faucetConfig}
                  targetAddr={sessionInfo.failedData["address"]}
                  refreshFn={(passportScore) => {
                    
                  }}
                >
                  <div>
                    <div className='alert alert-danger'>{errMsg}</div>
                    <div className="boost-descr">
                      You can verify your unique identity and increase your score using <a href="https://passport.gitcoin.co/#/dashboard" target="_blank">Gitcoin Passport</a>.
                    </div>
                    <div className="boost-descr2">
                      Ensure your provided address achieves a minimum score of {requiredScore} to initiate a session.
                    </div>
                  </div>
                </PassportInfo>
              </div>
            ),
            closeButton: { caption: "Close" },
          });

          throw null; // throw without dialog
        }

        throw (sessionInfo.failedCode ? "[" + sessionInfo.failedCode + "] " : "") + sessionInfo.failedReason;
      }

      let session = new FaucetSession(this.props.faucetContext, sessionInfo.session, sessionInfo);
      this.props.faucetContext.activeSession = session;

      switch(sessionInfo.status) {
        case "claimable":
          FaucetSession.persistSessionInfo(session);
          await this.submitReviewedClaim(sessionInfo.session, claimData);
          // redirect to claim page
          console.log("redirect to claim page!", session);
          this.props.navigateFn("/claim/" + sessionInfo.session);
          return;
        case "running":
          // a session without mining has its module's task and no "pow" one
          if(hasPlayableTask(sessionInfo.tasks)) {
            // redirect to mining page
            console.log("redirect to mining page!", session);
            this.props.navigateFn("/mine/" + sessionInfo.session);
            return;
          }
          else {
            // session is running, but has an unknown or no task...
            throw "unexpected session task";
          }
        default:
          throw "unexpected session state";
      }
    } catch(ex) {
      if(ex) {
        this.props.faucetContext.showDialog({
          title: "Could not start session",
          body: (<div className='alert alert-danger'>{ex.toString()}</div>),
          closeButton: { caption: "Close" },
        });
      }
      throw ex;
    }
  }

  private async submitReviewedClaim(sessionId: string, claimData?: any): Promise<void> {
    if(claimData === undefined)
      return;
    let input = Object.assign({ session: sessionId }, claimData);
    await emitHook("session.claim", { sessionId, input });
    this.pendingClaimSessionId = sessionId;
    let status = await this.props.faucetContext.faucetApi.claimReward(input);
    if(status.status === "failed")
      throw (status.failedCode ? "[" + status.failedCode + "] " : "") + status.failedReason;
    this.pendingClaimSessionId = undefined;
    emitHookSafe("session.claimed", { sessionId, status });
    FaucetSession.persistSessionInfo(null);
  }

}

export default (props) => {
  return (
    <FrontPage 
      {...props}
      faucetContext={useContext(FaucetPageContext)}
      faucetConfig={useContext(FaucetConfigContext)}
      navigateFn={useNavigate()}
    />
  );
};
