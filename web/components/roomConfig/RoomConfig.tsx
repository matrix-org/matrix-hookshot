import { h, FunctionComponent } from "preact";
import { useCallback, useEffect, useReducer, useState } from "preact/hooks"
import { BridgeAPI, BridgeAPIError } from "../../BridgeAPI";
import { ErrorPane, ListItem } from "../elements";
import style from "./RoomConfig.module.scss";
import { GetConnectionsResponseItem } from "../../../src/provisioning/api";


export interface ConnectionConfigurationProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState> {
    serviceConfig: SConfig;
    onSave: (newConfig: ConnectionState) => void,
    existingConnection?: ConnectionType;
    onRemove?: () => void,
    onRefresh?: () => void,
    api: BridgeAPI;
}

interface IRoomConfigProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState> {
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

export const RoomConfig = function<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState>(props: IRoomConfigProps<SConfig, ConnectionType, ConnectionState>) {
    const { api, roomId, type, headerImg, text, listItemName, connectionEventType } = props;
    const ConnectionConfigComponent = props.connectionConfigComponent;
    const [ error, setError ] = useState<null|{header?: string, message: string}>(null);
    const [ connections, setConnections ] = useState<ConnectionType[]|null>(null);
    const [ serviceConfig, setServiceConfig ] = useState<SConfig|null>(null);
    const [ canEditRoom, setCanEditRoom ] = useState<boolean>(false);
    // We need to increment this every time we create a connection in order to properly reset the state.
    const [ newConnectionKey, incrementConnectionKey ] = useReducer<number, undefined>(n => n+1, 0);

    useEffect(() => {
        refreshConnections();
    }, [api, roomId, type, newConnectionKey]);


    const refreshConnections = useCallback(() => {
        api.getConnectionsForService<ConnectionType>(roomId, type).then(res => {
            setCanEditRoom(res.canEdit);
            setConnections(res.connections);
            setError(null);
        }).catch(ex => {
            console.warn("Failed to fetch existing connections", ex);
            setError({
                header: "Failed to fetch existing connections",
                message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
            });
        });
    }, [api, roomId, type]);

    useEffect(() => {
        if (!serviceConfig) {
            api.getServiceConfig<SConfig>(type)
            .then(setServiceConfig)
            .then(() => {
                setError(null);
            })
            .catch(ex => {
                console.warn("Failed to fetch service config", ex);
                setError({
                    header: "Failed to fetch service config",
                    message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
                });
            })
        }
    }, [api, type, serviceConfig]);

    const handleSaveOnCreation = useCallback((config) => {
        api.createConnection(roomId, connectionEventType, config).then(() => {
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
    }, [api, roomId, connectionEventType]);

    return <main>
        {
            error && <ErrorPane header={error.header || "Error"}>{error.message}</ErrorPane>
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
                onRefresh={refreshConnections}
            />}
        </section>}
        <section>
            <h2>{ canEditRoom ? text.listCanEdit : text.listCantEdit }</h2>
            { serviceConfig && connections?.map(c => <ListItem key={c.id} text={listItemName(c)}>
                    <ConnectionConfigComponent
                        api={api}
                        serviceConfig={serviceConfig}
                        existingConnection={c}
                        onRefresh={refreshConnections}
                        onSave={(config) => {
                            api.updateConnection(roomId, c.id, config).then(() => {
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