import { h, FunctionComponent, createRef } from "preact";
import { useCallback, useState } from "preact/hooks"
import BridgeAPI from "../../BridgeAPI";
import { FeedConnectionState, FeedResponseItem } from "../../../src/Connections/FeedConnection";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { Button, ButtonSet, InputField } from "../elements";

import FeedsIcon from "../../icons/feeds.png";

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<ServiceConfig, FeedResponseItem, FeedConnectionState>> = ({existingConnection, onSave, onRemove}) => {
    const nameRef = createRef<HTMLInputElement>();

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit) {
            return;
        }
        onSave({
            url: nameRef?.current?.value || existingConnection?.config.url,
        });
    }, [canEdit, onSave, nameRef, existingConnection]);

    return <form onSubmit={handleSave}>
        <InputField visible={!existingConnection} label="URL" noPadding={true}>
            <input ref={nameRef} disabled={!canEdit} placeholder="Feed URL" type="text" value={existingConnection?.config.url} />
        </InputField>

        <ButtonSet>
            { canEdit && <Button type="submit">{ existingConnection ? "Save" : "Subscribe" }</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemove}>Unsubscribe</Button>}
        </ButtonSet>
    </form>;
};

interface IGenericWebhookConfigProps {
    api: BridgeAPI,
    roomId: string,
}

interface ServiceConfig {
    pollIntervalSeconds: number,
}

const RoomConfigText = {
    header: 'RSS/Atom feeds',
    createNew: 'Subscribe to a feed',
    listCanEdit: 'Feeds subscribed to',
    listCantEdit: 'Feeds subscribed to',
};

const RoomConfigListItemFunc = (c: FeedResponseItem) => c.config.url;

export const FeedsConfig: FunctionComponent<IGenericWebhookConfigProps> = ({ api, roomId }) => {
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
