import { h, FunctionComponent, Fragment, createRef } from "preact";
import { useCallback, useState } from "preact/hooks"
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { Button } from "../Button";
import { ListItem } from "../ListItem";
import BridgeAPI from "../../BridgeAPI";
import ErrorPane from "../ErrorPane";
import { GenericHookConnectionState, GenericHookResponseItem } from "../../../src/Connections/GenericHook";
import style from "./GenericWebhookConfig.module.scss";

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


const ConnectionConfiguration: FunctionComponent<{
    serviceConfig: ServiceConfig,
    existingConnection?: GenericHookResponseItem,
    onSave: (newConfig: GenericHookConnectionState) => void,
    onRemove?: () => void
}> = ({serviceConfig, existingConnection, onSave, onRemove}) => {

    const [transFn, setTransFn] = useState<string>(existingConnection?.config.transformationFunction as string || EXAMPLE_SCRIPT);
    const [transFnEnabled, setTransFnEnabled] = useState(serviceConfig.allowJsTransformationFunctions && !!existingConnection?.config.transformationFunction);
    const nameRef = createRef<HTMLInputElement>();

    const onSaveClick = useCallback(() => {
        onSave({
            name: nameRef?.current?.value || existingConnection?.config.name,
            ...(transFnEnabled ? { transformationFunction: transFn } : undefined),
        });
        if (!existingConnection) {
            // Clear fields
            nameRef.current.value = "";
            setTransFn(EXAMPLE_SCRIPT);
            setTransFnEnabled(false);
        }
    }, [onSave, nameRef, transFn, setTransFnEnabled, setTransFn, existingConnection, transFnEnabled]);

    const onRemoveClick = useCallback(() => {
        onRemove();
    }, [onRemove]);

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    return <div>
        { !existingConnection && <div className={style.inputField}>
            <label>Friendly name</label>
            <input ref={nameRef} disabled={!canEdit} placeholder="My webhook" type="text" value={existingConnection?.config.name} />
        </div> }

        {!!existingConnection && <div className={style.inputField}>
            <label>URL</label>
            <input disabled={true} placeholder="URL hidden" type="text" value={existingConnection?.secrets?.url || ""} />
        </div>}

        { serviceConfig.allowJsTransformationFunctions && <div className={style.inputField}>
            <label className={style.nopad}>Enable Transformation JavaScript</label>
            <input disabled={!canEdit} type="checkbox" checked={transFnEnabled} onChange={() => setTransFnEnabled(!transFnEnabled)} />
        </div> }

        { transFnEnabled && <div className={style.inputField}>
            <CodeMirror
                value={transFn}
                extensions={[javascript({  })]}
                onChange={(value) => {
                    setTransFn(value)
                }}
            />
            <p> See the <a target="_blank" rel="noopener noreferrer" href={DOCUMENTATION_LINK}>documentation</a> for help writing transformation functions </p>
        </div>}

        <div className={style.buttonSet}>
            { canEdit && <Button onClick={onSaveClick}>{ existingConnection ? "Save" : "Add webhook"}</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemoveClick}>Remove webhook</Button>}
        </div>

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
    const [ error, setError ] = useState<null|string>(null);
    const [ connections, setConnections ] = useState<GenericHookResponseItem[]|null>(null);
    const [ serviceConfig, setServiceConfig ] = useState<{allowJsTransformationFunctions: boolean}|null>(null);
    const [ canEditRoom, setCanEditRoom ] = useState<boolean>(false);

    if (connections === null) {
        api.getConnectionsForService<GenericHookResponseItem>(roomId, 'generic')
        .then(res => {
            setCanEditRoom(res.canEdit);
            setConnections(res.connections);
        })
        .catch(ex => {
            console.warn("Failed to fetch existing connections", ex);
            setError("Failed to fetch existing connections");
        });
    }

    if (serviceConfig === null) {
        api.getServiceConfig<ServiceConfig>('generic')
        .then((res) => setServiceConfig(res))
        .catch(ex => {
            console.warn("Failed to fetch service config", ex);
            setError("Failed to fetch service config");
        });

    }

    return <>
        <main>
            {
                error && <ErrorPane header="Error">{error}</ErrorPane>
            }
            <header className={style.header}>
                <img src="./icons/webhook.png" />
                <h1>Generic Webhooks</h1> 
            </header>
            { canEditRoom && <section>
                <h2>Create new webhook</h2>
                {serviceConfig && <ConnectionConfiguration
                    serviceConfig={serviceConfig}
                    onSave={(config) => {
                        api.createConnection(roomId, "uk.half-shot.matrix-hookshot.generic.hook", config).then(() => {
                            // Force reload
                            setConnections(null);
                        }).catch(ex => {
                            console.warn("Failed to create connection", ex);
                            setError("Failed to create connection");
                        });
                    }}
                />}
            </section>}
            <section>
                <h2>{ canEditRoom ? "Your webhooks" : "Configured webhooks" }</h2>
                { serviceConfig && connections?.map(c => <ListItem key={c.id} text={c.config.name as string}>
                        <ConnectionConfiguration
                            serviceConfig={serviceConfig}
                            existingConnection={c}
                            onSave={(config) => {
                                api.updateConnection(roomId, c.id, config).then(() => {
                                    // Force reload
                                    setConnections(null);
                                }).catch(ex => {
                                    console.warn("Failed to create connection", ex);
                                    setError("Failed to create connection");
                                });
                            }}
                            onRemove={() => {
                                api.removeConnection(roomId, c.id).then(() => {
                                    setConnections(connections.filter(conn => c.id !== conn.id));
                                }).catch(ex => {
                                    console.warn("Failed to remove connection", ex);
                                    setError("Failed to remove connection");
                                });
                            }}
                        />
                    </ListItem>)
                }
            </section>
        </main>
    </>;
};