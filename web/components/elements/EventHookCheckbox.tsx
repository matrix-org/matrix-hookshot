import { FunctionComponent } from "preact";
import { JSXInternal } from "preact/src/jsx";
import { InputField } from "./InputField";
import { useCallback } from "preact/hooks";
import styles from "./EventHookCheckbox.module.scss";

export const EventHookCheckbox: FunctionComponent<{
  enabledHooks: string[];
  onChange: JSXInternal.GenericEventHandler<HTMLInputElement>;
  hookEventName: string;
  parentEvent?: string;
}> = ({ enabledHooks, onChange, hookEventName, parentEvent, children }) => {
  const checked =
    enabledHooks.includes(hookEventName) ||
    (!!parentEvent && enabledHooks.includes(parentEvent));

  return (
    <li>
      <label>
        <input
          type="checkbox"
          data-event-name={hookEventName}
          checked={checked}
          onChange={onChange}
        />
        {children}
      </label>
    </li>
  );
};

export const EventHookList: FunctionComponent<{
  visible?: boolean;
  label: string;
  setAllowedEvents: (cb: (events: string[]) => string[]) => void;
  allowedEvents: string[];
  eventList: Record<string, { eventName: string; label: string }[]>;
}> = ({ visible, label, setAllowedEvents, allowedEvents, eventList }) => {
  const toggleEvent = useCallback((evt: Event) => {
    const key = (evt.target as HTMLElement).getAttribute("data-event-name");
    if (key) {
      setAllowedEvents((allowedEvents) =>
        allowedEvents.includes(key)
          ? allowedEvents.filter((k) => k !== key)
          : [...allowedEvents, key],
      );
    }
  }, []);

  return (
    <InputField
      className={styles.root}
      visible={visible}
      label={label}
      noPadding={true}
    >
      <p>Choose which event should send a notification to the room</p>
      <ul>
        {Object.entries(eventList).map(([label, list]) => (
          <div key={label}>
            {label}
            <ul>
              {list.map((entry) => (
                <EventHookCheckbox
                  key={entry.eventName}
                  enabledHooks={allowedEvents}
                  hookEventName={entry.eventName}
                  onChange={toggleEvent}
                >
                  {entry.label}
                </EventHookCheckbox>
              ))}
            </ul>
          </div>
        ))}
      </ul>
    </InputField>
  );
};
