import { WidgetApi } from "matrix-widget-api";
import { h } from "preact";
import { useCallback, useState } from "preact/hooks"
import { UserSearchResults } from "../../src/Widgets/BridgeWidgetInterface";
import BridgeAPI from "../BridgeAPI";
import style from "./InviteView.module.scss";


interface IProps {
    widgetApi: WidgetApi,
    bridgeApi: BridgeAPI,
}

const SERVICE_TO_NAME = {
    github: "GitHub",
}

const DEBOUNCE_FOR_MS = 500;

function InviteViewItem(props: {onUserSelect: (data: {displayName, userId, avatarMxc}) => void, userId: string, service: string, displayName?: string, avatarMxc?: string, rawAvatarUrl?: string}) {
    const { onUserSelect, userId, service, displayName, avatarMxc, rawAvatarUrl } = props;

    const onUserSelectCb = useCallback((ev: Event) => {
        ev.preventDefault();
        onUserSelect({displayName, userId, avatarMxc});
    }, []);

    return <li className={style.userItem}>
        <img className={style.avatar} src={ rawAvatarUrl || "/placehold.it/36"}/>
        <a title={userId} className={style.identifiers} href="#" onClick={onUserSelectCb} data-user={JSON.stringify({displayName, userId, avatarMxc})}>
            <span className="service">{SERVICE_TO_NAME[service]}</span> - <span className="displayName">{displayName || userId}</span>
        </a>
    </li>;
}

export default function InviteView(props: IProps) {
    const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout>();
    const [searchResults, setSearchResults] = useState<UserSearchResults|null>();

    const onSubmit = useCallback((ev) => {
        ev.preventDefault();
    }, []);

    const onInputChange = useCallback((ev: Event) => {
        ev.preventDefault();

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        setDebounceTimer(setTimeout(() => {
            const text = (ev.target as HTMLInputElement).value;
            if (!text) {
                return;
            }
            props.bridgeApi.searchUsers(text).then((results) => {
                setSearchResults(results);
            }).catch(ex => {
                setSearchResults(null);
                console.error("Failed to search for users");
            });
        }, DEBOUNCE_FOR_MS));
    }, [debounceTimer, setDebounceTimer]);


    const onUserSelect = useCallback((data: {displayName, userId, avatarMxc}) => {
        props.widgetApi.transport.send("invite_candidate", data).catch((ex) => {
            // TODO: Bubble up error
            console.error("Failed to send candidate over widgetApi", ex);
        });
    }, []);



    return <div>
        <p> Invite a user via Hookshot </p>
        <form className={style.form} onSubmit={onSubmit}>
            <p>Username, Name or Email:</p>
            <input onInput={onInputChange} className={style.inputField} type="search" placeholder="Search for GitHub, GitLab or JIRA users."/>
        </form>
        {searchResults && <ul>
            {searchResults?.data.map((u) => <InviteViewItem onUserSelect={onUserSelect} {...u}/>)}
        </ul>}
    </div>;
}