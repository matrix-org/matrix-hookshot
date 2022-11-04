import { h, FunctionComponent } from "preact";
import ErrorBadge from "../../icons/error-badge.svg";
import WarningBadge from "../../icons/warning-badge.svg";
import style from "./ErrorPane.module.scss";

export const ErrorPane: FunctionComponent<{header?: string, isWarning?: boolean}> = ({ children, header, isWarning }) => {
    return <div class={`card error ${isWarning ? style.warningPane : style.errorPane}`}>
        <p><strong><img src={isWarning ? WarningBadge : ErrorBadge } /> { header || `${isWarning ? "Problem" : "Error"} occured during widget load` }</strong>: {children}</p>
    </div>;
};