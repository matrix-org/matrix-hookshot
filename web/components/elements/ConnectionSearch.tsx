import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { DropdownSearch, DropItem } from "./DropdownSearch";
import { ErrorPane } from "./ErrorPane";
import { InputField } from "./InputField";

interface Instance { 
    name: string;
}

type Project = DropItem;

interface IProps {
    serviceName: string;
    getInstances(): Promise<Instance[]>;
    getProjects(currentInstance: string, searchTerm: string|null): Promise<Project[]>;
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
const ConnectionSearch = function({
    serviceName,
    onPicked,
    onClear,
    getInstances,
    getProjects,
}: IProps) {
    const [currentInstance, setCurrentInstance] = useState<string|null>(null);
    const [instances, setInstances] = useState<Instance[]|null>(null);
    const [searchError, setSearchError] = useState<string|null>(null);
    const [exampleProjectName, setExampleProjectName] = useState<string>("Loading...");

    useEffect(() => {
        getInstances().then(res => {
            setInstances(res);
            setCurrentInstance(res[0]?.name ?? null);
        }).catch(ex => {
            setSearchError(`Could not load ${serviceName} instances.`);
            console.warn(`Failed to get connection targets from query:`, ex);
        });
    }, [getInstances, serviceName]);

    useEffect(() => {
        if (!currentInstance) {
            return;
        }
        getProjects(currentInstance, null).then(res => {
            setExampleProjectName(res[0]?.value ?? "my-org/my-example-project");
        }).catch(ex => {
            setSearchError("Could not load GitLab projects for instance");
            console.warn(`Failed to get connection targets from query:`, ex);
        });
    }, [currentInstance, getProjects]);

    const searchFn = useCallback(async(terms: string, { instance }: { instance: string }) => {
        try {
            const res = await getProjects(instance, terms);
            return res.map((item) => ({
                description: item.description,
                imageSrc: item.imageSrc,
                title: item.title,
                value: item.value,
            }) as DropItem);
        } catch (ex) {
            setSearchError("There was an error fetching search results.");
            // Rather than raising an error, let's just log and let the user retry a query.
            console.warn(`Failed to get connection targets from query:`, ex);
            return [];
        }
    }, [getProjects]);

    const onInstancePicked = useCallback((evt: {target: EventTarget|null}) => {
        // Reset everything
        setCurrentInstance((evt.target as HTMLSelectElement).selectedOptions[0].value);
        onClear();
    }, [onClear]);

    const instanceListResults = useMemo(
        () => instances?.map(i => <option key={i.name}>{i.name}</option>),
        [instances]
    );

    const onProjectPicked = useCallback((value: string|null) => {
        if (value === null) {
            onClear();
            return;
        }
        if (!currentInstance) {
            throw Error('Should never pick a project without an instance');
        }
        onPicked(currentInstance, value);
    }, [currentInstance, onClear, onPicked]);

    return <div>
        {instances === null && <p> Loading GitLab instances. </p>}
        {instances?.length === 0 && <p> You are not logged into any GitLab instances. </p>}
        {searchError && <ErrorPane header="Search error"> {searchError} </ErrorPane> }
        <InputField visible={!!instances?.length} label="GitLab Instance" noPadding={true}>
            <select onChange={onInstancePicked}>
                {instanceListResults}
            </select>
        </InputField>
        { currentInstance && <InputField label="Project" noPadding={true}>
           <DropdownSearch
                placeholder={`Your project name, such as ${exampleProjectName}`}
                searchFn={searchFn}
                searchProps={{ instance: currentInstance  }}
                onChange={onProjectPicked}
            />
        </InputField> }
    </div>;
}

export default ConnectionSearch;
