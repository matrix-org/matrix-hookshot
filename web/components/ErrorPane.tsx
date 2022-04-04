import { h, FunctionComponent } from "preact";
import "./ErrorPane.css";

const ErrorPane: FunctionComponent<unknown> = ({ children }) => {
    return <div class="card error error-pane">
        <h3>Error occured during widget load</h3>
        <p>{children}</p>
    </div>;
};

export default ErrorPane;