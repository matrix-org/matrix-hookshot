import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { BridgeAPIError } from "../../BridgeAPI";
import { DropdownSearch, DropItem } from "./DropdownSearch";
import { InputField } from "./InputField";
import { Alert } from "@vector-im/compound-web";

interface Instance {
  name: string;
}

type Project<T = undefined> = DropItem<T>;

interface IProps {
  serviceName: string;
  addNewInstanceUrl?: string;
  getInstances(): Promise<Instance[]>;
  getProjects(
    currentInstance: string,
    searchTerm?: string,
    abortController?: AbortController,
  ): Promise<Project[]>;
  onPicked: (instanceValue: string, projectValue: string) => void;
  onClear: () => void;
}

/**
 * This component is designed to generically fetch a bunch of instances for a given connection type
 * and then a list of projects associated with that instance. The user should be able to pick from
 * that list.
 * @param props
 * @returns
 */
export function ConnectionSearch({
  serviceName,
  addNewInstanceUrl,
  onPicked,
  onClear,
  getInstances,
  getProjects,
}: IProps) {
  const [currentInstance, setCurrentInstance] = useState<string>("");
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    getInstances()
      .then((res) => {
        setInstances(res);
        setCurrentInstance(res[0]?.name ?? "");
      })
      .catch((ex) => {
        if (
          ex instanceof BridgeAPIError &&
          ex.errcode === "HS_FORBIDDEN_USER"
        ) {
          setSearchError(`You are not logged into ${serviceName}.`);
          return;
        }
        setSearchError(`Could not load ${serviceName} instances.`);
        console.warn(`Failed to get connection targets from query:`, ex);
      });
  }, [getInstances, serviceName]);

  const onInstancePicked = useCallback(
    (evt: { target: EventTarget | null }) => {
      // Reset everything
      setCurrentInstance(
        (evt.target as HTMLSelectElement).selectedOptions[0].value,
      );
      onClear();
    },
    [onClear],
  );

  const instanceListResults = useMemo(
    () => instances?.map((i) => <option key={i.name}>{i.name}</option>),
    [instances],
  );

  let addNewInstance = null;
  if (instances?.length === 0) {
    if (addNewInstanceUrl) {
      addNewInstance = (
        <p>
          {" "}
          You have not connected any {serviceName} instances.
          <br />
          <a href={addNewInstanceUrl} rel="noreferrer" target="_blank">
            Add a new instance
          </a>
        </p>
      );
    } else {
      addNewInstance = (
        <p> You have not connected any {serviceName} instances.</p>
      );
    }
  } else if (addNewInstanceUrl) {
    addNewInstance = (
      <p>
        <a href={addNewInstanceUrl} rel="noreferrer" target="_blank">
          Add a new instance
        </a>
        .
      </p>
    );
  } // otherwise, empty

  return (
    <div>
      {!searchError && instances === null && (
        <p> Loading {serviceName} instances. </p>
      )}
      {searchError && (
        <Alert type="critical" title="Search error">
          {" "}
          {searchError}{" "}
        </Alert>
      )}
      <InputField
        visible={!!instances?.length}
        label={`${serviceName} Instance`}
        noPadding={true}
      >
        <select onChange={onInstancePicked}>{instanceListResults}</select>
      </InputField>
      {addNewInstance}
      {currentInstance && (
        <ProjectSearch
          currentInstance={currentInstance}
          getProjects={getProjects}
          serviceName={serviceName}
          onPicked={onPicked}
          onClear={onClear}
        />
      )}
    </div>
  );
}

interface ProjectSearchProps<T> {
  currentInstance?: string;
  serviceName: string;
  getProjects(
    currentInstance: string,
    searchTerm?: string,
    abortController?: AbortController,
  ): Promise<Project<T>[]>;
  onPicked: (
    instanceValue: string,
    projectValue: string,
    dropItem: DropItem<T>,
  ) => void;
  onClear: () => void;
}

export function ProjectSearch<T>({
  currentInstance,
  getProjects,
  serviceName,
  onPicked,
  onClear,
}: ProjectSearchProps<T>) {
  const [searchError, setSearchError] = useState<string | null>(null);
  const [exampleProjectName, setExampleProjectName] =
    useState<string>("Loading...");
  useEffect(() => {
    if (!currentInstance) {
      return;
    }
    getProjects(currentInstance)
      .then((res) => {
        setExampleProjectName(res[0]?.title ?? "my-org/my-example-project");
      })
      .catch((ex) => {
        setSearchError(`Could not load ${serviceName} projects for instance`);
        console.warn(`Failed to get connection targets from query:`, ex);
      });
  }, [currentInstance, getProjects, serviceName]);

  const searchFn = useCallback(
    async (
      terms: string,
      { instance }: { instance: string },
      abortController: AbortController,
    ) => {
      try {
        return await getProjects(instance, terms, abortController);
      } catch (ex) {
        setSearchError("There was an error fetching search results.");
        // Rather than raising an error, let's just log and let the user retry a query.
        console.warn(`Failed to get connection targets from query:`, ex);
        return [];
      }
    },
    [getProjects],
  );

  const onProjectPicked = useCallback(
    (value: string | null, dropItem: DropItem<T> | null) => {
      if (value === null) {
        onClear();
        return;
      }
      if (!currentInstance) {
        throw Error("Should never pick a project without an instance");
      }
      if (!dropItem) {
        throw Error("Should never pick a project without a dropItem");
      }
      onPicked(currentInstance, value, dropItem);
    },
    [currentInstance, onClear, onPicked],
  );

  return (
    <div>
      {searchError && (
        <Alert type="critical" title="Search error">
          {" "}
          {searchError}{" "}
        </Alert>
      )}
      {currentInstance && (
        <DropdownSearch<{ instance: string }, T>
          placeholder={`Your project name, such as '${exampleProjectName}'`}
          searchFn={searchFn}
          searchProps={{ instance: currentInstance }}
          onChange={onProjectPicked}
        />
      )}
    </div>
  );
}
