import { FunctionComponent, createRef } from "preact";
import { useCallback, useState } from "preact/hooks"
import { BridgeConfig } from "../../BridgeAPI";
import type { OutboundHookConnectionState, OutboundHookResponseItem } from "../../../src/Connections/OutboundHook";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { InputField, ButtonSet, Button } from "../elements";
import WebhookIcon from "../../icons/webhook.png";

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<ServiceConfig, OutboundHookResponseItem, OutboundHookConnectionState>> = ({existingConnection, onSave, onRemove, isUpdating}) => {
    const [outboundUrl, setOutboundUrl] = useState<string>(existingConnection?.config.url ?? '');

    const nameRef = createRef<HTMLInputElement>();

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit) {
            return;
        }
        onSave({
            name: nameRef?.current?.value || existingConnection?.config.name || "Generic Webhook",
            url: outboundUrl,
        });
    }, [canEdit, onSave, nameRef, outboundUrl, existingConnection]);

    const onUrlChange = useCallback((evt: any) => {
        setOutboundUrl(evt.target?.value);
    }, [setOutboundUrl]);

    const [tokenRevealed, setTokenRevealed] = useState<boolean>(false);

    const revealToken = useCallback((evt: any) => {
        evt.preventDefault();
        setTokenRevealed(true);
    }, [setTokenRevealed]);



    return <form onSubmit={handleSave}>
        <InputField visible={!existingConnection} label="Friendly name" noPadding={true}>
            <input ref={nameRef} disabled={!canEdit} placeholder="My webhook" type="text" value={existingConnection?.config.name} />
        </InputField>

        <InputField label="URL" noPadding={true}>
            <input onChange={onUrlChange} placeholder="https://example.org/my-webhook" type="text" value={outboundUrl} />
        </InputField>
    
        <InputField visible={!!existingConnection} label="Token" noPadding={true}>
            <input onClick={revealToken} readOnly={true} type="text" value={tokenRevealed ? existingConnection?.secrets?.token : "Click to reveal"} />
        </InputField>

        <ButtonSet>
            { canEdit && <Button disabled={isUpdating} type="submit">{ existingConnection ? "Save" : "Add webhook" }</Button>}
            { canEdit && existingConnection && <Button disabled={isUpdating} intent="remove" onClick={onRemove}>Remove webhook</Button>}
        </ButtonSet>
    </form>;
};

interface ServiceConfig {
    allowJsTransformationFunctions: boolean,
    waitForComplete: boolean,
}

const RoomConfigText = {
    header: 'Outbound Webhooks',
    createNew: 'Create new webhook',
    listCanEdit: 'Your webhooks',
    listCantEdit: 'Configured webhooks',
};

const RoomConfigListItemFunc = (c: OutboundHookResponseItem) => c.config.name;

const OutboundWebhookConfig: BridgeConfig = ({ roomId, showHeader }) => {
    return <RoomConfig<ServiceConfig, OutboundHookResponseItem, OutboundHookConnectionState>
        headerImg={WebhookIcon}
        darkHeaderImg={true}
        showHeader={showHeader}
        roomId={roomId}
        type="genericOutbound"
        connectionEventType="uk.half-shot.matrix-hookshot.outbound-hook"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};

export default OutboundWebhookConfig;