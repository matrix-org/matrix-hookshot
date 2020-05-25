import moment from "moment";

export default class Dateformat {
    public static parseUntilOrForDateString(dateString: string): Date {
        const parts = dateString.split(" ");
        const dateStr = parts.slice(1).join(" ");
        if (parts[0] === "until") {
            const date = moment(dateStr);
            return date.toDate();
        } else if (parts[0] === "for") {
            const duration = moment.duration(0);
            for (const durComponent in dateStr.split(", ")) {
                duration.add(...durComponent.split(" "));
            }
            return new Date(Date.now() + duration.asMilliseconds());
        } else {
            throw Error("Must use 'until' or 'for'");
        }
    }
}