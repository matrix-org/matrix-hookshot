import { FunctionComponent } from 'preact';
import { BridgeRoomStateGitHub } from '../../src/Widgets/BridgeWidgetInterface';
import "./GitHubState.css";

const GitHubState: FunctionComponent<{config: BridgeRoomStateGitHub}> = ({ config }) => {
    return <div className="container login-card">
        <div className="row">
            <div className="col-sm-2">
                <img alt="GitHub avatar" src={config.identity.avatarUrl} />
            </div>
            <div className="col-sm-9">
                Logged in as <span>{config.identity.name}</span>
                <p>Notifications { config.notifications ? 'Enabled' : 'Disabled' }</p>
            </div>
        </div>
  </div>
}

export default GitHubState;