import { h } from "preact";
import style from "./ButtonSet.module.scss";
import { Button } from "./Button";

interface Props {
    save?: {
        text: string;
        onClick: () => void;
    },
    remove?: {
        text: string;
        onClick: () => void;
    }
}

export function ButtonSet(props: Props) {
    <div className={style.buttonSet}>
        { props.save && <Button onClick={props.save.onClick}>{ props.save.text }</Button>}
        { props.remove && <Button intent="remove" onClick={props.remove.onClick}>{ props.remove.text }</Button>}
    </div>
}

export default ButtonSet;