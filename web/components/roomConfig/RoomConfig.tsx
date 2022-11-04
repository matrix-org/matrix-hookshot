import { h, FunctionComponent } from "preact";
import { useCallback, useEffect, useReducer, useState } from "preact/hooks"
import { BridgeAPI, BridgeAPIError } from "../../BridgeAPI";
import { ErrorPane, ListItem } from "../elements";
import style from "./RoomConfig.module.scss";
import { GetConnectionsResponseItem } from "../../../src/provisioning/api";
import { IConnectionState } from "../../../src/Connections";


export interface ConnectionConfigurationProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState> {
    serviceConfig: SConfig;
    onSave: (newConfig: ConnectionState) => void,
    existingConnection?: ConnectionType;
    onRemove?: () => void,
    api: BridgeAPI;
}

interface IRoomConfigProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState> {
    api: BridgeAPI;
    roomId: string;
    type: string;
    headerImg: string;
    text: {
        header: string;
        createNew: string;
        listCanEdit: string;
        listCantEdit: string;
    };
    connectionEventType: string;
    listItemName: (c: ConnectionType) => string,
    connectionConfigComponent: FunctionComponent<ConnectionConfigurationProps<SConfig, ConnectionType, ConnectionState>>;
}

export const RoomConfig = function<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState>(props: IRoomConfigProps<SConfig, ConnectionType, ConnectionState>) {
    const { api, roomId, type, headerImg, text, listItemName, connectionEventType } = props;
    const ConnectionConfigComponent = props.connectionConfigComponent;
    const [ error, setError ] = useState<null|{header?: string, message: string, isWarning?: boolean, forPrevious?: boolean}>(null);
    const [ connections, setConnections ] = useState<ConnectionType[]|null>(null);
    const [ serviceConfig, setServiceConfig ] = useState<SConfig|null>(null);
    const [ canEditRoom, setCanEditRoom ] = useState<boolean>(false);
    // We need to increment this every time we create a connection in order to properly reset the state.
    const [ newConnectionKey, incrementConnectionKey ] = useReducer<number, undefined>(n => n+1, 0);

    const clearCurrentError = () => {
        setError(error => error?.forPrevious ? error : null);
    }

    useEffect(() => {
        api.getConnectionsForService<ConnectionType>(roomId, type).then(res => {
            setCanEditRoom(res.canEdit);
            setConnections(res.connections);
            clearCurrentError();
        }).catch(ex => {
            console.warn("Failed to fetch existing connections", ex);
            setError({
                header: "Failed to fetch existing connections",
                message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
            });
        });
    }, [api, roomId, type, newConnectionKey]);

    useEffect(() => {
        api.getServiceConfig<SConfig>(type)
            .then(setServiceConfig)
            .then(clearCurrentError)
            .catch(ex => {
                console.warn("Failed to fetch service config", ex);
                setError({
                    header: "Failed to fetch service config",
                    message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
                });
            })
    }, [api, type]);

    const handleSaveOnCreation = useCallback((config: ConnectionState) => {
        api.createConnection(roomId, connectionEventType, config).then(result => {
            // Force reload
            incrementConnectionKey(undefined);
            setError(!result.warning ? null : {
                header: result.warning.header,
                message: result.warning.message,
                isWarning: true,
                forPrevious: true,
            });
        }).catch(ex => {
            console.warn("Failed to create connection", ex);
            setError({
                header: "Failed to create connection",
                message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
            });
        });
    }, [api, roomId, connectionEventType]);

    return <main>
        {
            error && <ErrorPane header={error.header || "Error"} isWarning={error.isWarning}>{error.message}</ErrorPane>
        }
        <header className={style.header}>
            <img src={headerImg} />
            <h1>{text.header}</h1> 
        </header>
        { canEditRoom && <section>
            <h2>{text.createNew}</h2>
            {serviceConfig && <ConnectionConfigComponent
                key={newConnectionKey}
                api={api}
                serviceConfig={serviceConfig}
                onSave={handleSaveOnCreation}
            />}
        </section>}
        <section>
            <h2>{ canEditRoom ? text.listCanEdit : text.listCantEdit }</h2>
            { serviceConfig && connections?.map(c => <ListItem key={c.id} text={listItemName(c)}>
                    <ConnectionConfigComponent
                        api={api}
                        serviceConfig={serviceConfig}
                        existingConnection={c}
                        onSave={(config) => {
                            api.updateConnection(roomId, c.id, config).then(() => {
                                c.config = config;
                                // Force reload
                                incrementConnectionKey(undefined);
                                setError(null);
                            }).catch(ex => {
                                console.warn("Failed to create connection", ex);
                                setError({
                                    header: "Failed to create connection",
                                    message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
                                });
                            });
                        }}
                        onRemove={() => {
                            api.removeConnection(roomId, c.id).then(() => {
                                setConnections(conn => conn.filter(conn => c.id !== conn.id));
                                setError(null);
                            }).catch(ex => {
                                console.warn("Failed to remove connection", ex);
                                setError({
                                    header: "Failed to remove connection",
                                    message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
                                });
                            });
                        }}
                    />
                </ListItem>)
            }
        </section>
    </main>;
};