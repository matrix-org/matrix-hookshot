import { FunctionComponent } from "preact";
import styles from "./InputField.module.scss";
import clsx from 'clsx';
interface Props {
    className?: string;
    visible?: boolean;
    label: string;
    noPadding: boolean;
}

export const InputField: FunctionComponent<Props> = ({ className, children, visible = true, label, noPadding }) => {
    if (!visible) {
        return null;
    }

    return <div className={clsx(className, styles.inputField, noPadding && styles.nopad)}>
        <label>{label}</label>
        <div className={styles.container}>
            {children}
        </div>
    </div>;
};