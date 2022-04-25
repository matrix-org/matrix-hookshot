import { h, FunctionComponent } from "preact";
import style from "./InputField.module.scss";

interface Props {
    visible?: boolean;
    label?: string;
    noPadding: boolean;
}

const InputField: FunctionComponent<Props> = ({ children, visible = true, label, noPadding }) => {
    return visible && <div className={style.inputField}>
        {label && <label className={noPadding ? style.nopad : ""}>{label}</label>}
        {children}
    </div>;
};

export default InputField;