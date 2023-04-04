import { FunctionComponent, createRef } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks"
import { BridgeConfig } from "../../BridgeAPI";
import { FeedConnectionState, FeedResponseItem } from "../../../src/Connections/FeedConnection";
import { ConnectionConfigurationProps, IRoomConfigText, RoomConfig } from "./RoomConfig";
import { Button, ButtonSet, InputField } from "../elements";
import styles from "./FeedConnection.module.scss";

import FeedsIcon from "../../icons/feeds.png";

const DEFAULT_TEMPLATE = "New post in $FEEDNAME: $LINK"

const FeedRecentResults: FunctionComponent<{item: FeedResponseItem}> = ({ item }) => {
    if (!item.secrets) {
        return null;
    }
    return <>
        <h3>Recent feed results</h3>
        {!item.secrets.lastResults.length && <span>There have been no recent updates for this feed.</span>}
        <ul>
            {item.secrets.lastResults.map(item => <li className={styles.resultListItem} key={item.timestamp}>
                {new Date(item.timestamp).toLocaleString()}:
                {item.ok && `✅ Successful fetch`}
                {!item.ok && `⚠️ ${item.error}`}
            </li>)}
        </ul>
    </>;
}
const DOCUMENTATION_LINK = "https://matrix-org.github.io/matrix-hookshot/latest/setup/feeds.html#feed-templates";

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<ServiceConfig, FeedResponseItem, FeedConnectionState>> = ({existingConnection, onSave, onRemove, isMigrationCandidate}) => {
    const urlRef = createRef<HTMLInputElement>();
    const labelRef = createRef<HTMLInputElement>();
    const templateRef = createRef<HTMLInputElement>();
    const canSave = !existingConnection?.id || (existingConnection?.canEdit ?? false);
    const canEdit = canSave && !isMigrationCandidate;
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canSave) {
            return;
        }
        const url = urlRef?.current?.value || existingConnection?.config.url;
        if (url) {
            onSave({
                url,
                label: labelRef?.current?.value || existingConnection?.config.label,
                template: templateRef.current?.value || existingConnection?.config.template,
            });
        }
    }, [canSave, onSave, urlRef, labelRef, templateRef, existingConnection]);
    
    return <form onSubmit={handleSave}>
        { existingConnection && <FeedRecentResults item={existingConnection} />}

        <InputField visible={true} label="URL" noPadding={true}>
            <input ref={urlRef} disabled={!canEdit || !!existingConnection} type="text" value={existingConnection?.config.url} />
        </InputField>
        <InputField visible={true} label="Label" noPadding={true}>
            <input ref={labelRef} disabled={!canEdit} type="text" value={existingConnection?.config.label} />
        </InputField>
        <InputField visible={true} label="Template" noPadding={true}>
            <input ref={templateRef} disabled={!canEdit} type="text" value={existingConnection?.config.template} placeholder={DEFAULT_TEMPLATE} />
            <p> See the <a target="_blank" rel="noopener noreferrer" href={DOCUMENTATION_LINK}>documentation</a> for help writing templates. </p>
        </InputField>

        <ButtonSet>
            { canSave && <Button type="submit">{ existingConnection?.id ? "Save" : "Subscribe" }</Button>}
            { canEdit && existingConnection?.id && <Button intent="remove" onClick={onRemove}>Unsubscribe</Button>}
        </ButtonSet>

    </form>;
};

interface ServiceConfig {
    pollIntervalSeconds: number,
}

const roomConfigText: IRoomConfigText = {
    header: 'RSS/Atom feeds',
    createNew: 'Subscribe to a feed',
    listCanEdit: 'Feeds subscribed to',
    listCantEdit: 'Feeds subscribed to',
};

const RoomConfigListItemFunc = (c: FeedResponseItem) => c.config.label || c.config.url;

export const FeedsConfig: BridgeConfig = ({ api, roomId, showHeader }) => {
    const [ goNebConnections, setGoNebConnections ] = useState(undefined);

    useEffect(() => {
        api.getGoNebConnectionsForRoom(roomId).then((res: any) => {
            if (!res) return;
            setGoNebConnections(res.feeds.map((config: any) => ({
                config,
            })));
        }).catch(ex => {
            console.warn("Failed to fetch go neb connections", ex);
        });
    }, [api, roomId]);

    const compareConnections = useCallback((goNebConnection: FeedResponseItem, nativeConnection: FeedResponseItem) => goNebConnection.config.url === nativeConnection.config.url, []);

    return <RoomConfig<ServiceConfig, FeedResponseItem, FeedConnectionState>
        headerImg={FeedsIcon}
        showHeader={showHeader}
        api={api}
        roomId={roomId}
        type="feeds"
        connectionEventType="uk.half-shot.matrix-hookshot.feed"
        text={roomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionConfigComponent={ConnectionConfiguration}
        migrationCandidates={goNebConnections}
        migrationComparator={compareConnections}
    />;
};
