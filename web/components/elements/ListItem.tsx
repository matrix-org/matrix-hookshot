import { ComponentChild, FunctionComponent } from "preact"
import { useState } from "preact/hooks"
import style from "./ListItem.module.scss";
import { ChevronDownIcon, ChevronUpIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

export const ListItem: FunctionComponent<{text: ComponentChild}> = ({ text, children }) => {
    const [expand, setExpand] = useState(false);
    
    return <div className={style.root}>
        <h3 className={style.header} onClick={() => setExpand(!expand)}>
            {text} {expand ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </h3>
        <div className={style.contents}>
            {expand && children}
        </div>
    </div>
}