import { FunctionComponent, h } from "preact";
import style from "./ButtonSet.module.scss";

const ButtonSet: FunctionComponent = (props) => {
    return <div className={style.buttonSet}>
        {props.children}
    </div>;
}
export default ButtonSet;