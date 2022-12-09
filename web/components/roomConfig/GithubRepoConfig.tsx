import GitHubIcon from "../../icons/github.png";
import { BridgeAPI, BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { ErrCode } from "../../../src/api";
import { EventHookCheckbox } from '../elements/EventHookCheckbox';
import { FunctionComponent, createRef } from "preact";
import { GitHubRepoConnectionState, GitHubRepoResponseItem, GitHubRepoConnectionRepoTarget, GitHubTargetFilter, GitHubRepoConnectionOrgTarget } from "../../../src/Connections/GithubRepo";
import { InputField, ButtonSet, Button, ErrorPane } from "../elements";
import { useState, useCallback, useEffect, useMemo } from "preact/hooks";

const EventType = "uk.half-shot.matrix-hookshot.github.repository";
const NUM_REPOS_PER_PAGE = 10;

function getRepoFullName(state: GitHubRepoConnectionState) {
    return `${state.org}/${state.repo}`;
}

const ConnectionSearch: FunctionComponent<{api: BridgeAPI, onPicked: (state: GitHubRepoConnectionState) => void}> = ({api, onPicked}) => {
    const [filter, setFilter] = useState<GitHubTargetFilter>({});
    const [results, setResults] = useState<GitHubRepoConnectionRepoTarget[]|null>(null);
    const [orgs, setOrgs] = useState<GitHubRepoConnectionOrgTarget[]|null>(null);
    const [isConnected, setIsConnected] = useState<boolean|null>(null);
    const [debounceTimer, setDebounceTimer] = useState<number|undefined>(undefined);
    const [currentRepo, setCurrentRepo] = useState<string|null>(null);
    const [searchError, setSearchError] = useState<string|null>(null);

    const searchFn = useCallback(async() => {
        try {
            const res = await api.getConnectionTargets<GitHubRepoConnectionRepoTarget>(EventType, filter);
            setIsConnected(true);
            if (!filter.orgName) {
                setOrgs(res as GitHubRepoConnectionOrgTarget[]);
                if (res[0]) {
                    setFilter({
                        orgName: res[0].name,
                        perPage: NUM_REPOS_PER_PAGE,
                    });
                }
            } else {
                setResults((prevResults: GitHubRepoConnectionRepoTarget[]|null) =>
                    !prevResults ? res : prevResults.concat(...res)
                );
                if (res.length == NUM_REPOS_PER_PAGE) {
                    setFilter({
                        ...filter,
                        page: filter.page ? filter.page + 1 : 2,
                    });
                }
            }
        } catch (ex: any) {
            if (ex?.errcode === ErrCode.ForbiddenUser) {
                setOrgs([]);
            } else if (ex?.errcode === ErrCode.AdditionalActionRequired) {
                setSearchError("You are not permitted to list GitHub installations.");
                setOrgs([]);
            } else {
                setSearchError("There was an error fetching search results.");
                // Rather than raising an error, let's just log and let the user retry a query.
                console.warn(`Failed to get connection targets from query:`, ex);
            }
        }
    }, [api, filter]);

    const updateSearchFn = useCallback((evt: InputEvent) => {
        const repo = (evt.target as HTMLOptionElement).value;
        const hasResult = results?.find(n => n.name == repo);
        if (hasResult) {
            onPicked(hasResult.state);
            setCurrentRepo(hasResult.state.repo);
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

    const onOrgPicked = useCallback((evt: InputEvent) => {
        // Reset the search string.
        setFilter({
            orgName: (evt.target as HTMLSelectElement).selectedOptions[0].value,
        });
    }, []);

    const orgListResults = useMemo(
        () => orgs?.map(i => <option key={i.name}>{i.name}</option>),
        [orgs]
    );

    const repoListResults = useMemo(
        () => results?.map(i => <option key={i.name} value={i.name} />),
        [results]
    );


    return <div>
        {(isConnected === null && !searchError) && <p> Loading GitHub connection. </p>}
        {isConnected === false && <p> You are not logged into GitHub. </p>}
        {isConnected === true && orgs?.length === 0 && <p> You do not have access to any GitHub organizations. </p>}
        {searchError && <ErrorPane> {searchError} </ErrorPane> }
        <InputField visible={!!orgs?.length} label="Organization" noPadding={true}>
            <select onChange={onOrgPicked}>
                {orgListResults}
            </select>
        </InputField>
        <InputField visible={!!isConnected} label="Repository" noPadding={true}>
            <input onChange={updateSearchFn} value={currentRepo ?? undefined} list="github-repos" type="text" />
            <datalist id="github-repos">
                {repoListResults}
            </datalist>
        </InputField>
    </div>;
}

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<never, GitHubRepoResponseItem, GitHubRepoConnectionState>> = ({api, existingConnection, onSave, onRemove }) => {
    const [enabledHooks, setEnabledHooks] = useState<string[]>(existingConnection?.config.enableHooks || []);

    const toggleEnabledHook = useCallback((evt: any) => {
        const key = (evt.target as HTMLElement).getAttribute('x-event-name');
        if (key) {
            setEnabledHooks(enabledHooks => (
                enabledHooks.includes(key) ? enabledHooks.filter(k => k !== key) : [...enabledHooks, key]
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
                enableHooks: enabledHooks as any[],
                commandPrefix: commandPrefixRef.current?.value || commandPrefixRef.current?.placeholder,
            });
        }
    }, [enabledHooks, canEdit, existingConnection, connectionState, commandPrefixRef, onSave]);

    return <form onSubmit={handleSave}>
        {!existingConnection && <ConnectionSearch api={api} onPicked={setConnectionState} />}
        <InputField visible={!!existingConnection || !!connectionState} label="Command Prefix" noPadding={true}>
            <input ref={commandPrefixRef} type="text" value={existingConnection?.config.commandPrefix} placeholder="!gh" />
        </InputField>
        <InputField visible={!!existingConnection || !!connectionState} label="Events" noPadding={true}>
            <p>Choose which event should send a notification to the room</p>
            <ul>
                <EventHookCheckbox enabledHooks={enabledHooks} eventName="issue" onChange={toggleEnabledHook}>Issues</EventHookCheckbox>
                <ul>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="issue" eventName="issue.created" onChange={toggleEnabledHook}>Created</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="issue" eventName="issue.changed" onChange={toggleEnabledHook}>Changed</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="issue" eventName="issue.edited" onChange={toggleEnabledHook}>Edited</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="issue" eventName="issue.labeled" onChange={toggleEnabledHook}>Labeled</EventHookCheckbox>
                </ul>
                <EventHookCheckbox enabledHooks={enabledHooks} eventName="pull_request" onChange={toggleEnabledHook}>Pull requests</EventHookCheckbox>
                <ul>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="pull_request" eventName="pull_request.opened" onChange={toggleEnabledHook}>Opened</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="pull_request" eventName="pull_request.closed" onChange={toggleEnabledHook}>Closed</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="pull_request" eventName="pull_request.merged" onChange={toggleEnabledHook}>Merged</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="pull_request" eventName="pull_request.ready_for_review" onChange={toggleEnabledHook}>Ready for review</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="pull_request" eventName="pull_request.reviewed" onChange={toggleEnabledHook}>Reviewed</EventHookCheckbox>
                </ul>
                <EventHookCheckbox enabledHooks={enabledHooks} eventName="workflow.run" onChange={toggleEnabledHook}>Workflow Runs</EventHookCheckbox>
                <ul>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="workflow.run" eventName="workflow.run.success" onChange={toggleEnabledHook}>Success</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="workflow.run" eventName="workflow.run.failure" onChange={toggleEnabledHook}>Failed</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="workflow.run" eventName="workflow.run.neutral" onChange={toggleEnabledHook}>Neutral</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="workflow.run" eventName="workflow.run.cancelled" onChange={toggleEnabledHook}>Cancelled</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="workflow.run" eventName="workflow.run.timed_out" onChange={toggleEnabledHook}>Timed Out</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="workflow.run" eventName="workflow.run.action_required" onChange={toggleEnabledHook}>Action Required</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="workflow.run" eventName="workflow.run.stale" onChange={toggleEnabledHook}>Stale</EventHookCheckbox>
                </ul>
                <EventHookCheckbox enabledHooks={enabledHooks} eventName="release" onChange={toggleEnabledHook}>Releases</EventHookCheckbox>
                <ul>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="release" eventName="release.created" onChange={toggleEnabledHook}>Published</EventHookCheckbox>
                    <EventHookCheckbox enabledHooks={enabledHooks} parentEvent="release" eventName="release.drafted" onChange={toggleEnabledHook}>Drafted</EventHookCheckbox>
                </ul>
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

const RoomConfigListItemFunc = (c: GitHubRepoResponseItem) => getRepoFullName(c.config);

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