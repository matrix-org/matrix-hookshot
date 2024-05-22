import GitLabIcon from "../../icons/gitlab.png";
import { BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { EventHookCheckbox } from '../elements/EventHookCheckbox';
import { GitLabRepoConnectionState, GitLabRepoResponseItem, GitLabRepoConnectionProjectTarget, GitLabRepoConnectionInstanceTarget } from "../../../src/Connections/GitlabRepo";
import { InputField, ButtonSet, Button } from "../elements";
import { FunctionComponent, createRef } from "preact";
import { useState, useCallback, useMemo, useContext } from "preact/hooks";
import { DropItem } from "../elements/DropdownSearch";
import { ConnectionSearch } from "../elements/ConnectionSearch";
import { BridgeContext } from "../../context";

const EventType = "uk.half-shot.matrix-hookshot.gitlab.repository";
const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, GitLabRepoResponseItem, GitLabRepoConnectionState>> = ({existingConnection, onSave, onRemove, isUpdating }) => {
    const [enabledHooks, setEnabledHooks] = useState<string[]>(existingConnection?.config.enableHooks || []);
    const api = useContext(BridgeContext).bridgeApi;

    const toggleEnabledHook = useCallback((evt: any) => {
        const key = (evt.target as HTMLElement).getAttribute('x-event-name');
        if (key) {
            setEnabledHooks(enabledHooks => (
                enabledHooks.includes(key) ? enabledHooks.filter(k => k !== key) : [...enabledHooks, key]
            ));
        }
    }, []);

    const [newConnectionState, setNewConnectionState] = useState<GitLabRepoConnectionState|null>(null);

    const canEdit = useMemo(() =>!existingConnection || (existingConnection?.canEdit ?? false), [existingConnection]);
    const commandPrefixRef = createRef<HTMLInputElement>();
    const includeBodyRef = createRef<HTMLInputElement>();
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit || !existingConnection && !newConnectionState) {
            return;
        }
        const state = existingConnection?.config || newConnectionState;
        if (state) {
            onSave({
                ...(state),
                enableHooks: enabledHooks as any[],
                includeCommentBody: includeBodyRef.current?.checked,
                commandPrefix: commandPrefixRef.current?.value || commandPrefixRef.current?.placeholder,
            });
        }
    }, [includeBodyRef, canEdit, existingConnection, newConnectionState, enabledHooks, commandPrefixRef, onSave]);

    const getInstances = useMemo(() => async () => {
        const targets = await api.getConnectionTargets<GitLabRepoConnectionInstanceTarget>(EventType, { });
        return targets;
    }, [api]);

    const getProjects = useMemo(() => async (instance: string, search?: string, abortController?: AbortController) => {
        const targets = await api.getConnectionTargets<GitLabRepoConnectionProjectTarget>(EventType, {
            instance,
            ...(search && { search })
        }, abortController);
        return targets.map(project => ({
            description: project.description,
            imageSrc: project.avatar_url,
            title: project.name,
            value: project.state.path,
        } as DropItem));
    }, [api]);

    const setInstance = useCallback((instance: string, path: string) => {
        setNewConnectionState({
            instance,
            path,
        })
    },[setNewConnectionState]);
    const clearInstance = useCallback(() => setNewConnectionState(null), [setNewConnectionState]);

    return <form onSubmit={handleSave}>
        {!existingConnection && <ConnectionSearch
            serviceName="GitLab"
            getInstances={getInstances}
            getProjects={getProjects}
            onPicked={setInstance}
            onClear={clearInstance}
        />}
        <InputField visible={!!existingConnection} label="GitLab Instance" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.instance} />
        </InputField>
        <InputField visible={!!existingConnection} label="Project" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.path} />
        </InputField>
        <InputField visible={!!existingConnection || !!newConnectionState} label="Command Prefix" noPadding={true}>
            <input ref={commandPrefixRef} type="text" value={existingConnection?.config.commandPrefix} placeholder="!gl" />
        </InputField>
        <InputField visible={!!existingConnection || !!newConnectionState} label="Include comment bodies" noPadding={true} innerChild={true}>
            <input ref={includeBodyRef} disabled={!canEdit} type="checkbox" checked={!!existingConnection?.config.includeCommentBody} />
        </InputField>
        <InputField visible={!!existingConnection || !!newConnectionState} label="Events" noPadding={true}>
            <p>Choose which event should send a notification to the room</p>
            <ul>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="merge_request" onChange={toggleEnabledHook}>Merge requests</EventHookCheckbox>
                <ul>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.open" onChange={toggleEnabledHook}>Opened</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.reopen" onChange={toggleEnabledHook}>Reopened</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.close" onChange={toggleEnabledHook}>Closed</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.merge" onChange={toggleEnabledHook}>Merged</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.review" onChange={toggleEnabledHook}>Completed review</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.review.individual" onChange={toggleEnabledHook}>Single review</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.ready_for_review" onChange={toggleEnabledHook}>Ready for review</EventHookCheckbox>
                </ul>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="push" onChange={toggleEnabledHook}>Pushes</EventHookCheckbox>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="tag_push" onChange={toggleEnabledHook}>Tag pushes</EventHookCheckbox>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="wiki" onChange={toggleEnabledHook}>Wiki page updates</EventHookCheckbox>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="release" onChange={toggleEnabledHook}>Releases</EventHookCheckbox>
            </ul>
        </InputField>
        <ButtonSet>
            { canEdit && <Button type="submit" disabled={isUpdating || !existingConnection && !newConnectionState}>{ existingConnection ? "Save" : "Add project" }</Button>}
            { canEdit && existingConnection && <Button disabled={isUpdating} intent="remove" onClick={onRemove}>Remove project</Button>}
        </ButtonSet>
    </form>;
};

const RoomConfigText = {
    header: 'GitLab Projects',
    createNew: 'Add new GitLab project',
    listCanEdit: 'Your connected projects',
    listCantEdit: 'Connected projects',
};

const RoomConfigListItemFunc = (c: GitLabRepoResponseItem) => c.config.path;

export const GitlabRepoConfig: BridgeConfig = ({ roomId, showHeader }) => {
    return <RoomConfig<never, GitLabRepoResponseItem, GitLabRepoConnectionState>
        headerImg={GitLabIcon}
        showHeader={showHeader}
        roomId={roomId}
        type="gitlab"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionEventType={EventType}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};
