import { FunctionComponent, createRef } from "preact";
import { useState, useCallback } from "preact/hooks";
import { BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import type { OpenProjectConnectionState, OpenProjectResponseItem } from "../../../src/Connections/OpenProjectConnection";
import { InputField, ButtonSet, Button } from "../elements";
import { EventHookList } from '../elements/EventHookCheckbox';
import Icon from "../../icons/openproject.png";

const EventType = "org.matrix.matrix-hookshot.openproject.project";

const OPEN_PROJECT_EVENTS = {
    'Work Packages': [{
        label: 'Created',
        eventName: 'work_package:created'
    },{
        label: 'All updates',
        eventName: 'work_package:updated'
    },{
        label: 'Assignee changed',
        eventName: 'work_package:assignee_changed'
    },{
        label: 'Responsible user changed',
        eventName: 'work_package:responsible_changed'
    },{
        label: 'Subject changed',
        eventName: 'work_package:subject_changed'
    },{
        label: 'Description changed',
        eventName: 'work_package:description_changed'
    },{
        label: 'Due date changed',
        eventName: 'work_package:duedate_changed'
    },{
        label: 'Work completed changed',
        eventName: 'work_package:workpercent_changed'
    },{
        label: 'Priority Changed',
        eventName: 'work_package:priority_changed'
    }]
}

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, OpenProjectResponseItem, OpenProjectConnectionState>> = ({existingConnection, onSave, onRemove, isUpdating }) => {
    const [allowedEvents, setAllowedEvents] = useState<string[]>(existingConnection?.config.events || ['work_package:created']);

    //const [newConnectionState, setNewConnectionState] = useState<OpenProjectConnectionState|null>(null);
    const newConnectionState = null;
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
        <EventHookList eventList={OPEN_PROJECT_EVENTS} visible={!!existingConnection || !!newConnectionState} label="Events" setAllowedEvents={setAllowedEvents} allowedEvents={allowedEvents}/>
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

const RoomConfigListItemFunc = (c: OpenProjectResponseItem) => c.config.url;

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
