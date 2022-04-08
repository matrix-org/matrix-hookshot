import { h } from "preact";
import { Button } from "../Button";

export default function GeneralConfig() {
    return <div>
        <h2>General Configuration</h2>
        <hr />
        <section>
            <h3> Filters </h3>
            <p> You have no configured filters. </p>
            <Button> Add Filter </Button>
        </section>
    </div>;
}