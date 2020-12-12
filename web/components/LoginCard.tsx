import { h, FunctionComponent } from 'preact';
import "./LoginCard.css";

const LoginCard: FunctionComponent<{name: string; avatarUrl: string;}> = ({ name, avatarUrl }) => {
    return <div class="container login-card">
        <div class="row">
            <div class="col-sm-2">
                <img src={avatarUrl} title="GitHub avatar"/>
            </div>
            <div class="col-sm-9">
                Logged in as <span>{name}</span>
            </div>
        </div>
  </div>
}

export default LoginCard;