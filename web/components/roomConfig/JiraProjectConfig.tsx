import { FunctionComponent, createRef } from "preact";
import { useState, useCallback, useEffect, useMemo } from "preact/hooks";
import { BridgeAPI, BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { ErrCode } from "../../../src/api";
import { JiraProjectConnectionState, JiraProjectResponseItem, JiraProjectConnectionProjectTarget, JiraTargetFilter, JiraProjectConnectionInstanceTarget, JiraProjectConnectionTarget } from "../../../src/Connections/JiraProject";
import { InputField, ButtonSet, Button, ErrorPane } from "../elements";
import { EventHookCheckbox } from '../elements/EventHookCheckbox';
import JiraIcon from "../../icons/jira.png";

const EventType = "uk.half-shot.matrix-hookshot.jira.project";

function getInstancePrettyName(instance: JiraProjectConnectionInstanceTarget) {
    return `${instance.name} (${instance.url})`;
}

function getProjectPrettyName(project: JiraProjectConnectionProjectTarget) {
    return `${project.key} (${project.name})`;
}

const ConnectionSearch: FunctionComponent<{api: BridgeAPI, onPicked: (state: JiraProjectConnectionState) => void}> = ({api, onPicked}) => {
    const [filter, setFilter] = useState<JiraTargetFilter>({});
    const [results, setResults] = useState<JiraProjectConnectionProjectTarget[]|null>(null);
    const [instances, setInstances] = useState<JiraProjectConnectionInstanceTarget[]|null>(null);
    const [isConnected, setIsConnected] = useState<boolean|null>(null);
    const [debounceTimer, setDebounceTimer] = useState<number|undefined>(undefined);
    const [currentProject, setCurrentProject] = useState<{url: string, name: string}|null>(null);
    const [searchError, setSearchError] = useState<string|null>(null);

    const searchFn = useCallback(async() => {
        try {
            const res = await api.getConnectionTargets<JiraProjectConnectionTarget>(EventType, filter);
            setIsConnected(true);
            if (!filter.instanceName) {
                setInstances(res as JiraProjectConnectionInstanceTarget[]);
                if (res[0]) {
                    setFilter({instanceName: res[0].name});
                }
            } else {
                setResults(res as JiraProjectConnectionProjectTarget[]);
            }
        } catch (ex: any) {
            if (ex?.errcode === ErrCode.ForbiddenUser) {
                setIsConnected(false);
                setInstances([]);
            } else {
                setSearchError("There was an error fetching search results.");
                // Rather than raising an error, let's just log and let the user retry a query.
                console.warn(`Failed to get connection targets from query:`, ex);
            }
        }
    }, [api, filter]);

    const updateSearchFn = useCallback((evt: InputEvent) => {
        const project = (evt.target as HTMLOptionElement).value;
        const hasResult = results?.find(n =>
            project === n.state.url ||
            project === getProjectPrettyName(n)
        );
        if (hasResult) {
            onPicked(hasResult.state);
            setCurrentProject({
                url: hasResult.state.url,
                name: getProjectPrettyName(hasResult),
            });
        }
    }, [onPicked, results]);

    useEffect(() => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        // Browser types
        setDebounceTimer(setTimeout(searchFn, 500) as unknown as number);
        return () => {
            clearTimeout(debounceTimer);
        }
        // Things break if we depend on the thing we are clearing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchFn, filter]);

    const onInstancePicked = useCallback((evt: InputEvent) => {
        // Reset the search string.
        setFilter({
            instanceName: (evt.target as HTMLSelectElement).selectedOptions[0].value,
        });
    }, []);

    const instanceListResults = useMemo(
        () => instances?.map(i => <option key={i.url} value={i.url}>{getInstancePrettyName(i)}</option>),
        [instances]
    );

    const projectListResults = useMemo(
        () => results?.map(i => <option key={i.key} value={i.state.url}>{getProjectPrettyName(i)}</option>),
        [results]
    );


    return <div>
        {isConnected === null && <p> Loading JIRA connection. </p>}
        {isConnected === false && <p> You are not logged into JIRA. </p>}
        {isConnected === true && instances?.length === 0 && <p> You are not connected to any JIRA instances. </p>}
        {searchError && <ErrorPane> {searchError} </ErrorPane> }
        <InputField visible={!!instances?.length} label="JIRA Instance" noPadding={true}>
            <select onChange={onInstancePicked}>
                {instanceListResults}
            </select>
        </InputField>
        <InputField visible={!!instances?.length} label="Project" noPadding={true}>
            <small>{currentProject?.url}</small>
            <input onChange={updateSearchFn} value={currentProject?.name} list="jira-projects" type="text" />
            <datalist id="jira-projects">
                {projectListResults}
            </datalist>
        </InputField>
    </div>;
}

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, JiraProjectResponseItem, JiraProjectConnectionState>> = ({api, existingConnection, onSave, onRemove }) => {
    const [allowedEvents, setAllowedEvents] = useState<string[]>(existingConnection?.config.events || ['issue_created']);

    const toggleEvent = useCallback((evt: Event) => {
        const key = (evt.target as HTMLElement).getAttribute('x-event-name');
        if (key) {
            setAllowedEvents(allowedEvents => (
                allowedEvents.includes(key) ? allowedEvents.filter(k => k !== key) : [...allowedEvents, key]
            ));
        }
    }, []);
    const [newConnectionState, setNewConnectionState] = useState<JiraProjectConnectionState|null>(null);

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const commandPrefixRef = createRef<HTMLInputElement>();
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit || !existingConnection && !newConnectionState) {
            return;
        }
        const state = existingConnection?.config || newConnectionState;
        if (state) {
            onSave({
                ...(state),
                events: allowedEvents as any[],
                commandPrefix: commandPrefixRef.current?.value || commandPrefixRef.current?.placeholder,
            });
        }
    }, [canEdit, existingConnection, newConnectionState, allowedEvents, commandPrefixRef, onSave]);

    return <form onSubmit={handleSave}>
        {!existingConnection && <ConnectionSearch api={api} onPicked={setNewConnectionState} />}
        <InputField visible={!!existingConnection || !!newConnectionState} label="Command Prefix" noPadding={true}>
            <input ref={commandPrefixRef} type="text" value={existingConnection?.config.commandPrefix} placeholder="!jira" />
        </InputField>
        <InputField visible={!!existingConnection || !!newConnectionState} label="Events" noPadding={true}>
            <p>Choose which event should send a notification to the room</p>
            <ul>
                Issues
                <ul>
                    <EventHookCheckbox enabledHooks={allowedEvents} hookEventName="issue_created" onChange={toggleEvent}>Created</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={allowedEvents} hookEventName="issue_updated" onChange={toggleEvent}>Updated</EventHookCheckbox>
                </ul>
                Versions
                <ul>
                    <EventHookCheckbox enabledHooks={allowedEvents} hookEventName="version_created" onChange={toggleEvent}>Created</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={allowedEvents} hookEventName="version_updated" onChange={toggleEvent}>Updated</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={allowedEvents} hookEventName="version_released" onChange={toggleEvent}>Released</EventHookCheckbox>
                </ul>
            </ul>
        </InputField>
        <ButtonSet>
            { canEdit && <Button type="submit" disabled={!existingConnection && !newConnectionState}>{ existingConnection ? "Save" : "Add project" }</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemove}>Remove project</Button>}
        </ButtonSet>
    </form>;
};

const RoomConfigText = {
    header: 'JIRA Projects',
    createNew: 'Add new JIRA Project',
    listCanEdit: 'Your connected projects',
    listCantEdit: 'Connected projects',
};

const RoomConfigListItemFunc = (c: JiraProjectResponseItem) => c.config.url;

export const JiraProjectConfig: BridgeConfig = ({ api, roomId }) => {
    return <RoomConfig<never, JiraProjectResponseItem, JiraProjectConnectionState>
        headerImg={JiraIcon}
        api={api}
        roomId={roomId}
        type="jira"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionEventType={EventType}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};