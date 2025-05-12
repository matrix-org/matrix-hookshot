import { FunctionComponent, createRef } from "preact";
import { useState, useCallback, useContext, useEffect, useMemo } from "preact/hooks";
import { BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import type { OpenProjectConnectionRepoTarget, OpenProjectConnectionState, OpenProjectResponseItem, OpenProjectServiceConfig } from "../../../src/Connections/OpenProjectConnection";
import { InputField, ButtonSet, Button } from "../elements";
import { EventHookList } from '../elements/EventHookCheckbox';
import Icon from "../../icons/openproject.png";
import { GetAuthResponse } from "../../../src/Widgets/BridgeWidgetInterface";
import { BridgeContext } from "../../context";
import { ServiceAuth } from "./Auth";
import { ProjectSearch } from "../elements/ConnectionSearch";
import { DropItem } from "../elements/DropdownSearch";

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

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<OpenProjectServiceConfig, OpenProjectResponseItem, OpenProjectConnectionState>> = ({serviceConfig, loginLabel, showAuthPrompt, existingConnection, onSave, onRemove, isUpdating }) => {
    const [allowedEvents, setAllowedEvents] = useState<string[]>(existingConnection?.config.events || ['work_package:created']);
    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const commandPrefixRef = createRef<HTMLInputElement>();
    const api = useContext(BridgeContext).bridgeApi;
    const [authedResponse, setAuthResponse] = useState<GetAuthResponse|null>(null);
    const [newConnectionState, setNewConnectionState] = useState<OpenProjectConnectionState|null>(null);

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
    const setInstance = useCallback((instance: string, value: string) => {
        setNewConnectionState({
            url: `${serviceConfig.baseUrl}projects/${value}`,
            events: ['work_package:created']
        })
    },[setNewConnectionState]);
    const clearInstance = useCallback(() => setNewConnectionState(null), [setNewConnectionState]);

    const checkAuth = useCallback(() => {
        api.getAuth("openproject").then((res) => {
            setAuthResponse(res);
        }).catch(ex => {
            console.warn("Could not check authed state, assuming yes", ex);
            setAuthResponse({
                authenticated: true,
                user: {
                    name: 'Unknown'
                }
            });
        })
    }, [api]);

    useEffect(() => {
        if (!showAuthPrompt) {
            return;
        }
        checkAuth();
    }, [showAuthPrompt, checkAuth])

    const consideredAuthenticated = (authedResponse?.authenticated || !showAuthPrompt);

    const getProjects = useMemo(() => async (_instance: string, search: string, abortController: AbortController) => {
        const targets = await api.getConnectionTargets<OpenProjectConnectionRepoTarget>(EventType, {
            ...(search && { search }),
        }, abortController);
        return targets.map(repo => ({
            title: repo.name,
            description: repo.description,
            value: repo.id.toString(),
        } satisfies DropItem));
    }, [api]);

    return <form onSubmit={handleSave}>
        {authedResponse && <ServiceAuth onAuthSucceeded={checkAuth} authState={authedResponse} service="openproject" loginLabel={loginLabel} />}
        {consideredAuthenticated && !newConnectionState && <ProjectSearch serviceName="openproject" currentInstance="main" getProjects={getProjects} onClear={clearInstance} onPicked={setInstance} />}
        <InputField visible={!!existingConnection || !!newConnectionState} label="Project">
            {existingConnection?.config.url}
            {newConnectionState?.url}
        </InputField>
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
    return <RoomConfig<OpenProjectServiceConfig, OpenProjectResponseItem, OpenProjectConnectionState>
        headerImg={Icon}
        showHeader={showHeader}
        roomId={roomId}
        showAuthPrompt
        type="openproject"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionEventType={EventType}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};

export default JiraProjectConfig;
