import { FunctionComponent, createRef } from "preact";
import { useState, useCallback } from "preact/hooks";
import { BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import type { OpenProjectConnectionState, OpenProjectResponseItem } from "../../../src/Connections/OpenProjectConnection";
import { InputField, ButtonSet, Button } from "../elements";
import { EventHookCheckbox } from '../elements/EventHookCheckbox';
import Icon from "../../icons/openproject.png";
import { BridgeContext } from "../../context";;

const EventType = "org.matrix.matrix-hookshot.openproject.project";

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, OpenProjectResponseItem, OpenProjectConnectionState>> = ({existingConnection, onSave, onRemove, isUpdating }) => {
    const [allowedEvents, setAllowedEvents] = useState<string[]>(existingConnection?.config.events || ['work_package:created']);

    const toggleEvent = useCallback((evt: Event) => {
        const key = (evt.target as HTMLElement).getAttribute('data-event-name');
        if (key) {
            setAllowedEvents(allowedEvents => (
                allowedEvents.includes(key) ? allowedEvents.filter(k => k !== key) : [...allowedEvents, key]
            ));
        }
    }, []);
    const [newConnectionState, setNewConnectionState] = useState<OpenProjectConnectionState|null>(null);

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
        <InputField visible={!!existingConnection || !!newConnectionState} label="Command Prefix" noPadding={true}>
            <input ref={commandPrefixRef} type="text" value={existingConnection?.config.commandPrefix} placeholder="!openproject" />
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
    header: 'Open Project',
    createNew: 'Add new project',
    listCanEdit: 'Your connected projects',
    listCantEdit: 'Connected projects',
};

const RoomConfigListItemFunc = (c: OpenProjectResponseItem) => c.config.id;

const JiraProjectConfig: BridgeConfig = ({ roomId, showHeader }) => {
    return <RoomConfig<never, OpenProjectResponseItem, OpenProjectConnectionState>
        headerImg={Icon}
        showHeader={showHeader}
        roomId={roomId}
        type="openproject"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionEventType={EventType}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};

export default JiraProjectConfig;
