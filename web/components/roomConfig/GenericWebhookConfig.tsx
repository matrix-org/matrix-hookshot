import { FunctionComponent, createRef } from "preact";
import { useCallback, useState } from "preact/hooks"
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { BridgeConfig } from "../../BridgeAPI";
import { GenericHookConnectionState, GenericHookResponseItem } from "../../../src/Connections/GenericHook";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { InputField, ButtonSet, Button } from "../elements";
import WebhookIcon from "../../icons/webhook.png";

const EXAMPLE_SCRIPT = `if (data.counter === undefined) {
    result = {
        empty: true,
        version: "v2"
    };
  } else if (data.counter > data.maxValue) {
    result = {
          plain: \`**Oh no!** The counter has gone over by \${data.counter - data.maxValue}\`,
          version: "v2"
    };
  } else {
    result = {
          plain: \`*Everything is fine*, the counter is under by \${data.maxValue - data.counter}\`,
          version: "v2"
    };
  }`;

const DOCUMENTATION_LINK = "https://matrix-org.github.io/matrix-hookshot/latest/setup/webhooks.html#script-api";
const CODE_MIRROR_EXTENSIONS = [javascript({})];

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<ServiceConfig, GenericHookResponseItem, GenericHookConnectionState>> = ({serviceConfig, existingConnection, onSave, onRemove, isUpdating}) => {
    const [transFn, setTransFn] = useState<string>(existingConnection?.config.transformationFunction as string || EXAMPLE_SCRIPT);
    const [transFnEnabled, setTransFnEnabled] = useState(serviceConfig.allowJsTransformationFunctions && !!existingConnection?.config.transformationFunction);
    const nameRef = createRef<HTMLInputElement>();

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit) {
            return;
        }
        onSave({
            name: nameRef?.current?.value || existingConnection?.config.name || "Generic Webhook",
            ...(transFnEnabled ? { transformationFunction: transFn } : undefined),
        });
    }, [canEdit, onSave, nameRef, transFn, existingConnection, transFnEnabled]);

    return <form onSubmit={handleSave}>
        <InputField visible={!existingConnection} label="Friendly name" noPadding={true}>
            <input ref={nameRef} disabled={!canEdit} placeholder="My webhook" type="text" value={existingConnection?.config.name} />
        </InputField>

        <InputField visible={!!existingConnection} label="URL" noPadding={true}>
            <input disabled={true} placeholder="URL hidden" type="text" value={existingConnection?.secrets?.url || ""} />
        </InputField>

        <InputField visible={serviceConfig.allowJsTransformationFunctions} label="Enable Transformation JavaScript" noPadding={true}>
            <input disabled={!canEdit} type="checkbox" checked={transFnEnabled} onChange={useCallback(() => setTransFnEnabled(v => !v), [])} />
        </InputField>

        <InputField visible={transFnEnabled} noPadding={true}>
            <CodeMirror
                value={transFn}
                extensions={CODE_MIRROR_EXTENSIONS}
                onChange={setTransFn}
            />
            <p> See the <a target="_blank" rel="noopener noreferrer" href={DOCUMENTATION_LINK}>documentation</a> for help writing transformation functions </p>
        </InputField>
        <ButtonSet>
            { canEdit && <Button disabled={isUpdating} type="submit">{ existingConnection ? "Save" : "Add webhook" }</Button>}
            { canEdit && existingConnection && <Button disabled={isUpdating} intent="remove" onClick={onRemove}>Remove webhook</Button>}
        </ButtonSet>
    </form>;
};

interface ServiceConfig {
    allowJsTransformationFunctions: boolean
}

const RoomConfigText = {
    header: 'Generic Webhooks',
    createNew: 'Create new webhook',
    listCanEdit: 'Your webhooks',
    listCantEdit: 'Configured webhooks',
};

const RoomConfigListItemFunc = (c: GenericHookResponseItem) => c.config.name;

export const GenericWebhookConfig: BridgeConfig = ({ api, roomId, showHeader }) => {
    return <RoomConfig<ServiceConfig, GenericHookResponseItem, GenericHookConnectionState>
        headerImg={WebhookIcon}
        showHeader={showHeader}
        api={api}
        roomId={roomId}
        type="generic"
        connectionEventType="uk.half-shot.matrix-hookshot.generic.hook"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};
