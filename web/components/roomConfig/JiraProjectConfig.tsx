import { FunctionComponent, createRef } from "preact";
import { useState, useCallback, useMemo, useContext } from "preact/hooks";
import { BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { JiraProjectConnectionState, JiraProjectResponseItem, JiraProjectConnectionProjectTarget, JiraProjectConnectionInstanceTarget } from "../../../src/Connections/JiraProject";
import { InputField, ButtonSet, Button } from "../elements";
import { EventHookCheckbox } from '../elements/EventHookCheckbox';
import JiraIcon from "../../icons/jira.png";
import ConnectionSearch from "../elements/ConnectionSearch";
import { DropItem } from "../elements/DropdownSearch";
import { BridgeContext } from "../../context";

const EventType = "uk.half-shot.matrix-hookshot.jira.project";

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, JiraProjectResponseItem, JiraProjectConnectionState>> = ({existingConnection, onSave, onRemove, isUpdating }) => {
    const [allowedEvents, setAllowedEvents] = useState<string[]>(existingConnection?.config.events || ['issue_created']);
    const api = useContext(BridgeContext).bridgeApi;

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

    const getInstances = useMemo(() => async () => {
        const targets = await api.getConnectionTargets<JiraProjectConnectionInstanceTarget>(EventType, { });
        return targets;
    }, [api]);

    const getProjects = useMemo(() => async (instanceName: string, search?: string, abortController?: AbortController) => {
        const targets = await api.getConnectionTargets<JiraProjectConnectionProjectTarget>(EventType, {
            instanceName,
            ...(search && { search })
        }, abortController);
        return targets.map(project => ({
            title: project.key,
            description: project.name,
            value: project.state.url,
        } as DropItem));
    }, [api]);

    const setInstance = useCallback((instance: string, url: string) => {
        setNewConnectionState({
            url,
        })
    },[setNewConnectionState]);
    const clearInstance = useCallback(() => setNewConnectionState(null), [setNewConnectionState]);

    return <form onSubmit={handleSave}>
        {!existingConnection && <ConnectionSearch
            serviceName="JIRA"
            getInstances={getInstances}
            getProjects={getProjects}
            onPicked={setInstance}
            onClear={clearInstance}
        />}
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
            { canEdit && <Button type="submit" disabled={isUpdating || !existingConnection && !newConnectionState}>{ existingConnection ? "Save" : "Add project" }</Button>}
            { canEdit && existingConnection && <Button disabled={isUpdating} intent="remove" onClick={onRemove}>Remove project</Button>}
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

export const JiraProjectConfig: BridgeConfig = ({ roomId, showHeader }) => {
    return <RoomConfig<never, JiraProjectResponseItem, JiraProjectConnectionState>
        headerImg={JiraIcon}
        showHeader={showHeader}
        roomId={roomId}
        type="jira"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionEventType={EventType}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};
