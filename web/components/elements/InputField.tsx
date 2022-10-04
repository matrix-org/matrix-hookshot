import { h, FunctionComponent } from "preact";
import style from "./InputField.module.scss";

interface Props {
    visible?: boolean;
    label?: string;
    noPadding: boolean;
    innerChild?: boolean;
}

export const InputField: FunctionComponent<Props> = ({ children, visible = true, label, noPadding, innerChild = false }) => {
    return visible ? <div className={style.inputField}>
        {label && <label className={noPadding ? style.nopad : ""}>{innerChild && children}{label}</label>}
        {(!label || !innerChild) && children}
    </div> : <></>
};