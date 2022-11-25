export class HookFilter<T extends string> {
    constructor(
        public readonly defaultHooks: T[],
        public enabledHooks: T[] = [],
        public ignoredHooks: T[] = []
    ) {

    }

    public shouldSkip(...hookName: T[]) {
        if (hookName.some(name => this.ignoredHooks.includes(name))) {
            return true;
        }
        if (hookName.some(name => this.enabledHooks.includes(name))) {
            return false;
        }
        return !hookName.some(h => this.defaultHooks.includes(h));
    }
}