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

const DEBOUNCE_TIMEOUT_MS = 750;

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
    const [selectedItem, setSelectedItem] = useState<DropItem|null>();
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState<DropItem[]|null>();
    const [loading, setLoading] = useState(false);

    // Reset if the search properties are altered.
    useEffect(() => {
        console.log("Resetting props");
        setSearchTerm("");
        setSelectedItem(null);
    }, [searchProps]);

    // Search whenever the term is updated.
    useEffect(() => {
        console.log("New search");
        if (searchTerm.trim().length === 0) {
            return;
        }
        if (selectedItem) {
            // Clear any selected items
            setSelectedItem(null);
            onChange(null);
        }

        // Browser types
        const debounceTimer = setTimeout(() => {
            setLoading(true);
            searchFn(searchTerm, searchProps).then(result => {
                setResults(result);
            }).catch(err => {
                onError?.(err);
            }).finally(() => {
                setLoading(false);
            })
        }, DEBOUNCE_TIMEOUT_MS);
        return () => {
            clearTimeout(debounceTimer);
        }
    }, [searchTerm, onChange, setResults, onError, searchProps, selectedItem, searchFn]);

    const onSearchInputChange = useCallback((event: {target: EventTarget|null}) => {
        const terms = (event.target as HTMLInputElement).value;
        setSearchTerm(terms);
    }, []);

    const onItemPicked = useCallback((item: DropItem) => {
        onChange(item.value);
        setResults([]);
        setSearchTerm("");
        setSelectedItem(item);
    }, [onChange]);

    const onItemCleared = useCallback(() => {
        onChange(null);
        setResults([]);
        setSearchTerm("");
        setSelectedItem(null);
    }, [onChange]);
    
    return <>
        {selectedItem && <DropdownItem {...selectedItem} onPicked={onItemCleared} />}
        {!selectedItem && <input type="search" placeholder={placeholder} onChange={onSearchInputChange} value={searchTerm} />}
        {loading && <p> Searching... </p>}
        {!loading && !selectedItem && searchTerm && results?.length === 0 && <p> No results found. </p>}
        <ul>
            {
                results?.map(item => <DropdownItem key={item.value} {...item} onPicked={ () => onItemPicked(item) } />)
            }
        </ul>
    </>;
};