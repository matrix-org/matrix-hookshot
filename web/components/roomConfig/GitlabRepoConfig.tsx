import GitLabIcon from "../../icons/gitlab.png";
import { BridgeAPI, BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { EventHookCheckbox } from '../elements/EventHookCheckbox';
import { GitLabRepoConnectionState, GitLabRepoResponseItem, GitLabTargetFilter, GitLabRepoConnectionTarget, GitLabRepoConnectionProjectTarget, GitLabRepoConnectionInstanceTarget } from "../../../src/Connections/GitlabRepo";
import { InputField, ButtonSet, Button, ErrorPane } from "../elements";
import { h, FunctionComponent, createRef } from "preact";
import { useState, useCallback, useEffect, useMemo } from "preact/hooks";

const EventType = "uk.half-shot.matrix-hookshot.gitlab.repository";

const ConnectionSearch: FunctionComponent<{api: BridgeAPI, onPicked: (state: GitLabRepoConnectionState) => void}> = ({api, onPicked}) => {
    const [filter, setFilter] = useState<GitLabTargetFilter>({});
    const [results, setResults] = useState<GitLabRepoConnectionProjectTarget[]|null>(null);
    const [instances, setInstances] = useState<GitLabRepoConnectionInstanceTarget[]|null>(null);
    const [debounceTimer, setDebounceTimer] = useState<number|undefined>(undefined);
    const [currentProjectPath, setCurrentProjectPath] = useState<string|null>(null);
    const [searchError, setSearchError] = useState<string|null>(null);

    const searchFn = useCallback(async() => {
        try {
            const res = await api.getConnectionTargets<GitLabRepoConnectionTarget>(EventType, filter);
            if (!filter.instance) {
                setInstances(res as GitLabRepoConnectionInstanceTarget[]);
                if (res[0]) {
                    setFilter({instance: res[0].name, search: ""});
                }
            } else {
                setResults(res as GitLabRepoConnectionProjectTarget[]);
            }
        } catch (ex) {
            setSearchError("There was an error fetching search results.");
            // Rather than raising an error, let's just log and let the user retry a query.
            console.warn(`Failed to get connection targets from query:`, ex);
        }
    }, [api, filter]);

    const updateSearchFn = useCallback((evt: InputEvent) => {
        setFilter(filterState => ({...filterState, search: (evt.target as HTMLInputElement).value }));
    }, [setFilter]);

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
    }, [searchFn, filter, instances]);

    useEffect(() => {
        const hasResult = results?.find(n => n.name === filter.search);
        if (hasResult) {
            onPicked(hasResult.state);
            setCurrentProjectPath(hasResult.state.path);
        }
    }, [onPicked, results, filter]);

    const onInstancePicked = useCallback((evt: InputEvent) => {
        // Reset the search string.
        setFilter({
            instance: (evt.target as HTMLSelectElement).selectedOptions[0].value,
            search: ""
        });
    }, []);

    const instanceListResults = useMemo(
        () => instances?.map(i => <option key={i.name}>{i.name}</option>),
        [instances]
    );

    const projectListResults = useMemo(
        () => results?.map(i => <option path={i.state.path} value={i.name} key={i.name} />),
        [results]
    );


    return <div>
        {instances === null && <p> Loading GitLab instances. </p>}
        {instances?.length === 0 && <p> You are not logged into any GitLab instances. </p>}
        {searchError && <ErrorPane> {searchError} </ErrorPane> }
        <InputField visible={!!instances?.length} label="GitLab Instance" noPadding={true}>
            <select onChange={onInstancePicked}>
                {instanceListResults}
            </select>
        </InputField>
        <InputField visible={!!instances?.length} label="Project" noPadding={true}>
            <small>{currentProjectPath ?? ""}</small>
            <input onChange={updateSearchFn} value={filter.search} list="gitlab-projects" type="text" />
            <datalist id="gitlab-projects">
                {projectListResults}
            </datalist>
        </InputField>
    </div>;
}

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, GitLabRepoResponseItem, GitLabRepoConnectionState>> = ({api, existingConnection, onSave, onRemove }) => {
    const [enabledHooks, setEnabledHooks] = useState<string[]>(existingConnection?.config.enableHooks || []);

    const toggleEnabledHook = useCallback((evt: any) => {
        const key = (evt.target as HTMLElement).getAttribute('x-event-name');
        if (key) {
            setEnabledHooks(enabledHooks => (
                enabledHooks.includes(key) ? enabledHooks.filter(k => k !== key) : [...enabledHooks, key]
            ));
        }
    }, []);

    const [newInstanceState, setNewInstanceState] = useState<GitLabRepoConnectionState|null>(null);

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const commandPrefixRef = createRef<HTMLInputElement>();
    const includeBodyRef = createRef<HTMLInputElement>();
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit || !existingConnection && !newInstanceState) {
            return;
        }
        const state = existingConnection?.config || newInstanceState;
        if (state) {
            onSave({
                ...(state),
                enableHooks: enabledHooks as any[],
                includeCommentBody: includeBodyRef.current?.checked,
                commandPrefix: commandPrefixRef.current?.value || commandPrefixRef.current?.placeholder,
            });
        }
    }, [includeBodyRef, canEdit, existingConnection, newInstanceState, enabledHooks, commandPrefixRef, onSave]);
    
    return <form onSubmit={handleSave}>
        {!existingConnection && <ConnectionSearch api={api} onPicked={setNewInstanceState} />}
        <InputField visible={!!existingConnection} label="GitLab Instance" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.instance} />
        </InputField>
        <InputField visible={!!existingConnection} label="Project" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.path} />
        </InputField>
        <InputField visible={!!existingConnection || !!newInstanceState} label="Command Prefix" noPadding={true}>
            <input ref={commandPrefixRef} type="text" value={existingConnection?.config.commandPrefix} placeholder="!gl" />
        </InputField>
        <InputField visible={!!existingConnection || !!newInstanceState} label="Include comment bodies" noPadding={true} innerChild={true}>
            <input ref={includeBodyRef} disabled={!canEdit} type="checkbox" checked={!!existingConnection?.config.includeCommentBody} />
        </InputField>
        <InputField visible={!!existingConnection || !!newInstanceState} label="Events" noPadding={true}>
            <p>Choose which event should send a notification to the room</p>
            <ul>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="merge_request" onChange={toggleEnabledHook}>Merge requests</EventHookCheckbox>
                <ul>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.open" onChange={toggleEnabledHook}>Opened</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.close" onChange={toggleEnabledHook}>Closed</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.merge" onChange={toggleEnabledHook}>Merged</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.review" onChange={toggleEnabledHook}>Reviewed</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="merge_request" hookEventName="merge_request.ready_for_review" onChange={toggleEnabledHook}>Ready for review</EventHookCheckbox>
                </ul>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="push" onChange={toggleEnabledHook}>Pushes</EventHookCheckbox>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="tag_push" onChange={toggleEnabledHook}>Tag pushes</EventHookCheckbox>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="wiki" onChange={toggleEnabledHook}>Wiki page updates</EventHookCheckbox>
                <EventHookCheckbox enabledHooks={enabledHooks} hookEventName="release" onChange={toggleEnabledHook}>Releases</EventHookCheckbox>
            </ul>
        </InputField>
        <ButtonSet>
            { canEdit && <Button type="submit" disabled={!existingConnection && !newInstanceState}>{ existingConnection ? "Save" : "Add project" }</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemove}>Remove project</Button>}
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

export const GitlabRepoConfig: BridgeConfig = ({ api, roomId }) => {
    return <RoomConfig<never, GitLabRepoResponseItem, GitLabRepoConnectionState>
        headerImg={GitLabIcon}
        api={api}
        roomId={roomId}
        type="gitlab"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionEventType={EventType}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};