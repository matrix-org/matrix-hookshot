import { FunctionComponent } from "preact";
import { useCallback, useContext, useEffect, useReducer, useState } from "preact/hooks"
import { BridgeAPIError } from "../../BridgeAPI";
import { ListItem, Card } from "../elements";
import style from "./RoomConfig.module.scss";
import { GetConnectionsResponseItem } from "../../../src/provisioning/api";
import { IConnectionState } from "../../../src/Connections";
import { LoadingSpinner } from '../elements/LoadingSpinner';
import { ErrCode } from "../../../src/api";
import { retry } from "../../../src/PromiseUtil";
import { Alert } from "@vector-im/compound-web";
import { BridgeContext } from "../../context";

export interface ConnectionConfigurationProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState> {
    serviceConfig: SConfig;
    loginLabel?: string;
    showAuthPrompt?: boolean;
    onSave: (newConfig: ConnectionState) => void,
    isUpdating: boolean,
    isMigrationCandidate?: boolean,
    existingConnection?: ConnectionType;
    onRemove?: () => void,
}

export interface IRoomConfigText {
    header: string;
    login?: string;
    createNew: string;
    listCanEdit: string;
    listCantEdit: string;
}

interface IRoomConfigProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState> {
    roomId: string;
    type: string;
    showAuthPrompt?: boolean;
    showHeader: boolean;
    darkHeaderImg?: boolean;
    headerImg: string;
    text: IRoomConfigText;
    connectionEventType: string;
    listItemName: (c: ConnectionType) => string,
    connectionConfigComponent: FunctionComponent<ConnectionConfigurationProps<SConfig, ConnectionType, ConnectionState>>;
}

const MAX_CONNECTION_FETCH_ATTEMPTS = 10;

export const RoomConfig = function<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState>(props: IRoomConfigProps<SConfig, ConnectionType, ConnectionState>) {
    const {
        roomId,
        type,
        showAuthPrompt = false,
        darkHeaderImg,
        headerImg,
        showHeader,
        text,
        listItemName,
        connectionEventType,
    } = props;
    const api = useContext(BridgeContext).bridgeApi;
    const ConnectionConfigComponent = props.connectionConfigComponent;
    const [ error, setError ] = useState<null|{header?: string, message: string, isWarning?: boolean, forPrevious?: boolean}>(null);
    const [ connections, setConnections ] = useState<ConnectionType[]|null>(null);
    const [ serviceConfig, setServiceConfig ] = useState<SConfig|null>(null);
    const [ canEditRoom, setCanEditRoom ] = useState<boolean>(false);
    // We need to increment this every time we create a connection in order to properly reset the state.
    const [ newConnectionKey, incrementConnectionKey ] = useReducer<number, undefined>(n => n+1, 0);
    const [ updatingConnection, isUpdatingConnection ] = useState<boolean>(false);

    const clearCurrentError = () => {
        setError(error => error?.forPrevious ? error : null);
    }

    useEffect(() => {
        const fetchConnections = retry(
            () => {
                return api.getConnectionsForService<ConnectionType>(roomId, type);
            },
            MAX_CONNECTION_FETCH_ATTEMPTS,
            1000,
            (ex) => ex instanceof BridgeAPIError && ex.errcode === ErrCode.NotInRoom
        );

        fetchConnections.then((res) => {
            setCanEditRoom(res.canEdit);
            setConnections(res.connections);
            clearCurrentError();
        }).catch(ex => {
            setError({
                header: "Failed to fetch existing connections",
                message: ex instanceof BridgeAPIError ? ex.message : "Unknown error"
            });
        })
    }, [api, roomId, type, newConnectionKey]);

    const canSendMessages = connections?.every(c => c.canSendMessages) ?? true;

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
        isUpdatingConnection(true);
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
        }).finally(() => {
            isUpdatingConnection(false);
        });
    }, [api, roomId, connectionEventType]);

    return <Card>
        <main>
            { showHeader &&
                <header className={style.header}>
                    <img alt="" className={darkHeaderImg ? style.invert : undefined} src={headerImg} />
                    <h1>{text.header}</h1>
                </header>
            }
            {
                error &&
                <Alert type="critical" text={error.header || error.isWarning ? "Warning" : "Error"}>{error.message}</Alert>
            }
            { !canSendMessages && canEditRoom &&
                <Alert type="info" title={"Misconfigured permissions"}>
                    This room does not permit the bot to send messages.
                    Please go to the room settings in your client and adjust permissions.
                </Alert>
            }
            { canEditRoom && <section>
                <h2>{text.createNew}</h2>
                {serviceConfig && <ConnectionConfigComponent
                    key={newConnectionKey}
                    serviceConfig={serviceConfig}
                    onSave={handleSaveOnCreation}
                    loginLabel={text.login}
                    showAuthPrompt={showAuthPrompt}
                    isUpdating={updatingConnection}
                />}
            </section>}
            { !error && connections === null && <LoadingSpinner /> }
            { !!connections?.length && <section>
                <h2>{ canEditRoom ? text.listCanEdit : text.listCantEdit }</h2>
                { serviceConfig && connections?.map(c => <ListItem key={c.id} text={listItemName(c)}>
                    <ConnectionConfigComponent
                        serviceConfig={serviceConfig}
                        existingConnection={c}
                        onSave={(config) => {
                            isUpdatingConnection(true);
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
                            }).finally(() => {
                                isUpdatingConnection(false);
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
                        isUpdating={updatingConnection}
                    />
                </ListItem>)
            }
        </section>}
        </main>
    </Card>;
};
