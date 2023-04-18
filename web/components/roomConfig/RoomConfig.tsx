import { FunctionComponent } from "preact";
import { useCallback, useEffect, useReducer, useState } from "preact/hooks"
import { BridgeAPI, BridgeAPIError } from "../../BridgeAPI";
import { ErrorPane, ListItem, WarningPane, Card } from "../elements";
import style from "./RoomConfig.module.scss";
import { GetConnectionsResponseItem } from "../../../src/provisioning/api";
import { IConnectionState } from "../../../src/Connections";
import { LoadingSpinner } from '../elements/LoadingSpinner';
import { ErrCode } from "../../../src/api";
import { retry } from "../../../src/PromiseUtil";
export interface ConnectionConfigurationProps<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState> {
    serviceConfig: SConfig;
    loginLabel?: string;
    showAuthPrompt?: boolean;
    onSave: (newConfig: ConnectionState) => void,
    isUpdating: boolean,
    isMigrationCandidate?: boolean,
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
    showAuthPrompt?: boolean;
    showHeader: boolean;
    headerImg: string;
    text: IRoomConfigText;
    connectionEventType: string;
    listItemName: (c: ConnectionType) => string,
    connectionConfigComponent: FunctionComponent<ConnectionConfigurationProps<SConfig, ConnectionType, ConnectionState>>;
    migrationCandidates?: ConnectionType[];
    migrationComparator?: (migrated: ConnectionType, native: ConnectionType) => boolean;
}

const MAX_CONNECTION_FETCH_ATTEMPTS = 10;

export const RoomConfig = function<SConfig, ConnectionType extends GetConnectionsResponseItem, ConnectionState extends IConnectionState>(props: IRoomConfigProps<SConfig, ConnectionType, ConnectionState>) {
    const {
        api,
        roomId,
        type,
        showAuthPrompt = false,
        headerImg,
        showHeader,
        text,
        listItemName,
        connectionEventType,
        migrationCandidates,
        migrationComparator,
    } = props;
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

    const [ toMigrate, setToMigrate ] = useState<ConnectionType[]>([]);

    useEffect(() => {
        // produce `toMigrate` composed of `migrationCandidates` with anything already in `connections` filtered out
        // use `migrationComparator` to determine duplicates
        if (!migrationCandidates) {
            setToMigrate([]);
            return;
        }

        if (!connections || !migrationComparator) {
            setToMigrate(migrationCandidates);
            return;
        }

        setToMigrate(
            migrationCandidates.filter(cand => !connections.find(c => migrationComparator(cand, c)))
        );
    }, [ connections, migrationCandidates, migrationComparator ]);

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
            { canEditRoom && <section>
                <h2>{text.createNew}</h2>
                {serviceConfig && <ConnectionConfigComponent
                    key={newConnectionKey}
                    api={api}
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
                        api={api}
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
        { toMigrate.length > 0 && <section>
            <h2> Migrate connections </h2>
            { serviceConfig && toMigrate.map(c => <ListItem key={JSON.stringify(c)} text={listItemName(c)}>
                  <ConnectionConfigComponent
                      api={api}
                      serviceConfig={serviceConfig}
                      existingConnection={c}
                      isUpdating={updatingConnection}
                      isMigrationCandidate={true}
                      onSave={handleSaveOnCreation}
                  />
            </ListItem>) }
        </section>}
        </main>
    </Card>;
};
