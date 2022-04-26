import { h, FunctionComponent, createRef } from "preact";
import { useCallback, useState } from "preact/hooks"
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { Button } from "../Button";
import BridgeAPI from "../../BridgeAPI";
import { GenericHookConnectionState, GenericHookResponseItem } from "../../../src/Connections/GenericHook";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import InputField from "../InputField";
import ButtonSet from "../ButtonSet";

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
          plain: \`*Everything is fine*, the counter is under by\${data.maxValue - data.counter}\`,
          version: "v2"
    };
  }`;

const DOCUMENTATION_LINK = "https://matrix-org.github.io/matrix-hookshot/latest/setup/webhooks.html#script-api";


const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<ServiceConfig, GenericHookResponseItem, GenericHookConnectionState>> = ({serviceConfig, existingConnection, onSave, onRemove}) => {
    const [transFn, setTransFn] = useState<string>(existingConnection?.config.transformationFunction as string || EXAMPLE_SCRIPT);
    const [transFnEnabled, setTransFnEnabled] = useState(serviceConfig.allowJsTransformationFunctions && !!existingConnection?.config.transformationFunction);
    const nameRef = createRef<HTMLInputElement>();

    const onSaveClick = useCallback(() => {
        onSave({
            name: nameRef?.current?.value || existingConnection?.config.name,
            ...(transFnEnabled ? { transformationFunction: transFn } : undefined),
        });
    }, [onSave, nameRef, transFn, existingConnection, transFnEnabled]);

    const onRemoveClick = useCallback(() => {
        onRemove();
    }, [onRemove]);

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    return <div>
        <InputField visible={!existingConnection} label="Friendly name" noPadding={true}>
            <input ref={nameRef} disabled={!canEdit} placeholder="My webhook" type="text" value={existingConnection?.config.name} />
        </InputField>

        <InputField visible={!!existingConnection} label="URL" noPadding={true}>
            <input disabled={true} placeholder="URL hidden" type="text" value={existingConnection?.secrets?.url || ""} />
        </InputField>

        <InputField visible={serviceConfig.allowJsTransformationFunctions} label="Enable Transformation JavaScript" noPadding={true}>
            <input disabled={!canEdit} type="checkbox" checked={transFnEnabled} onChange={() => setTransFnEnabled(!transFnEnabled)} />
        </InputField>

        <InputField visible={transFnEnabled} noPadding={true}>
            <CodeMirror
                value={transFn}
                extensions={[javascript({  })]}
                onChange={(value) => {
                    setTransFn(value)
                }}
            />
            <p> See the <a target="_blank" rel="noopener noreferrer" href={DOCUMENTATION_LINK}>documentation</a> for help writing transformation functions </p>
        </InputField>
        <ButtonSet>
            { canEdit && <Button onClick={onSaveClick}>{ existingConnection ? "Save" : "Add webhook" }</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemoveClick}>Remove webhook</Button>}
        </ButtonSet>
    </div>;
};

interface IGenericWebhookConfigProps {
    api: BridgeAPI,
    roomId: string,
}

interface ServiceConfig {
    allowJsTransformationFunctions: boolean
}

export const GenericWebhookConfig: FunctionComponent<IGenericWebhookConfigProps> = ({ api, roomId }) => {
    return <RoomConfig
        headerImg="./icons/webhook.png"
        api={api}
        roomId={roomId}
        type="generic"
        connectionEventType="uk.half-shot.matrix-hookshot.generic.hook"
        text={({
            header: 'Generic Webhooks',
            createNew: 'Create new webhook',
            listCanEdit: 'Your webhooks',
            listCantEdit: 'Configured webhooks',
        })}
        listItemName={(c) => (c as GenericHookResponseItem).config.name}
        connetionConfigComponent={ConnectionConfiguration}
    />;
};