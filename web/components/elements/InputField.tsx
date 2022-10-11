import { h, FunctionComponent } from "preact";
import style from "./InputField.module.scss";

interface Props {
    className?: string;
    visible?: boolean;
    label?: string;
    noPadding: boolean;
    innerChild?: boolean;
}

export const InputField: FunctionComponent<Props> = ({ className, children, visible = true, label, noPadding, innerChild = false }) => {
    const inputClassName = [
        className,
        style.inputField,
        noPadding && style.nopad
    ].filter(a => !!a).join(' ');
    return visible ? <div className={inputClassName}>
        {label && <label>{innerChild && children}{label}</label>}
        {(!label || !innerChild) && children}
    </div> : <></>
};