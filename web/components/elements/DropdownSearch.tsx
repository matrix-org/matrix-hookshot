import { FunctionComponent } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import style from "./DropdownSearch.module.scss";

interface Props<T> {
    searchFn: (searchTerm: string, additionalProps: T) => Promise<DropItem[]>;
    searchProps: T,
    placeholder?: string,
    onChange: (value: string|null) => void;
    onError?: (error: unknown) => void;
}

export interface DropItem {
    value: string;
    title: string;
    imageSrc?: string;
    description?: string;
}

const DEBOUNCE_TIMEOUT_MS = 300;

export const DropdownItem: FunctionComponent<DropItem&{onPicked?: (value: string) => void}> = ({ imageSrc, title, value, description, onPicked }) => {
    // Need placeholder image.
    return <li className={`card ${style.dropdownItem} ${imageSrc ? style.hasImg : ''}`} role="button" onClick={() => onPicked?.(value)}>
            { imageSrc && <img className={style.itemImage} src={imageSrc} /> }
            <div>
                <p className={style.title}>{title}</p>
                <p className={style.value}>{value}</p>
                <p className={style.description}>{description}</p>
            </div>
    </li>;
};

export const DropdownSearch = function<T>({searchFn, searchProps, onChange, onError, placeholder}: Props<T>) {
    const [debounceTimer, setDebounceTimer] = useState<number|undefined>(undefined);
    const [selectedItem, setSelectedItem] = useState<DropItem|null>();
    const [searchTerm, setSearchTerm] = useState<string>("");
    const [results, setResults] = useState<DropItem[]>([]);

    // Reset if the search properties are altered.
    useEffect(() => {
        setSearchTerm("");
        setSelectedItem(null);
    }, [searchProps]);

    // Search whenever the term is updated.
    useEffect(() => {
        if (searchTerm.trim().length === 0) {
            return;
        }
        if (selectedItem) {
            // Clear any selected items
            setSelectedItem(null);
            onChange(null);
        }

        // Browser types
        setDebounceTimer(setTimeout(() => {
            console.log("searching for ", searchTerm);
            searchFn(searchTerm, searchProps).then(result => {
                setResults(result);
            }).catch(err => {
                onError?.(err);
            })
        }, DEBOUNCE_TIMEOUT_MS) as unknown as number);
        return () => {
            clearTimeout(debounceTimer);
        }
        // Things break if we depend on the thing we are clearing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm]);

    const onSearchInputChange = useCallback((event: {target: EventTarget|null}) => {
        const terms = (event.target as HTMLInputElement).value;
        setSearchTerm(terms);
    }, []);

    const onItemPicked = useCallback((item: DropItem) => {
        onChange(item.value);
        setSelectedItem(item);
        setSearchTerm("");
        setResults([]);
    }, [onChange]);


    return <>
        <input type="search" placeholder={placeholder} onChange={onSearchInputChange} value={searchTerm} />
        {selectedItem && <DropdownItem {...selectedItem} />}
        <ul>
            {
                results.map(item => <DropdownItem key={item.value} {...item} onPicked={ () => onItemPicked(item) } />)
            }
        </ul>
    </>;
};