export class HookFilter<T extends string> {
    static convertIgnoredHooksToEnabledHooks<T extends string>(enabledHooks: T[] = [], ignoredHooks: T[] = [], defaultHooks: T[]): T[] {
        const hookSet = new Set([
            ...enabledHooks,
            // Add all the default hooks
            ...defaultHooks
        ]);

        // For each ignored hook, remove a default
        for (const ignoredHook of ignoredHooks) {
            hookSet.delete(ignoredHook);
            // If the hook is a "root" hook name, remove all children.
            for (const currentHook of hookSet) {
                if (currentHook.startsWith(`${ignoredHook}.`)) {
                    hookSet.delete(currentHook);
                } 
            }
        }

        return [...hookSet];
    }

    constructor(
        public enabledHooks: T[] = [],
    ) {

    }

    public shouldSkip(...hookName: T[]) {
        return !hookName.some(name => this.enabledHooks.includes(name));
    }
}