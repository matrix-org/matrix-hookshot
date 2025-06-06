import React from "preact";

import styles from "./Card.module.scss";

const Card = (props: React.ComponentProps<"div">) => (
  <div {...props} className={styles.card} />
);

export { Card };
