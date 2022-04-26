import { h, FunctionComponent, createRef } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";
import BridgeAPI from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { GitLabRepoConnectionState, GitLabRepoResponseItem, GitLabTargetFilter, GitLabRepoConnectionTarget, GitLabRepoConnectionProjectTarget, GitLabRepoConnectionInstanceTarget } from "../../../src/Connections/GitlabRepo";
import InputField from "../InputField";
import ButtonSet from "../ButtonSet";
import { Button } from "../Button";

const EventType = "uk.half-shot.matrix-hookshot.gitlab.repository";

const ConnectionSearch: FunctionComponent<{api: BridgeAPI, onPicked: (state: GitLabRepoConnectionState) => void}> = ({api, onPicked}) => {
    const [filter, setFilter] = useState<GitLabTargetFilter>({});
    const [results, setResults] = useState<GitLabRepoConnectionProjectTarget[]|null>(null);
    const [instances, setInstances] = useState<GitLabRepoConnectionInstanceTarget[]|null>(null);
    const [debounceTimer, setDebounceTimer] = useState<number>(null);
    const [currentProjectPath, setCurrentProjectPath] = useState<string|null>(null);

    const searchFn = useCallback(() => {
        api.getConnectionTargets<GitLabRepoConnectionTarget>(EventType, filter).then(res => {
            if (!filter.instance) {
                setInstances(res);
                if (res[0]) {
                    setFilter({instance: res[0].name});
                }
            } else {
                setResults(res as GitLabRepoConnectionProjectTarget[]);
            }
        });
    }, [api, filter]);

    const updateSearchFn = useCallback((evt: InputEvent) => {
        setFilter({...filter, search: (evt.target as HTMLInputElement).value });
    }, [filter, setFilter]);

    useEffect(() => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        // Browser types
        setDebounceTimer(setTimeout(searchFn, 500) as unknown as number);
        // Things break if we depend on the thing we are clearing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setDebounceTimer, searchFn, filter, instances]);

    useEffect(() => {
        const hasResult = results?.find(n => n.name === filter.search);
        if (hasResult) {
            onPicked(hasResult.state);
            setCurrentProjectPath(hasResult.state.path);
        }
    }, [onPicked, results, filter, setCurrentProjectPath]);



    return <div>
        {instances === null && <p> Loading GitLab instances. </p>}
        {instances?.length === 0 && <p> You are not logged into any GitLab instances. </p>}
        <InputField visible={instances?.length > 0} label="GitLab Instance" noPadding={true}>
            {/*TODO: on change required here*/}
            <select>
                {instances?.map(i => <option key={i.name}>{i.name}</option>)}
            </select>
        </InputField>
        <InputField visible={instances?.length > 0} label="Project" noPadding={true}>
            <small>{currentProjectPath ?? ""}</small>
            <input onChange={updateSearchFn} list="gitlab-projects" type="text" />
            <datalist id="gitlab-projects">
                {results?.map(i => <option path={i.state.path} value={i.name} key={i.name} />)}
            </datalist>
        </InputField>
    </div>;
}

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<unknown, GitLabRepoResponseItem, GitLabRepoConnectionState>> = ({api, serviceConfig, existingConnection, onSave, onRemove }) => {
    const [ignoredHooks, setIgnoredHooks] = useState<string[]>(existingConnection?.config.ignoreHooks || []);
    const setIgnoredHook = useCallback(evt => {
        const key = (evt.target as HTMLElement).getAttribute('x-event-name');
        if (ignoredHooks.includes(key)) {
            setIgnoredHooks(ignoredHooks.filter(k => k !== key));
        } else {
            setIgnoredHooks([...ignoredHooks, key]);
        }
    }, [ignoredHooks, setIgnoredHooks]);
    const [newInstanceState, setNewInstanceState] = useState<GitLabRepoConnectionState|null>(null);



    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const commandPrefixRef = createRef<HTMLInputElement>();

    const onSaveCb = useCallback(() => {
        onSave({
            ...(existingConnection?.config || newInstanceState),
            ignoreHooks: ignoredHooks as any[],
            commandPrefix: commandPrefixRef.current.value,
        });
    }, [existingConnection, newInstanceState, ignoredHooks, commandPrefixRef, onSave]);
    
    return <div>
        {!existingConnection && <ConnectionSearch api={api} onPicked={setNewInstanceState} />}
        <InputField visible={!!existingConnection} label="GitLab Instance" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.instance} />
        </InputField>
        <InputField visible={!!existingConnection} label="Project" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.path} />
        </InputField>
        <InputField visible={!!existingConnection || !!newInstanceState} ref={commandPrefixRef} label="Command Prefix" noPadding={true}>
            <input type="text" value={existingConnection?.config.commandPrefix || "!gl"} />
        </InputField>
        <InputField visible={!!existingConnection || !!newInstanceState} label="Events" noPadding={true}>
            <p>Choose which event should send a notification to the room</p>
            <ul>
                <li><input type="checkbox" x-event-name="merge_request" checked={!ignoredHooks.includes("merge_request")} onChange={setIgnoredHook} />Merge requests</li>
                <ul>
                    <li><input disabled={ignoredHooks.includes("merge_request")} type="checkbox" x-event-name="merge_request.open" checked={!ignoredHooks.includes("merge_request.open")} onChange={setIgnoredHook} />Opened</li>
                    <li><input disabled={ignoredHooks.includes("merge_request")} type="checkbox" x-event-name="merge_request.close" checked={!ignoredHooks.includes("merge_request.close")} onChange={setIgnoredHook} />Closed</li>
                    <li><input disabled={ignoredHooks.includes("merge_request")} type="checkbox" x-event-name="merge_request.merge" checked={!ignoredHooks.includes("merge_request.merge")} onChange={setIgnoredHook} />Merged</li>
                    <li><input disabled={ignoredHooks.includes("merge_request")} type="checkbox" x-event-name="merge_request.review" checked={!ignoredHooks.includes("merge_request.review")} onChange={setIgnoredHook} />Reviews</li>
                </ul>
                <li>
                    <input type="checkbox" x-event-name="push" checked={!ignoredHooks.includes("push")} onChange={setIgnoredHook} />
                    Pushes
                </li>
                <li>
                    <input type="checkbox" x-event-name="tag_push" checked={!ignoredHooks.includes("tag_push")} onChange={setIgnoredHook} />
                    Tag pushes
                </li>
                <li>
                    <input type="checkbox" x-event-name="wiki" checked={!ignoredHooks.includes("wiki")} onChange={setIgnoredHook} />
                    Wiki page updates
                </li>
                <li>
                    <input type="checkbox" x-event-name="release" checked={!ignoredHooks.includes("release")} onChange={setIgnoredHook} />
                    New releases
                </li>
            </ul>
        </InputField>
        <ButtonSet>
            { canEdit && <Button disabled={!existingConnection && !newInstanceState} onClick={onSaveCb}>{ existingConnection ? "Save" : "Add project" }</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemove}>Remove project</Button>}
        </ButtonSet>
    </div>;
};

interface IGenericWebhookConfigProps {
    api: BridgeAPI,
    roomId: string,
}

export const GitlabRepoConfig: FunctionComponent<IGenericWebhookConfigProps> = ({ api, roomId }) => {
    return <RoomConfig
        headerImg="./icons/gitlab.png"
        api={api}
        roomId={roomId}
        type="gitlab"
        text={({
            header: 'GitLab Projects',
            createNew: 'Add new GitLab project',
            listCanEdit: 'Your connected projects',
            listCantEdit: 'Connected projects',
        })}
        listItemName={(c) => (c as GitLabRepoResponseItem).config.path}
        connectionEventType={EventType}
        connetionConfigComponent={ConnectionConfiguration}
    />;
};