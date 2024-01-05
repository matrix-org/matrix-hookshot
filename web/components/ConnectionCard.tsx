import style from "./ConnectionCard.module.scss";

interface IProps {
    imageSrc: string;
    darkImage?: boolean;
    serviceName: string;
    description: string;
    key: string;
    onClick: () => void;
}

export function ConnectionCard(props: IProps) {
    return <div className={style.card} onClick={props.onClick}>
        <img alt="" src={props.imageSrc} className={props.darkImage ? style.invert : ''} />
        <div>
            <span>{props.serviceName}</span>
            <p>{props.description}</p>
        </div>
    </div>;
} 