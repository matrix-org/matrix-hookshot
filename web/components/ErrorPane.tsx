import { h, FunctionComponent } from "preact";
import "./ErrorPane.css";

const ErrorPane: FunctionComponent<{header?: string}> = ({ children, header }) => {
    return <div class="card error error-pane">
        <h3>{ header || "Error occured during widget load" }</h3>
        <p>{children}</p>
    </div>;
};

export default ErrorPane;