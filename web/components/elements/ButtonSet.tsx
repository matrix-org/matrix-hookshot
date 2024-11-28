import { FunctionComponent } from "preact";
import style from "./ButtonSet.module.scss";

export const ButtonSet: FunctionComponent = (props) => {
    return <div className={style.buttonSet}>
        {props.children}
    </div>;
}