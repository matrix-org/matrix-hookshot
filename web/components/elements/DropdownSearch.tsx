import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import styles from "./DropdownSearch.module.scss";
import { InputField } from "./InputField";

interface Props<T, DI> {
  searchFn: (
    searchTerm: string,
    additionalProps: T,
    abortController: AbortController,
  ) => Promise<DropItem<DI>[]>;
  searchProps: T;
  placeholder?: string;
  onChange: (value: string | null, dropItem: DropItem<DI> | null) => void;
  onError?: (error: unknown) => void;
}

export interface DropItem<T = undefined> {
  value: string;
  title: string;
  imageSrc?: string;
  description?: string;
  source?: T;
}

const DEBOUNCE_TIMEOUT_MS = 750;

export const DropdownItem = function <T>({
  imageSrc,
  title,
  value,
  description,
  onPicked,
}: DropItem<T> & { onPicked?: (value: string) => void }) {
  // Need placeholder image.
  return (
    <li
      className={`card ${styles.dropdownItem} ${imageSrc ? styles.hasImg : ""}`}
      role="button"
      onClick={() => onPicked?.(value)}
    >
      {imageSrc && <img className={styles.itemImage} src={imageSrc} />}
      <div>
        <p className={styles.title}>
          {title} <span className={styles.value}>{value}</span>
        </p>
        <p className={styles.description}>{description}</p>
      </div>
    </li>
  );
};

export const DropdownSearch = function <T, DI>({
  searchFn,
  searchProps,
  onChange,
  onError,
  placeholder,
}: Props<T, DI>) {
  const selectedItem = useRef<DropItem<DI>>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<DropItem<DI>[] | null>();
  const [loading, setLoading] = useState(false);

  // Reset if the search properties are altered.
  useEffect(() => {
    setSearchTerm("");
    selectedItem.current = null;
  }, [searchProps, selectedItem]);

  // Search whenever the term is updated.
  useEffect(() => {
    if (searchTerm.trim().length === 0) {
      return;
    }
    if (selectedItem) {
      // Clear any selected items
      selectedItem.current = null;
      onChange(null, null);
    }
    const controller = new AbortController();
    // Browser types
    const debounceTimer = setTimeout(() => {
      setLoading(true);
      searchFn(searchTerm, searchProps, controller)
        .then((result) => {
          setResults(result);
        })
        .catch((err) => {
          onError?.(err);
        })
        .finally(() => {
          setLoading(false);
        });
    }, DEBOUNCE_TIMEOUT_MS);
    return () => {
      controller.abort();
      clearTimeout(debounceTimer);
    };
  }, [
    searchTerm,
    onChange,
    setResults,
    onError,
    searchProps,
    selectedItem,
    searchFn,
  ]);

  const onSearchInputChange = useCallback(
    (event: { target: EventTarget | null }) => {
      const terms = (event.target as HTMLInputElement).value;
      setSearchTerm(terms);
    },
    [],
  );

  const onItemPicked = useCallback(
    (item: DropItem<DI>) => {
      onChange(item.value, item);
      setResults([]);
      setSearchTerm("");
      selectedItem.current = item;
    },
    [onChange, selectedItem],
  );

  const onItemCleared = useCallback(() => {
    onChange(null, null);
    setResults([]);
    setSearchTerm("");
    selectedItem.current = null;
  }, [onChange, selectedItem]);

  return (
    <>
      <InputField label="Project" noPadding={true}>
        {selectedItem.current && (
          <DropdownItem {...selectedItem.current} onPicked={onItemCleared} />
        )}
        {!selectedItem.current && (
          <input
            type="search"
            placeholder={placeholder}
            onChange={onSearchInputChange}
            value={searchTerm}
          />
        )}
      </InputField>
      {loading && <p> Searching... </p>}
      {!loading &&
        !selectedItem.current &&
        searchTerm &&
        results?.length === 0 && <p> No results found. </p>}
      <ul>
        {results?.map((item) => (
          <DropdownItem
            key={item.value}
            {...item}
            onPicked={() => onItemPicked(item)}
          />
        ))}
      </ul>
    </>
  );
};
