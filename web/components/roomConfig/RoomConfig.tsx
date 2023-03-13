import { FunctionComponent } from "preact";
import { useCallback, useEffect, useReducer, useState } from "preact/hooks"
import { BridgeAPI, BridgeAPIError } from "../../BridgeAPI";
import { ErrorPane, ListItem, WarningPane, Card } from "../elements";
import style from "./RoomConfig.module.scss";
import { GetConnectionsResponseItem } from "../../../src/provisioning/api";
import { IConnectionState } from "../../../src/Connections";
import { LoadingSpinner } from '../elements/LoadingSpinner';


export interface ConnectionConfigurationProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState> {
    serviceConfig: SConfig;
    onSave: (newConfig: ConnectionState) => void,
    existingConnection?: ConnectionType;
    onRemove?: () => void,
    api: BridgeAPI;
}

export interface IRoomConfigText {
    header: string;
    login?: string;
    createNew: string;
    listCanEdit: string;
    listCantEdit: string;
}

interface IRoomConfigProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState> {
    api: BridgeAPI;
    roomId: string;
    type: string;
    hasAuth?: boolean;
    showHeader: boolean;
    headerImg: string;
    text: IRoomConfigText;
    connectionEventType: string;
    listItemName: (c: ConnectionType) => string,
    connectionConfigComponent: FunctionComponent<ConnectionConfigurationProps<SConfig, ConnectionType, ConnectionState>>;
}

const Auth = ({
    api,
    service,
    loginLabel,
}: {
    api: BridgeAPI,
    service: string,
    loginLabel: string,
}) => {
    const [error, setError] = useState('');
    const [auth, setAuth] = useState<{
        user?: { name: string },
        authUrl?: string,
    }>();

    useEffect(() => {
        const getAuth = async () => {
            try {
                const auth = await api.getAuth(service);
                setAuth(auth);
            } catch (e) {
                console.error('Failed to get auth:', e);
                if (e instanceof BridgeAPIError) {
                    setError(e.message);
                } else {
                    setError('Unknown error.');
                }
            }
        };
        void getAuth();
    }, [api, service]);

    if (auth) {
        if (auth.authUrl) {
            // TODO How do we know when auth has happened?
            return <a href={auth.authUrl} target="_blank" rel="noreferrer">
                { loginLabel }
            </a>;
        }
        return <p>
            Logged in as <strong>{auth.user?.name ?? ''}</strong>
        </p>;
    } else if (error) {
        return <ErrorPane
            header="Failed to check authentication"
        >
            { error }
        </ErrorPane>;
    }
    return <p>Checking authentication...</p>;
};

export const RoomConfig = function<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState>(props: IRoomConfigProps<SConfig, ConnectionType, ConnectionState>) {
    const {
        api,
        roomId,
        type,
        hasAuth = false,
        headerImg,
        showHeader,
        text,
        listItemName,
        connectionEventType
    } = props;
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

    return <Card>
        <main>
            {
                error &&
                (!error.isWarning
                        ? <ErrorPane header={error.header || "Error"}>{error.message}</ErrorPane>
                        : <WarningPane header={error.header || "Warning"}>{error.message}</WarningPane>
                )
            }
            { showHeader &&
                <header className={style.header}>
                    <img alt="" src={headerImg} />
                    <h1>{text.header}</h1>
                </header>
            }
            { hasAuth &&
                <Auth
                    api={api}
                    service={type}
                    loginLabel={text.login ?? 'Log in'}
                />
            }
            { canEditRoom && <section>
                <h2>{text.createNew}</h2>
                {serviceConfig && <ConnectionConfigComponent
                    key={newConnectionKey}
                    api={api}
                    serviceConfig={serviceConfig}
                    onSave={handleSaveOnCreation}
                />}
            </section>}
            { connections === null && <LoadingSpinner /> }
            { !!connections?.length && <section>
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
                                setConnections(conns => conns?.filter(conn => c.id !== conn.id) || []);
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
            </section>}
        </main>
    </Card>;
};
