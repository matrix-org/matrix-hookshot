import { h, FunctionComponent } from "preact";
import ErrorBadge from "../../icons/warning-badge.svg";
import style from "./ErrorPane.module.scss";

export const ErrorPane: FunctionComponent<{header?: string}> = ({ children, header }) => {
    return <div class={`card error ${style.errorPane}`}>
        <p><strong><img src={ErrorBadge} /> { header || "Error occured during widget load" }</strong>: {children}</p>
    </div>;
};