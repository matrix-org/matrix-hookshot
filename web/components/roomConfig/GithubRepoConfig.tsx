import { h, FunctionComponent, createRef } from "preact";
import { useState, useCallback, useEffect, useMemo } from "preact/hooks";
import { BridgeAPI, BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { ErrCode } from "../../../src/api";
import { GitHubRepoConnectionState, GitHubRepoResponseItem, GitHubRepoConnectionTarget } from "../../../src/Connections/GithubRepo";
import { InputField, ButtonSet, Button, ErrorPane } from "../elements";
import GitHubIcon from "../../icons/github.png";

const EventType = "uk.half-shot.matrix-hookshot.github.repository";

const ConnectionSearch: FunctionComponent<{api: BridgeAPI, onPicked: (state: GitHubRepoConnectionState) => void}> = ({api, onPicked}) => {
    const [filter, setFilter] = useState<string>("");
    const [results, setResults] = useState<GitHubRepoConnectionTarget[]|null>(null);
    const [isConnected, setIsConnected] = useState<boolean|null>(null);
    const [debounceTimer, setDebounceTimer] = useState<number|undefined>(undefined);
    const [currentRepo, setCurrentRepo] = useState<string|null>(null);
    const [searchError, setSearchError] = useState<string|null>(null);

    const searchFn = useCallback(async() => {
        try {
            const res = await api.getConnectionTargets<GitHubRepoConnectionTarget>(EventType);
            setIsConnected(true);
            setResults(res);
        } catch (ex) {
            if (ex?.errcode === ErrCode.ForbiddenUser) {
                setIsConnected(false);
            } else {
                setSearchError("There was an error fetching search results.");
                // Rather than raising an error, let's just log and let the user retry a query.
                console.warn(`Failed to get connection targets from query:`, ex);
            }
        }
    }, [api, filter]);

    const updateSearchFn = useCallback((evt: InputEvent) => {
        setFilter((evt.target as HTMLInputElement).value);
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
    }, [searchFn, filter, isConnected]);

    useEffect(() => {
        const hasResult = results?.find(n => n.name === filter);
        if (hasResult) {
            onPicked(hasResult.state);
            setCurrentRepo(hasResult.state.repo);
        }
    }, [onPicked, results, filter]);

    const repoListResults = useMemo(
        () => results?.map(i => <option repo={i.state.repo} value={i.name} key={i.name} />),
        [results]
    );


    return <div>
        {isConnected === null && <p> Loading GitHub connection. </p>}
        {isConnected === false && <p> You are not logged into GitHub. </p>}
        {searchError && <ErrorPane> {searchError} </ErrorPane> }
        <InputField visible={!!isConnected} label="Repository" noPadding={true}>
            <small>{currentRepo ?? ""}</small>
            <input onChange={updateSearchFn} value={filter} list="github-repos" type="text" />
            <datalist id="github-repos">
                {repoListResults}
            </datalist>
        </InputField>
    </div>;
}

const EventCheckbox: FunctionComponent<{
    ignoredHooks: string[],
    onChange: (evt: HTMLInputElement) => void,
    eventName: string,
    parentEvent?: string,
}> = ({ignoredHooks, onChange, eventName, parentEvent, children}) => {
    return <li>
        <label>
            <input
            disabled={parentEvent && ignoredHooks.includes(parentEvent)}
            type="checkbox"
            x-event-name={eventName}
            checked={!ignoredHooks.includes(eventName)}
            onChange={onChange} />
            { children }
        </label>
    </li>;
};

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, GitHubRepoResponseItem, GitHubRepoConnectionState>> = ({api, existingConnection, onSave, onRemove }) => {
    const [ignoredHooks, setIgnoredHooks] = useState<string[]>(existingConnection?.config.ignoreHooks || []);

    const toggleIgnoredHook = useCallback(evt => {
        const key = (evt.target as HTMLElement).getAttribute('x-event-name');
        if (key) {
            setIgnoredHooks(ignoredHooks => (
                ignoredHooks.includes(key) ? ignoredHooks.filter(k => k !== key) : [...ignoredHooks, key]
            ));
        }
    }, []);
    const [connectionState, setConnectionState] = useState<GitHubRepoConnectionState|null>(null);

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
    const commandPrefixRef = createRef<HTMLInputElement>();
    const handleSave = useCallback((evt: Event) => {
        evt.preventDefault();
        if (!canEdit || !existingConnection && !connectionState) {
            return;
        }
        const state = existingConnection?.config || connectionState;
        if (state) {
            onSave({
                ...(state),
                ignoreHooks: ignoredHooks as any[],
                commandPrefix: commandPrefixRef.current?.value,
            });
        }
    }, [canEdit, existingConnection, connectionState, ignoredHooks, commandPrefixRef, onSave]);

    return <form onSubmit={handleSave}>
        {!existingConnection && <ConnectionSearch api={api} onPicked={setConnectionState} />}
        <InputField visible={!!existingConnection} label="Repository" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.repo} />
        </InputField>
        <InputField visible={!!existingConnection || !!connectionState} ref={commandPrefixRef} label="Command Prefix" noPadding={true}>
            <input type="text" value={existingConnection?.config.commandPrefix} placeholder="!gh" />
        </InputField>
        <InputField visible={!!existingConnection || !!connectionState} label="Events" noPadding={true}>
            <p>Choose which event should send a notification to the room</p>
            <ul>
                <EventCheckbox ignoredHooks={ignoredHooks} eventName="issue" onChange={toggleIgnoredHook}>Issues</EventCheckbox>
                <ul>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="issue" eventName="issue.created" onChange={toggleIgnoredHook}>Created</EventCheckbox>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="issue" eventName="issue.changed" onChange={toggleIgnoredHook}>Changed</EventCheckbox>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="issue" eventName="issue.edited" onChange={toggleIgnoredHook}>Edited</EventCheckbox>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="issue" eventName="issue.labeled" onChange={toggleIgnoredHook}>Labeled</EventCheckbox>
                </ul>
                <EventCheckbox ignoredHooks={ignoredHooks} eventName="pull_request" onChange={toggleIgnoredHook}>Pull requests</EventCheckbox>
                <ul>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="pull_request" eventName="pull_request.opened" onChange={toggleIgnoredHook}>Opened</EventCheckbox>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="pull_request" eventName="pull_request.closed" onChange={toggleIgnoredHook}>Closed</EventCheckbox>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="pull_request" eventName="pull_request.merged" onChange={toggleIgnoredHook}>Merged</EventCheckbox>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="pull_request" eventName="pull_request.ready_for_review" onChange={toggleIgnoredHook}>Ready for review</EventCheckbox>
                    <EventCheckbox ignoredHooks={ignoredHooks} parentEvent="pull_request" eventName="pull_request.reviewed" onChange={toggleIgnoredHook}>Reviewed</EventCheckbox>
                </ul>
                <EventCheckbox ignoredHooks={ignoredHooks} eventName="release" onChange={toggleIgnoredHook}>Releases</EventCheckbox>
            </ul>
        </InputField>
        <ButtonSet>
            { canEdit && <Button type="submit" disabled={!existingConnection && !connectionState}>{ existingConnection ? "Save" : "Add repository" }</Button>}
            { canEdit && existingConnection && <Button intent="remove" onClick={onRemove}>Remove repository</Button>}
        </ButtonSet>
    </form>;
};

const RoomConfigText = {
    header: 'GitHub Repositories',
    createNew: 'Add new GitHub repository',
    listCanEdit: 'Your connected repositories',
    listCantEdit: 'Connected repositories',
};

const RoomConfigListItemFunc = (c: GitHubRepoResponseItem) => c.config.repo;

export const GithubRepoConfig: BridgeConfig = ({ api, roomId }) => {
    return <RoomConfig<never, GitHubRepoResponseItem, GitHubRepoConnectionState>
        headerImg={GitHubIcon}
        api={api}
        roomId={roomId}
        type="github"
        text={RoomConfigText}
        listItemName={RoomConfigListItemFunc}
        connectionEventType={EventType}
        connectionConfigComponent={ConnectionConfiguration}
    />;
};