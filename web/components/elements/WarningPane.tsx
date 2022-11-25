import { h, FunctionComponent } from "preact";
import WarningBadge from "../../icons/warning-badge.svg";
import style from "./WarningPane.module.scss";

export const WarningPane: FunctionComponent<{header?: string}> = ({ children, header }) => {
    return <div class={`card error ${style.warningPane}`}>
        <p><strong><img src={WarningBadge} /> { header || "Problem occurred during widget load" }</strong>: {children}</p>
    </div>;
};