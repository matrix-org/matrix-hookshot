import { h, FunctionComponent } from "preact"
import { useState } from "preact/hooks"
import style from "./ListItem.module.scss";

export const ListItem: FunctionComponent<{text: string}> = ({ text, children }) => {
    const [expand, setExpand] = useState(false);
    
    return <div className={style.root}>
        <div className={style.header} onClick={() => setExpand(!expand)}>
            <span>{text}</span><span className={`chevron ${expand ? "up" : "down"}`} />
        </div>
        <div className={style.contents}>
            {expand && children}
        </div>
    </div>
}