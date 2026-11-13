import { describe, expect, it } from 'vitest';
import { adaptReactSourceSnapshot } from '../../src/services/reactSourceAdapter.js';
import { extractReactSourceTargets } from '../../src/services/reactSourceExtractor.js';
import { ALL_RULE_IDS, SOURCE_RULE_POLICIES } from '../../src/services/reactSourceRuleMap.js';

// Small JSX examples mirror the rule fixtures in accessibility-known-cases.
// Deferred cases assert that source-only analysis never dispatches an unsupported claim.
const examples: Record<(typeof ALL_RULE_IDS)[number], string> = {
  'IMG-ALT-RELEVANCE': '<img src="chart.png" alt="Quarterly revenue chart" />',
  'IMG-ALT-CLARITY': '<img src="chart.png" alt="Chart" />',
  'IMG-ALT-REDUNDANCY': '<figure><img src="chart.png" alt="Quarterly revenue chart" /><figcaption>Quarterly revenue chart</figcaption></figure>',
  'BUTTON-PURPOSE-CLARITY': '<button>Save changes</button>',
  'BUTTON-NAME-AMBIGUITY': '<><button>Open</button><button>Open</button></>',
  'BUTTON-ACTION-CONSISTENCY': '<button onClick={save}>Save changes</button>',
  'LINK-PURPOSE-CLARITY': '<a href="/account">Account settings</a>',
  'LINK-GENERIC-TEXT': '<a href="/report">Read more</a>',
  'LINK-SIMILAR-CHOICES': '<><a href="/a">Details</a><a href="/b">Details</a></>',
  'FORM-LABEL-RELEVANCE': '<><label htmlFor="email">Email address</label><input id="email" type="email" /></>',
  'FORM-LABEL-AMBIGUITY': '<form><label htmlFor="name">Name</label><input id="name" /></form>',
  'FORM-PLACEHOLDER-ONLY': '<input placeholder="Email address" />',
  'ARIA-NAME-CLARITY': '<button aria-label="Save">Save</button>',
  'ARIA-NAMING-CONSISTENCY': '<button aria-label="Save">Save</button>',
  'ARIA-NAME-CONFLICT': '<button aria-label="Discard">Save</button>',
  'HEADING-CLARITY': '<h2>Account settings</h2>',
  'HEADING-CONTENT-RELEVANCE': '<section><h2>Billing</h2><p>Update your payment method.</p></section>',
  'CONTENT-INSTRUCTION-AMBIGUITY': '<p>Enter the information above.</p>',
  'CONTENT-ERROR-CLARITY': '<p role="alert">Invalid value</p>',
  'CONTENT-TERM-CONSISTENCY': '<p>Choose a plan.</p>',
};

describe('React source rule coverage policy', () => {
  it('has one source example for every rule and dispatches only single-file assessable rules', () => {
    expect(Object.keys(examples).sort()).toEqual([...ALL_RULE_IDS].sort());

    for (const ruleId of ALL_RULE_IDS) {
      const extraction = extractReactSourceTargets(examples[ruleId], `${ruleId}.jsx`);
      expect(extraction.status, ruleId).toBe('available');
      if (extraction.status !== 'available') continue;

      const adapted = adaptReactSourceSnapshot(extraction.snapshot);
      const units = adapted.status === 'ready' || adapted.status === 'partial'
        ? adapted.input.units
        : [];
      const dispatched = units.some((unit) => unit.ruleId === ruleId);
      expect(dispatched, ruleId).toBe(SOURCE_RULE_POLICIES[ruleId].assessableFromSingleFile);
    }
  });
});
