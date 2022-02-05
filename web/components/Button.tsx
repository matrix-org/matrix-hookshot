import { h } from "preact";
import { useEffect, useState, useCallback } from 'preact/hooks';
import style from "./Button.module.scss";

export function Button(props: Record<string, unknown>) {
    return <button className={style.button} {...props}/>;
} 