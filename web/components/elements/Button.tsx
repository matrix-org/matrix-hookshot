import { FunctionComponent, h } from "preact";
import style from "./Button.module.scss";

interface ButtonProps extends h.JSX.HTMLAttributes<HTMLButtonElement> {
    intent?: "remove";
}

export const Button: FunctionComponent<ButtonProps> = (props) => {
    let className = style.button;
    if (props.intent === "remove") {
        className += ` ${style.remove}`;
    }
    return <button type="button" className={className} {...props} />;
} 