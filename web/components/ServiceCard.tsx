import { FunctionComponent } from "preact";
import style from "./ServiceCard.module.scss";


export const ServiceCard: FunctionComponent<{serviceName: string, iconUrl: string, onConfigure: () => void}> = ({ serviceName, iconUrl, onConfigure }) => {
    return <div className={`card ${style.serviceCard}`}>
        <img className={style.invert} src={iconUrl} />
        <div>
            <span>{serviceName}</span>
            <button onClick={onConfigure}>Configure</button>
        </div>
    </div>;
};