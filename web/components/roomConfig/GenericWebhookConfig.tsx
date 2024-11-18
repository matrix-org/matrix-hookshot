import { FunctionComponent, createRef } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks"
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { add, format } from "date-fns";
import { BridgeConfig } from "../../BridgeAPI";
import type { GenericHookConnectionState, GenericHookResponseItem, GenericHookServiceConfig } from "../../../src/Connections/GenericHook";
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

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<GenericHookServiceConfig, GenericHookResponseItem, GenericHookConnectionState>> = ({serviceConfig, existingConnection, onSave, onRemove, isUpdating}) => {
    const [transFn, setTransFn] = useState<string>(existingConnection?.config.transformationFunction as string || EXAMPLE_SCRIPT);
    const [transFnEnabled, setTransFnEnabled] = useState(serviceConfig.allowJsTransformationFunctions && !!existingConnection?.config.transformationFunction);
    const [waitForComplete, setWaitForComplete] = useState(existingConnection?.config.waitForComplete ?? false);

    const minExpiryTime = format(add(new Date(), { hours: 1 }), "yyyy-MM-dd'T'HH:mm");
    const maxExpiryTime = serviceConfig.maxExpiryTime ? format(Date.now() + serviceConfig.maxExpiryTime, "yyyy-MM-dd'T'HH:mm") : undefined;

    const nameRef = createRef<HTMLInputElement>();
    const expiryRef = createRef<HTMLInputElement>();

    const canEdit = !existingConnection || existingConnection?.canEdit || false;
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit) {
            return;
        }
        onSave({
            name: nameRef?.current?.value || existingConnection?.config.name || "Generic Webhook",
            expirationDate: !!expiryRef?.current?.value ? expiryRef?.current?.value : undefined,
            waitForComplete,
            ...(transFnEnabled ? { transformationFunction: transFn } : undefined),
        });
    }, [canEdit, onSave, nameRef, transFn, existingConnection, transFnEnabled, waitForComplete]);

    const [codeMirrorTheme, setCodeMirrorTheme] = useState<"light"|"dark">("light");
    useEffect(() => {
        if (!transFnEnabled) {
            return;
        }
        const mm = window.matchMedia('(prefers-color-scheme: dark)');
        const fn = (event: MediaQueryListEvent) => {
            console.log('media change!');
            setCodeMirrorTheme(event.matches ? "dark" : "light");
        };
        mm.addEventListener('change', fn);
        setCodeMirrorTheme(mm.matches ? "dark" : "light");
        return () => mm.removeEventListener('change', fn);
    }, [transFnEnabled]);

    return <form onSubmit={handleSave}>
        <InputField visible={!existingConnection} label="Friendly name" noPadding={true}>
            <input ref={nameRef} disabled={!canEdit} placeholder="My webhook" type="text" value={existingConnection?.config.name} />
        </InputField>

        <InputField visible={!!existingConnection} label="URL" noPadding={true}>
            <input disabled={true} placeholder="URL hidden" type="text" value={existingConnection?.secrets?.url?.toString() || ""} />
        </InputField>

        <InputField label="Expiration date (optional)" noPadding={true}>
            <input
                type="datetime-local"
                disabled={!canEdit}
                ref={expiryRef}
                value={existingConnection?.config.expirationDate ?? ""}
                min={minExpiryTime}
                max={maxExpiryTime} />
            <Button intent="remove" onClick={(ev) => {
                ev.preventDefault();
                if (expiryRef.current?.value) {
                    expiryRef.current.value = "";
                }
                }} disabled={!!expiryRef.current?.value}>Clear</Button>
        </InputField>

        <InputField visible={serviceConfig.allowJsTransformationFunctions} label="Enable Transformation JavaScript" noPadding={true}>
            <input disabled={!canEdit} type="checkbox" checked={transFnEnabled} onChange={useCallback(() => setTransFnEnabled(v => !v), [])} />
        </InputField>


        <InputField visible={serviceConfig.allowJsTransformationFunctions && transFnEnabled} label="Respond after function completes" noPadding={true}>
            <input disabled={!canEdit || serviceConfig.waitForComplete} type="checkbox" checked={waitForComplete || serviceConfig.waitForComplete} onChange={useCallback(() => setWaitForComplete(v => !v), [])} />
        </InputField>

        {transFnEnabled && <><CodeMirror
            value={transFn}
            theme={codeMirrorTheme}
            extensions={CODE_MIRROR_EXTENSIONS}
            onChange={setTransFn}
        />
        <p> See the <a target="_blank" rel="noopener noreferrer" href={DOCUMENTATION_LINK}>documentation</a> for help writing transformation functions </p>
        </>}
        <ButtonSet>
            { canEdit && <Button disabled={isUpdating} type="submit">{ existingConnection ? "Save" : "Add webhook" }</Button>}
            { canEdit && existingConnection && <Button disabled={isUpdating} intent="remove" onClick={onRemove}>Remove webhook</Button>}
        </ButtonSet>
    </form>;
};


const RoomConfigText = {
    header: 'Inbound (Generic) Webhooks',
    createNew: 'Create new webhook',
    listCanEdit: 'Your webhooks',
    listCantEdit: 'Configured webhooks',
};

const RoomConfigListItemFunc = (c: GenericHookResponseItem) => c.config.name;

export const GenericWebhookConfig: BridgeConfig = ({ roomId, showHeader }) => {
    return <RoomConfig<GenericHookServiceConfig, GenericHookResponseItem, GenericHookConnectionState>
        headerImg={WebhookIcon}
        darkHeaderImg={true}
        showHeader={showHeader}
        roomId={roomId}
        type="generic"
        connectionEventType="uk.half-shot.matrix-hookshot.generic.hook"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};
