export class HookFilter<T extends string> {
  static convertIgnoredHooksToEnabledHooks<T extends string>(
    explicitlyEnabledHooks: T[] = [],
    ignoredHooks: T[],
    defaultHooks: T[],
  ): T[] {
    const resultHookSet = new Set([...explicitlyEnabledHooks, ...defaultHooks]);

    // For each ignored hook, remove anything that matches.
    for (const ignoredHook of ignoredHooks) {
      resultHookSet.delete(ignoredHook);
      // If the hook is a "root" hook name, remove all children.
      for (const enabledHook of resultHookSet) {
        if (enabledHook.startsWith(`${ignoredHook}.`)) {
          resultHookSet.delete(enabledHook);
        }
      }
    }

    return [...resultHookSet];
  }

  constructor(public enabledHooks: T[] = []) {}

  public shouldSkip(...hookName: T[]) {
    // Should skip if all of the hook names are missing
    return hookName.every((name) => !this.enabledHooks.includes(name));
  }
}
