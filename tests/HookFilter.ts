import { expect } from "chai";
import { HookFilter } from '../src/HookFilter';

const DEFAULT_SET = ['default-allowed', 'default-allowed-but-ignored'];
const ENABLED_SET = ['enabled-hook', 'enabled-but-ignored'];

describe("HookFilter", () => {
    let filter: HookFilter<string>;

    beforeEach(() => {
        filter = new HookFilter(ENABLED_SET);
    });

    describe('shouldSkip', () => {
        it('should allow a hook named in enabled set', () => {
            expect(filter.shouldSkip('enabled-hook')).to.be.false;
        });

        it('should not allow a hook not named in enabled set', () => {
            expect(filter.shouldSkip('not-enabled-hook')).to.be.true;
        });
    });
    
    describe('convertIgnoredHooksToEnabledHooks', () => {
        it('should correctly provide a list of default hooks', () => {
            expect(HookFilter.convertIgnoredHooksToEnabledHooks([], [], DEFAULT_SET)).to.have.members(DEFAULT_SET);
        });
        
        it('should correctly include default and enabled hooks when ignored hooks is set', () => {
            expect(HookFilter.convertIgnoredHooksToEnabledHooks(ENABLED_SET, ['my-ignored-hook'], DEFAULT_SET)).to.have.members([
                ...ENABLED_SET, ...DEFAULT_SET
            ]);
        });
        
        it('should deduplicate', () => {
            expect(HookFilter.convertIgnoredHooksToEnabledHooks(DEFAULT_SET, [], DEFAULT_SET)).to.have.members(DEFAULT_SET);
        });
        
        it('should correctly exclude ignored hooks', () => {
            expect(HookFilter.convertIgnoredHooksToEnabledHooks([], [DEFAULT_SET[0]], DEFAULT_SET)).to.not.include([
                DEFAULT_SET[0]
            ]);
        });
        
        it('should handle ignored root hooks', () => {
            const defaultHooks = ['myhook', 'myhook.foo', 'myhook.foo.bar'];
            expect(HookFilter.convertIgnoredHooksToEnabledHooks([], ['myhook.foo.bar'], defaultHooks)).to.have.members([
                'myhook', 'myhook.foo'
            ]);
            expect(HookFilter.convertIgnoredHooksToEnabledHooks([], ['myhook.foo'], defaultHooks)).to.have.members([
                'myhook'
            ]);
            expect(HookFilter.convertIgnoredHooksToEnabledHooks([], ['myhook'], defaultHooks)).to.be.empty;
        });
    });
});
