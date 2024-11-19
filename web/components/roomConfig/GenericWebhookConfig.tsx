import { FunctionComponent, createRef } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks"
import { add, format } from "date-fns";
import { BridgeConfig } from "../../BridgeAPI";
import type { GenericHookConnectionState, GenericHookResponseItem, GenericHookServiceConfig } from "../../../src/Connections/GenericHook";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { InputField, ButtonSet, Button } from "../elements";
import WebhookIcon from "../../icons/webhook.png";
import { Alert, ToggleInput } from "@vector-im/compound-web";
import { InfoIcon, WarningIcon } from "@vector-im/compound-design-tokens/assets/web/icons"
import { lazy, Suspense } from "preact/compat";
import { LoadingSpinner } from "../elements/LoadingSpinner";
import { Extension } from "@uiw/react-codemirror";


const CodeMirror = lazy(() => import("@uiw/react-codemirror"));

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

const EXPIRY_WARN_AT_MS = 3 * 24 * 60 * 60 * 1000;

const CodeEditor: FunctionComponent<{value: string, onChange: (value: string) => void}> = ({value, onChange}) => {
    const [codeMirrorTheme, setCodeMirrorTheme] = useState<"light"|"dark">("light");
    const [extensions, setExtensions] = useState<Extension[]>();
    useEffect(() => {
        const mm = window.matchMedia('(prefers-color-scheme: dark)');
        const fn = (event: MediaQueryListEvent) => {
            setCodeMirrorTheme(event.matches ? "dark" : "light");
        };
        mm.addEventListener('change', fn);
        setCodeMirrorTheme(mm.matches ? "dark" : "light");
        return () => mm.removeEventListener('change', fn);
    }, []);

    useEffect(() => {
        async function loader() {
            const { javascript } = await import("@codemirror/lang-javascript");
            setExtensions([javascript({ jsx: false, typescript: false})]);
            console.log('Extensions loaded');
        }
        void loader();
    }, []);

    if (!extensions) {
        return <LoadingSpinner />;
    }

    return <Suspense fallback={<LoadingSpinner />}>
        <CodeMirror
            value={value}
            theme={codeMirrorTheme}
            extensions={extensions}
            onChange={onChange}
        />
        <p> See the <a target="_blank" rel="noopener noreferrer" href={DOCUMENTATION_LINK}>documentation</a> for help writing transformation functions </p>
    </Suspense>;
};

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
            expirationDate: expiryRef?.current?.value ? new Date(expiryRef?.current?.value).toISOString() : undefined,
            waitForComplete,
            ...(transFnEnabled ? { transformationFunction: transFn } : undefined),
        });
    }, [expiryRef, canEdit, onSave, nameRef, transFn, existingConnection, transFnEnabled, waitForComplete]);

    const hasExpired = existingConnection?.secrets?.timeRemainingMs ? existingConnection?.secrets?.timeRemainingMs <= 0 : false;
    const willExpireSoon = !hasExpired && existingConnection?.secrets?.timeRemainingMs ? existingConnection?.secrets?.timeRemainingMs <= EXPIRY_WARN_AT_MS : false;

    useEffect(() => {
        if (!expiryRef.current || !existingConnection?.config.expirationDate) {
            return;
        } 
        console.log('Setting date', new Date(existingConnection.config.expirationDate));
        expiryRef.current.valueAsDate = new Date(existingConnection.config.expirationDate);
    }, [existingConnection, expiryRef]);

    return <form onSubmit={handleSave}>
        {hasExpired && <Alert type="critical" title="This Webhook has expired">
            This Webhook has expired and will no longer handle any incoming requests. Please set a new expiry date or <strong>remove</strong> the Webhook.
        </Alert>}
        {willExpireSoon && <Alert type="info" title="This Webhook is expiring soon">
            This Webhook will expired soon will no longer handle any incoming requests. To extend the Webhook lifetime, set a new expiry date below.
        </Alert>}
        <InputField visible={!existingConnection} label="Friendly name" noPadding={true}>
            <input ref={nameRef} disabled={!canEdit} placeholder="My Webhook" type="text" value={existingConnection?.config.name} />
        </InputField>

        <InputField visible={!!existingConnection} label="URL" noPadding={true}>
            <input disabled={true} placeholder="URL hidden" type="text" value={existingConnection?.secrets?.url?.toString() || ""} />
        </InputField>

        <InputField label="Expiration date" noPadding={true}>
            <input
                type="datetime-local"
                required={serviceConfig.requireExpiryTime}
                disabled={!canEdit}
                ref={expiryRef}
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
            <ToggleInput disabled={!canEdit} type="checkbox" checked={transFnEnabled} onChange={useCallback(() => setTransFnEnabled(v => !v), [])} />
        </InputField>


        <InputField visible={serviceConfig.allowJsTransformationFunctions && transFnEnabled} label="Respond after function completes" noPadding={true}>
            <ToggleInput disabled={!canEdit || serviceConfig.waitForComplete} type="checkbox" checked={waitForComplete || serviceConfig.waitForComplete} onChange={useCallback(() => setWaitForComplete(v => !v), [])} />
        </InputField>
        {transFnEnabled && <CodeEditor value={transFn} onChange={setTransFn} />}
        <ButtonSet>
            { canEdit && <Button disabled={isUpdating} type="submit">{ existingConnection ? "Save" : "Add Webhook" }</Button>}
            { canEdit && existingConnection && <Button disabled={isUpdating} intent="remove" onClick={onRemove}>Remove Webhook</Button>}
        </ButtonSet>
    </form>;
};


const RoomConfigText = {
    header: 'Inbound (Generic) Webhooks',
    createNew: 'Create new Webhook',
    listCanEdit: 'Your Webhooks',
    listCantEdit: 'Configured Webhooks',
};

const RoomConfigListItemFunc = (c: GenericHookResponseItem) => {
    const hasExpired = c.secrets?.timeRemainingMs ? c.secrets.timeRemainingMs <= 0 : false;
    const willExpireSoon = !hasExpired && c.secrets?.timeRemainingMs ? c.secrets?.timeRemainingMs <= EXPIRY_WARN_AT_MS : false;
    
    return <>
        <span style={{verticalAlign: "middle"}}>{c.config.name}</span>
        <span style={{marginLeft: "8px", verticalAlign: "middle"}}>
            {hasExpired && <WarningIcon />}
            {willExpireSoon && <InfoIcon />}
        </span>
    </>
};

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

export default GenericWebhookConfig;