import { h } from "preact";
import style from "./Button.module.scss";

export function Button(props: { [key: string]: unknown, intent?: string}) {
    let className = style.button;
    if (props.intent === "remove") {
        className += ` ${  style.remove}`;
    }
    return <button type="button" className={className} {...props} />;
} 