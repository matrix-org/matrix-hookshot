import { h } from "preact";
import { useEffect, useState, useCallback } from 'preact/hooks';
import { BridgeRoomState } from "../../src/Widgets/BridgeWidgetInterface";
import GeneralConfig from './configs/GeneralConfig';
import style from "./AdminSettings.module.scss";
import BridgeAPI from "../BridgeAPI";

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
    }, [setBusy, setActiveSections]);
    if (busy) {
        return <div class={style.root}>
            <div class="spinner"/>
        </div>;
    }
    const onSectionClick = useCallback(
        (event: MouseEvent) => {
            const key = parseInt((event.target as HTMLElement).parentElement.getAttribute('sectionkey'), 10);
            setCurrentTab(key as AdminSettingsTab);
        },
        [setCurrentTab]
      );
    return <div class={style.root}>
        <h1 class={style.header}> Hookshot Bridge settings</h1>
        <section class={style.contents}>
            <aside class={style.sidebar}>
                <ul>
                    {activeSections.general && <a sectionKey={AdminSettingsTab.General} onClick={onSectionClick}><li class={currentTab === AdminSettingsTab.General ? style.active : null}>General</li></a>}
                    {activeSections.github && <a sectionKey={AdminSettingsTab.GitHub} onClick={onSectionClick}><li class={currentTab === AdminSettingsTab.GitHub ? style.active : null}> GitHub</li></a>}
                    {activeSections.gitlab && <a sectionKey={AdminSettingsTab.GitLab} onClick={onSectionClick}><li class={currentTab === AdminSettingsTab.GitLab ? style.active : null}> GitLab</li></a>}
                    {activeSections.jira && <a sectionKey={AdminSettingsTab.Jira} onClick={onSectionClick}><li class={currentTab === AdminSettingsTab.Jira ? style.active : null}> Jira</li></a>}
                    {activeSections.figma && <a sectionKey={AdminSettingsTab.Figma} onClick={onSectionClick}><li class={currentTab === AdminSettingsTab.Figma ? style.active : null}> Figma</li></a>}
                </ul>
            </aside>
            <section class={style.content}>
                {currentTab === AdminSettingsTab.General && <GeneralConfig/>}
            </section>
        </section>
    </div>;
}