import { h, FunctionComponent, createRef } from "preact";
import { useCallback } from "preact/hooks"
import { BridgeConfig } from "../../BridgeAPI";
import { FeedConnectionState, FeedResponseItem } from "../../../src/Connections/FeedConnection";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { Button, ButtonSet, InputField } from "../elements";

import FeedsIcon from "../../icons/feeds.png";

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<ServiceConfig, FeedResponseItem, FeedConnectionState>> = ({existingConnection, onSave, onRemove}) => {
    const urlRef = createRef<HTMLInputElement>();
    const labelRef = createRef<HTMLInputElement>();

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit) {
            return;
        }
        const url = urlRef?.current?.value || existingConnection?.config.url;
        if (url) {
            onSave({
                url,
                label: labelRef?.current?.value || existingConnection?.config.label,
            });
        }
    }, [canEdit, onSave, urlRef, labelRef, existingConnection]);

    return <form onSubmit={handleSave}>
        <InputField visible={!existingConnection} label="URL" noPadding={true}>
            <input ref={urlRef} disabled={!canEdit} placeholder="Feed URL" type="text" value={existingConnection?.config.url} />
            <input ref={labelRef} disabled={!canEdit} placeholder="Label (optional)" type="text" value={existingConnection?.config.label} />
        </InputField>

        <ButtonSet>
            { canEdit && <Button type="submit">{ existingConnection ? "Save" : "Subscribe" }</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemove}>Unsubscribe</Button>}
        </ButtonSet>
    </form>;
};

interface ServiceConfig {
    pollIntervalSeconds: number,
}

const RoomConfigText = {
    header: 'RSS/Atom feeds',
    createNew: 'Subscribe to a feed',
    listCanEdit: 'Feeds subscribed to',
    listCantEdit: 'Feeds subscribed to',
};

const RoomConfigListItemFunc = (c: FeedResponseItem) => c.config.label || c.config.url;

export const FeedsConfig: BridgeConfig = ({ api, roomId }) => {
    return <RoomConfig<ServiceConfig, FeedResponseItem, FeedConnectionState>
        headerImg={FeedsIcon}
        api={api}
        roomId={roomId}
        type="feeds"
        connectionEventType="uk.half-shot.matrix-hookshot.feed"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};
