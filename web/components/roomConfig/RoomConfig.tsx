import { h, FunctionComponent, Fragment } from "preact";
import { useState } from "preact/hooks"
import { ListItem } from "../ListItem";
import BridgeAPI from "../../BridgeAPI";
import ErrorPane from "../ErrorPane";
import style from "./RoomConfig.module.scss";
import { GetConnectionsResponseItem } from "../../../src/provisioning/api";


export interface ConnectionConfigurationProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState> {
    serviceConfig: SConfig;
    onSave: (newConfig: ConnectionState) => void,
    existingConnection?: ConnectionType;
    onRemove?: () => void,
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
    connetionConfigComponent: FunctionComponent<ConnectionConfigurationProps<SConfig, ConnectionType, ConnectionState>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const RoomConfig: FunctionComponent<IRoomConfigProps<any, any, any>> = function<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState>(props: IRoomConfigProps<SConfig, ConnectionType, ConnectionState>) {
    const { api, roomId, type, headerImg, text, listItemName, connectionEventType } = props;
    const ConnectionConfigComponent = props.connetionConfigComponent;
    const [ error, setError ] = useState<null|string>(null);
    const [ connections, setConnections ] = useState<ConnectionType[]|null>(null);
    const [ serviceConfig, setServiceConfig ] = useState<SConfig|null>(null);
    const [ canEditRoom, setCanEditRoom ] = useState<boolean>(false);
    if (connections === null) {
        api.getConnectionsForService<ConnectionType>(roomId, type)
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
        api.getServiceConfig<SConfig>(type)
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
                <img src={headerImg} />
                <h1>{text.header}</h1> 
            </header>
            { canEditRoom && <section>
                <h2>{text.createNew}</h2>
                {serviceConfig && <ConnectionConfigComponent
                    api={api}
                    serviceConfig={serviceConfig}
                    onSave={(config) => {
                        api.createConnection(roomId, connectionEventType, config).then(() => {
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
                <h2>{ canEditRoom ? text.listCanEdit : text.listCantEdit }</h2>
                { serviceConfig && connections?.map(c => <ListItem key={c.id} text={listItemName(c)}>
                        <ConnectionConfigComponent
                            api={api}
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