import { FunctionComponent, createRef } from "preact";
import {
  useState,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "preact/hooks";
import { BridgeConfig } from "../../BridgeAPI";
import { ConnectionConfigurationProps, RoomConfig } from "./RoomConfig";
import type {
  OpenProjectConnectionRepoTarget,
  OpenProjectConnectionState,
  OpenProjectResponseItem,
  OpenProjectServiceConfig,
} from "../../../src/Connections/OpenProjectConnection";
import { InputField, ButtonSet, Button } from "../elements";
import { EventHookList } from "../elements/EventHookCheckbox";
import Icon from "../../icons/openproject.png";
import { GetAuthResponse } from "../../../src/widgets/BridgeWidgetInterface";
import type { ServiceStatusOption } from "../../../src/widgets/BridgeWidgetInterface";
import { BridgeContext } from "../../context";
import { ServiceAuth } from "./Auth";
import { ProjectSearch } from "../elements/ConnectionSearch";
import { DropItem } from "../elements/DropdownSearch";
import { Dropdown, InlineSpinner } from "@vector-im/compound-web";
import styles from "./OpenProjectConfig.module.scss";

const EventType = "org.matrix.matrix-hookshot.openproject.project";

const OPEN_PROJECT_EVENTS = {
  "Work Packages": [
    {
      label: "Created",
      eventName: "work_package:created",
    },
    {
      label: "All updates",
      eventName: "work_package:updated",
    },
    {
      label: "Assignee changed",
      eventName: "work_package:assignee_changed",
    },
    {
      label: "Responsible user changed",
      eventName: "work_package:responsible_changed",
    },
    {
      label: "Subject changed",
      eventName: "work_package:subject_changed",
    },
    {
      label: "Description changed",
      eventName: "work_package:description_changed",
    },
    {
      label: "Due date changed",
      eventName: "work_package:duedate_changed",
    },
    {
      label: "Work completed changed",
      eventName: "work_package:workpercent_changed",
    },
    {
      label: "Priority Changed",
      eventName: "work_package:priority_changed",
    },
  ],
};

type ConfigProps = ConnectionConfigurationProps<
  OpenProjectServiceConfig,
  OpenProjectResponseItem,
  OpenProjectConnectionState
>;

const CompletionStatusSelector: FunctionComponent<{
  canEdit: boolean;
  selectedOptionId?: string;
  onChange: (optionId: string | undefined) => void;
}> = ({ canEdit, selectedOptionId, onChange }) => {
  const api = useContext(BridgeContext).bridgeApi;
  const [statusOptions, setStatusOptions] = useState<
    ServiceStatusOption[] | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    api
      .getServiceStatusOptions("openproject")
      .then(({ statusOptions }) => {
        if (isMounted) {
          setStatusOptions(statusOptions);
        }
      })
      .catch((error) => {
        console.warn("Could not load OpenProject statuses", error);
        if (isMounted) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [api]);

  const selectedStatus = statusOptions?.find(
    (status) => status.id === selectedOptionId,
  );
  const selectedStatusIsInvalid =
    selectedOptionId !== undefined &&
    statusOptions !== null &&
    (!selectedStatus || !selectedStatus.isClosed);
  const closedStatuses = statusOptions?.filter((status) => status.isClosed);
  const compatibilityDefaultStatus =
    statusOptions?.find(
      (status) => status.name.toLowerCase() === "closed" && status.isClosed,
    ) ?? statusOptions?.find((status) => status.isClosed);
  const dropdownPlaceholder = isLoading
    ? "Loading OpenProject statuses…"
    : loadFailed
      ? "OpenProject statuses unavailable"
      : compatibilityDefaultStatus
        ? `Use compatibility default: ${compatibilityDefaultStatus.name}`
        : "Completion status unavailable";
  const dropdownDisabled =
    !canEdit || isLoading || loadFailed || !statusOptions?.length;
  const dropdownValues: [string, string][] =
    statusOptions?.map((status) => [
      status.id,
      `${status.name} ${status.isClosed ? "(closed state)" : ""}`,
    ]) ?? [];
  const dropdownError = loadFailed
    ? "Could not load OpenProject statuses. Please try again."
    : selectedStatusIsInvalid
      ? selectedStatus
        ? `Status “${selectedStatus.name}” is not a closed state and cannot be used.`
        : `Saved completion status ID ${selectedOptionId} is no longer available.`
      : undefined;
  const helpMessages = ["This status is the result of the “Close” action."];

  if (!loadFailed && statusOptions?.length === 0) {
    helpMessages.push(
      "No OpenProject statuses are available. Add statuses in OpenProject before selecting a completion status.",
    );
  } else if (!loadFailed && statusOptions && !closedStatuses?.length) {
    helpMessages.push(
      "No OpenProject statuses are marked as closed states, so no completion status is available.",
    );
  }

  return (
    <div className={styles.completionStatusField}>
      <Dropdown
        className={styles.completionDropdown}
        label="Completion Status"
        placeholder={dropdownPlaceholder}
        helpLabel={helpMessages.join(" ")}
        error={dropdownError}
        values={dropdownValues}
        value={selectedOptionId}
        onValueChange={onChange}
        {...{ type: "button", disabled: dropdownDisabled }}
      />
    </div>
  );
};

const ExistingConnectionConfig: FunctionComponent<{
  isUpdating: boolean;
  connection: OpenProjectResponseItem;
  onSave: ConfigProps["onSave"];
  onRemove: ConfigProps["onRemove"];
}> = ({ connection, onSave, onRemove, isUpdating }) => {
  const commandPrefixRef = createRef<HTMLInputElement>();
  const [allowedEvents, setAllowedEvents] = useState<string[]>(
    connection.config.events,
  );
  const [automaticAnchors, setAutomaticAnchors] = useState<boolean>(
    (connection.config.anchors ?? []).includes("work_package:created"),
  );
  const [completionStatusOptionId, setCompletionStatusOptionId] = useState(
    connection.config.completionStatusOptionId,
  );

  const handleSave = useCallback(
    (evt: Event) => {
      evt.preventDefault();
      if (!connection.canEdit) {
        return;
      }
      onSave({
        ...connection.config,
        events: allowedEvents as OpenProjectConnectionState["events"],
        anchors: automaticAnchors ? ["work_package:created"] : [],
        completionStatusOptionId,
        commandPrefix:
          commandPrefixRef.current?.value ||
          commandPrefixRef.current?.placeholder,
      });
    },
    [
      connection,
      allowedEvents,
      automaticAnchors,
      completionStatusOptionId,
      commandPrefixRef,
      onSave,
    ],
  );

  return (
    <form onSubmit={handleSave}>
      <InputField label="Command Prefix" noPadding={true}>
        <input
          ref={commandPrefixRef}
          type="text"
          value={connection.config.commandPrefix}
          placeholder="!openproject"
        />
      </InputField>
      <CompletionStatusSelector
        canEdit={connection.canEdit ?? false}
        selectedOptionId={completionStatusOptionId}
        onChange={setCompletionStatusOptionId}
      />
      <div className={styles.checkboxField}>
        <label>
          <input
            disabled={!connection.canEdit}
            type="checkbox"
            checked={automaticAnchors}
            onChange={useCallback(
              () => setAutomaticAnchors((value) => !value),
              [],
            )}
          />
          Automatically add new work packages to the timeline
        </label>
      </div>
      <EventHookList
        eventList={OPEN_PROJECT_EVENTS}
        label="Choose which events that sends activity messages"
        setAllowedEvents={setAllowedEvents}
        allowedEvents={allowedEvents}
      />
      <ButtonSet>
        {connection.canEdit && (
          <Button type="submit" disabled={isUpdating}>
            Save
          </Button>
        )}
        {connection.canEdit && (
          <Button disabled={isUpdating} intent="remove" onClick={onRemove}>
            Remove project
          </Button>
        )}
      </ButtonSet>
    </form>
  );
};

const ConnectionConfiguration: FunctionComponent<ConfigProps> = ({
  loginLabel,
  showAuthPrompt,
  existingConnection,
  onSave,
  onRemove,
  isUpdating,
}) => {
  const canEdit = !existingConnection || (existingConnection?.canEdit ?? false);
  const api = useContext(BridgeContext).bridgeApi;
  const [authedResponse, setAuthResponse] = useState<GetAuthResponse | null>(
    null,
  );
  const [newConnectionState, setConnectionState] = useState<{
    url: string;
    prefix: string;
  }>();

  const checkAuth = useCallback(() => {
    api
      .getAuth("openproject")
      .then((res) => {
        setAuthResponse(res);
      })
      .catch((ex) => {
        console.warn("Could not check authed state, assuming yes", ex);
        setAuthResponse({
          authenticated: true,
          user: {
            name: "Unknown",
          },
        });
      });
  }, [api]);

  const onProjectPicked = useCallback(
    (
      _instanceValue: string,
      _projectValue: string,
      dropItem: DropItem<OpenProjectConnectionRepoTarget>,
    ) => {
      if (!dropItem.source) {
        throw Error("Source should always be present");
      }
      setConnectionState({
        url: dropItem.source.url,
        prefix: dropItem.source?.suggested_prefix,
      });
    },
    [setConnectionState],
  );

  useEffect(() => {
    if (!showAuthPrompt) {
      return;
    }
    checkAuth();
  }, [showAuthPrompt, checkAuth]);

  const getProjects = useMemo(
    () =>
      async (
        _instance: string,
        search: string,
        abortController: AbortController,
      ) => {
        const targets =
          await api.getConnectionTargets<OpenProjectConnectionRepoTarget>(
            EventType,
            {
              ...(search && { search }),
            },
            abortController,
          );

        return targets.map(
          (repo) =>
            ({
              title: repo.name,
              description: repo.description,
              value: repo.url,
              source: repo,
            }) satisfies DropItem<OpenProjectConnectionRepoTarget>,
        );
      },
    [api],
  );

  const consideredAuthenticated =
    authedResponse?.authenticated || !showAuthPrompt;

  if (existingConnection) {
    return (
      <ExistingConnectionConfig
        connection={existingConnection}
        onSave={onSave}
        onRemove={onRemove}
        isUpdating={isUpdating}
      />
    );
  }

  if (!authedResponse) {
    return <InlineSpinner />;
  }

  if (!consideredAuthenticated) {
    return (
      <ServiceAuth
        onAuthSucceeded={checkAuth}
        authState={authedResponse}
        service="openproject"
        loginLabel={loginLabel}
      />
    );
  }

  const handleSave = useCallback(
    (evt: Event) => {
      evt.preventDefault();
      if (!canEdit || !newConnectionState) {
        return;
      }
      onSave({
        url: newConnectionState.url,
        commandPrefix: newConnectionState.prefix,
        events: ["work_package:created"],
        anchors: [],
      });
    },
    [newConnectionState, onSave],
  );

  return (
    <form onSubmit={handleSave}>
      <ServiceAuth
        onAuthSucceeded={checkAuth}
        authState={authedResponse}
        service="openproject"
        loginLabel={loginLabel}
      />
      <ProjectSearch<OpenProjectConnectionRepoTarget>
        onClear={() => setConnectionState(undefined)}
        onPicked={onProjectPicked}
        serviceName="openproject"
        currentInstance="main"
        getProjects={getProjects}
      />
      <ButtonSet>
        {canEdit && (
          <Button type="submit" disabled={isUpdating || !newConnectionState}>
            Add project
          </Button>
        )}
      </ButtonSet>
    </form>
  );
};

const RoomConfigText = {
  header: "Open Project",
  createNew: "Add new project",
  listCanEdit: "Your connected projects",
  listCantEdit: "Connected projects",
};

const RoomConfigListItemFunc = (c: OpenProjectResponseItem) => c.config.url;

const OpenProjectConfig: BridgeConfig = ({ roomId, showHeader }) => {
  return (
    <RoomConfig<
      OpenProjectServiceConfig,
      OpenProjectResponseItem,
      OpenProjectConnectionState
    >
      headerImg={Icon}
      showHeader={showHeader}
      roomId={roomId}
      showAuthPrompt
      type="openproject"
      text={RoomConfigText}
      listItemName={RoomConfigListItemFunc}
      connectionEventType={EventType}
      connectionConfigComponent={ConnectionConfiguration}
    />
  );
};

export default OpenProjectConfig;
