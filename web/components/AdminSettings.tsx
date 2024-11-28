import { useEffect, useState, useCallback } from 'preact/hooks';
import { LoadingSpinner } from "./elements/LoadingSpinner";
import { BridgeRoomState } from "../../src/Widgets/BridgeWidgetInterface";
import GeneralConfig from './configs/GeneralConfig';
import style from "./AdminSettings.module.scss";
import { BridgeAPI } from "../BridgeAPI";
import GitHubState from "../components/GitHubState";
interface IProps {
    roomState: BridgeRoomState;
    bridgeApi: BridgeAPI;
}

enum AdminSettingsTab {
    General = 0,
    GitHub = 1,
    GitLab = 2,
    Jira = 3,
    Figma = 4,
}

export default function AdminSettings(props: IProps) {
    const [currentTab, setCurrentTab] = useState<AdminSettingsTab>(AdminSettingsTab.General);
    const [busy, setBusy] = useState<boolean>(true);
    const [activeSections, setActiveSections] = useState<{[sectionName: string]: boolean}>({});
    useEffect(() => {
        props.bridgeApi.getEnabledConfigSections().then(sections => {
            setActiveSections(sections);
        })
        setBusy(false);
    }, [setBusy, setActiveSections, props.bridgeApi]);
    const onSectionClick = useCallback(
        (event: MouseEvent) => {
            const key = parseInt((event.target as HTMLElement).parentElement.getAttribute('sectionkey'), 10);
            setCurrentTab(key as AdminSettingsTab);
        },
        [setCurrentTab]
    );
    if (busy) {
        return <div className={style.root}>
            <LoadingSpinner />
        </div>;
    }
    return <div className={style.root}>
        <h1 className={style.header}> Hookshot Bridge settings</h1>
        <div className={style.contents}>
            <aside className={style.sidebar}>
                <ul>
                    {activeSections.general && <a onClick={onSectionClick}><li className={currentTab === AdminSettingsTab.General ? style.active : null}>General</li></a>}
                    {activeSections.github && <a onClick={onSectionClick}><li className={currentTab === AdminSettingsTab.GitHub ? style.active : null}> GitHub</li></a>}
                    {activeSections.gitlab && <a onClick={onSectionClick}><li className={currentTab === AdminSettingsTab.GitLab ? style.active : null}> GitLab</li></a>}
                    {activeSections.jira && <a onClick={onSectionClick}><li className={currentTab === AdminSettingsTab.Jira ? style.active : null}> Jira</li></a>}
                    {activeSections.figma && <a onClick={onSectionClick}><li className={currentTab === AdminSettingsTab.Figma ? style.active : null}> Figma</li></a>}
                </ul>
            </aside>
            <div className={style.content}>
                {currentTab === AdminSettingsTab.General && <GeneralConfig />}
                {currentTab === AdminSettingsTab.GitHub && <GitHubState config={props.roomState.github} />}
            </div>
        </div>
    </div>;
}
