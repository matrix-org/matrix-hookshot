import { FunctionComponent } from "preact";
import ErrorBadge from "../../icons/error-badge.svg";
import style from "./ErrorPane.module.scss";

export const ErrorPane: FunctionComponent<{header?: string}> = ({ children, header }) => {
    return <div class={`card error ${style.errorPane}`}>
        <p><strong><img alt="error" src={ErrorBadge} /> { header || "Error occurred during widget load" }</strong>: {children}</p>
    </div>;
};