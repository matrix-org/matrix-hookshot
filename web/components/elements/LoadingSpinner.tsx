import React from "preact";

import styles from "./LoadingSpinner.module.scss";

export const LoadingSpinner = (props: React.ComponentProps<"svg">) => (
  <div className={styles.spinner}>
    <svg
      width={16}
      height={16}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M6.232 6.232a1 1 0 0 0 0-1.414L4.111 2.697A1 1 0 1 0 2.697 4.11l2.121 2.121a1 1 0 0 0 1.414 0z"
        style={{
          fill: "#000",
          opacity: 0.81,
        }}
      />
      <path
        d="M4.5 7a1 1 0 0 1 0 2h-3a1 1 0 0 1 0-2z"
        style={{
          fill: "#000",
          opacity: 0.69,
        }}
      />
      <path
        d="M6.232 9.768a1 1 0 0 0-1.414 0l-2.121 2.121a1 1 0 1 0 1.414 1.414l2.121-2.121a1 1 0 0 0 0-1.414z"
        style={{
          fill: "#000",
          opacity: 0.57,
        }}
      />
      <path
        d="M7 11.5a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0z"
        style={{
          fill: "#000",
          opacity: 0.45,
        }}
      />
      <path
        d="M13.303 13.303a1 1 0 0 0 0-1.414l-2.121-2.121a1 1 0 0 0-1.414 1.414l2.121 2.121a1 1 0 0 0 1.414 0z"
        style={{
          fill: "#000",
          opacity: 0.32,
        }}
      />
      <path
        d="M14.5 7a1 1 0 1 1 0 2h-3a1 1 0 1 1 0-2z"
        style={{
          fill: "#000",
          opacity: 0.25,
        }}
      />
      <path
        d="M13.303 2.697a1 1 0 0 0-1.414 0L9.768 4.818a1 1 0 1 0 1.414 1.414l2.121-2.121a1 1 0 0 0 0-1.414z"
        style={{
          fill: "#000",
          opacity: 0.12,
        }}
      />
      <path
        d="M8 .5a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0v-3a1 1 0 0 0-1-1Z"
        style={{
          fill: "#000",
        }}
      />
    </svg>
  </div>
);
