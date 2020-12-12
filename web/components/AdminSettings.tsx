import { h, Component } from 'preact';
import { BridgeRoomState } from "../../src/Widgets/BridgeWidgetInterface";
import "./AdminSettings.css";
import LoginCard from './LoginCard';

interface IProps{
    roomState: BridgeRoomState;
}

export default class AdminSettings extends Component<IProps> {
    constructor(props) {
        super(props)
    }

    renderGitHub() {
        const githubConfig = this.props.roomState.github;
        if (!githubConfig.enabled) {
            return <strong>
                GitHub support is not enabled in the bridge
            </strong>
        }
        if (!githubConfig.tokenStored) {
            return <strong>
                You have not logged into GitHub
            </strong>
        }
        if (!githubConfig.identity) {
            return <strong>
                Your token does not appear to work
            </strong>;
        }
        return <LoginCard name={githubConfig.identity.name} avatarUrl={githubConfig.identity.avatarUrl}/>;
    }

    render() {
        return <div class="adminsettings">
            <h1>{this.props.roomState.title}</h1>
            <h2>GitHub</h2>
            {this.renderGitHub()}
            <h2>GitLab</h2>
        </div>;
    }
}