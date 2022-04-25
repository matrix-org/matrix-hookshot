import { h, FunctionComponent } from "preact";
import { useState, useCallback } from "preact/hooks";
import BridgeAPI from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import { GitLabRepoConnectionState, GitLabRepoResponseItem } from "../../../src/Connections/GitlabRepo";
import InputField from "../InputField";
import ButtonSet from "../ButtonSet";

const ConnectionConfiguration: FunctionComponent<ConnectionConfigurationProps<unknown, GitLabRepoResponseItem, GitLabRepoConnectionState>> = ({serviceConfig, existingConnection, onSave, onRemove}) => {
    const [ignoredHooks, setIgnoredHooks] = useState<string[]>(existingConnection?.config.ignoreHooks || []);
    const setIgnoredHook = useCallback(evt => {
        const key = (evt.target as HTMLElement).getAttribute('x-event-name');
        if (ignoredHooks.includes(key)) {
            setIgnoredHooks(ignoredHooks.filter(k => k !== key));
        } else {
            setIgnoredHooks([...ignoredHooks, key]);
        }
    }, [ignoredHooks, setIgnoredHooks]);

    if (!existingConnection) {
        return <div>Sorry, creating new integrations is not currently supported.</div>
    }

    const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);

    return <div>
        <InputField visible={!!existingConnection} label="Instance" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.instance} />
        </InputField>
        <InputField visible={!!existingConnection} label="Project" noPadding={true}>
            <input disabled={true} type="text" value={existingConnection?.config.path} />
        </InputField>
        <InputField visible={!!existingConnection} label="Command Prefix" noPadding={true}>
            <input type="text" value={existingConnection?.config.commandPrefix || "!gl"} />
        </InputField>
        <InputField visible={!!existingConnection} label="Events" noPadding={true}>
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
        <ButtonSet 
            save={ canEdit && ({text: existingConnection ? "Save" : "Add project", onClick: () => {}})}
            remove={ canEdit && existingConnection && ({text: "Remove project", onClick: () => {}})}
        />
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
        connectionEventType="uk.half-shot.matrix-hookshot.gitlab.repository"
        connetionConfigComponent={ConnectionConfiguration}
    />;
};