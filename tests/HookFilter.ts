import { expect } from "chai";
import { HookFilter } from '../src/HookFilter';

const DEFAULT_SET = ['default-allowed', 'default-allowed-but-ignored'];
const ENABLED_SET = ['enabled-hook', 'enabled-but-ignored'];
const IGNORED_SET = ['ignored', 'enabled-but-ignored', 'default-allowed-but-ignored'];

describe("HookFilter", () => {
    let filter: HookFilter<string>;
    beforeEach(() => {
        filter = new HookFilter(DEFAULT_SET, ENABLED_SET, IGNORED_SET);
    });
    it('should skip a hook named in ignoreHooks', () => {
        expect(filter.shouldSkip('ignored')).to.be.true;
    });
    it('should allow a hook named in defaults', () => {
        expect(filter.shouldSkip('default-allowed')).to.be.false;
    });
    it('should allow a hook named in enabled', () => {
        expect(filter.shouldSkip('enabled-hook')).to.be.false;
    });
    it('should skip a hook named in defaults but also in ignored', () => {
        expect(filter.shouldSkip('default-allowed-but-ignored')).to.be.true;
    });
    it('should skip a hook named in enabled but also in ignored', () => {
        expect(filter.shouldSkip('enabled-but-ignored')).to.be.true;
    });
    it('should skip if any hooks are in ignored', () => {
        expect(filter.shouldSkip('enabled-hook', 'enabled-but-ignored')).to.be.true;
    });
});
