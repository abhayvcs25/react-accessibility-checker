/**
 * React source rule map — defines which of the 20 contextual rules are
 * assessable from a single .jsx/.tsx file, what evidence is extractable,
 * and what prerequisites are unavailable.
 *
 * This is the single authoritative source of rule/evidence policy for the
 * React source analysis stage. Frontend and backend both reference this
 * contract to avoid divergent rule definitions.
 */

import type { ReactTargetKind } from '../types/reactSource.js';

/**
 * All 20 contextual rule IDs from docs/contextual-accessibility-rules.md.
 */
export const ALL_RULE_IDS = [
  'IMG-ALT-RELEVANCE',
  'IMG-ALT-CLARITY',
  'IMG-ALT-REDUNDANCY',
  'BUTTON-PURPOSE-CLARITY',
  'BUTTON-NAME-AMBIGUITY',
  'BUTTON-ACTION-CONSISTENCY',
  'LINK-PURPOSE-CLARITY',
  'LINK-GENERIC-TEXT',
  'LINK-SIMILAR-CHOICES',
  'FORM-LABEL-RELEVANCE',
  'FORM-LABEL-AMBIGUITY',
  'FORM-PLACEHOLDER-ONLY',
  'ARIA-NAME-CLARITY',
  'ARIA-NAMING-CONSISTENCY',
  'ARIA-NAME-CONFLICT',
  'HEADING-CLARITY',
  'HEADING-CONTENT-RELEVANCE',
  'CONTENT-INSTRUCTION-AMBIGUITY',
  'CONTENT-ERROR-CLARITY',
  'CONTENT-TERM-CONSISTENCY',
] as const;

export type SourceRuleId = (typeof ALL_RULE_IDS)[number];

/**
 * Evidence availability categories for a rule in single-file source analysis.
 */
export type EvidenceAvailability =
  | 'static-extractable'      // Can be extracted from the AST
  | 'partial-static'          // Some evidence extractable; key prerequisite missing
  | 'not-available';          // Cannot be established from a single-file AST alone

/**
 * What a single-file static AST analysis can and cannot do for each rule.
 */
export interface RuleSourcePolicy {
  ruleId: SourceRuleId;
  /**
   * Which JSX target kinds are relevant to this rule.
   */
  applicableTargetKinds: ReactTargetKind[];
  /**
   * What static evidence is extractable.
   */
  extractableEvidence: string[];
  /**
   * What prerequisites are unavailable and why.
   */
  unavailablePrerequisites: string[];
  /**
   * Overall evidence availability for single-file assessment.
   */
  evidenceAvailability: EvidenceAvailability;
  /**
   * AI rule guidance string for the scheduler prompt.
   * Must not duplicate the rule definition; references the rule ID.
   */
  ruleGuidance: string;
  /**
   * Whether this rule can be dispatched for assessment in single-file mode.
   * If false, the report marks the rule as deferred in rule coverage.
   */
  assessableFromSingleFile: boolean;
}

export const SOURCE_RULE_POLICIES: Record<SourceRuleId, RuleSourcePolicy> = {
  'IMG-ALT-RELEVANCE': {
    ruleId: 'IMG-ALT-RELEVANCE',
    applicableTargetKinds: ['image'],
    extractableEvidence: [
      'Authored alt attribute (present/absent/empty/dynamic)',
      'src attribute string',
      'JSX ancestor structure (link parent, figure, heading)',
      'Literal sibling/children text',
    ],
    unavailablePrerequisites: [
      'Actual image pixels (requires [IMAGE])',
      'Computed accessible name (requires [BROWSER])',
      'Route/page context (requires [PROJECT])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Image content and purpose cannot be established from a single source file. ' +
      'Extract alt/src and static context, but defer the relevance assessment until an approved image-evidence path exists.',
    assessableFromSingleFile: false,
  },

  'IMG-ALT-CLARITY': {
    ruleId: 'IMG-ALT-CLARITY',
    applicableTargetKinds: ['image'],
    extractableEvidence: [
      'Authored alt text (exact string)',
      'src attribute',
      'Literal ancestor/sibling text',
      'JSX structural context',
    ],
    unavailablePrerequisites: [
      'Image purpose established by pixels (requires [IMAGE])',
      'Full rendered context (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Image purpose cannot be established from a single source file. ' +
      'Extract authored alt text, but defer clarity assessment until an approved image-evidence path exists.',
    assessableFromSingleFile: false,
  },

  'IMG-ALT-REDUNDANCY': {
    ruleId: 'IMG-ALT-REDUNDANCY',
    applicableTargetKinds: ['image'],
    extractableEvidence: [
      'Authored alt text',
      'Role attribute',
      'Literal adjacent/figure text from JSX',
    ],
    unavailablePrerequisites: [
      'Computed accessible context (requires [BROWSER])',
      'Full surrounding prose (may require [PROJECT])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Detect only when the supplied source evidence explicitly shows the alt phrase adds no information because it literally repeats established context or announces image role redundantly. ' +
      'Do not flag without sufficient surrounding context. ' +
      'Use insufficient_context when surrounding/accessible context is not captured.',
    assessableFromSingleFile: true,
  },

  'BUTTON-PURPOSE-CLARITY': {
    ruleId: 'BUTTON-PURPOSE-CLARITY',
    applicableTargetKinds: ['button', 'custom-widget'],
    extractableEvidence: [
      'Literal button text (children)',
      'aria-label attribute',
      'type attribute',
      'Enclosing form/section context (JSX ancestors)',
      'Explicit aria-labelledby reference (resolved in-file)',
    ],
    unavailablePrerequisites: [
      'Computed accessible name (requires [BROWSER])',
      'Handler/action behavior (requires [REACT] source analysis or runtime)',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Assess semantic clarity of the button name from the supplied authored text, aria-label, and static JSX ancestor context only. ' +
      'Do not calculate a browser-computed accessible name. ' +
      'Do not infer handler behavior. ' +
      'Report only the name-presence subcheck deterministically; use insufficient_context for semantic/behavior subchecks when required evidence is absent.',
    assessableFromSingleFile: true,
  },

  'BUTTON-NAME-AMBIGUITY': {
    ruleId: 'BUTTON-NAME-AMBIGUITY',
    applicableTargetKinds: ['button', 'custom-widget'],
    extractableEvidence: [
      'Authored literal button text',
      'aria-label',
      'JSX ancestor context',
      'Other button names in the same file',
    ],
    unavailablePrerequisites: [
      'Computed name (requires [BROWSER])',
      'Full dialog/state context (requires [BROWSER] or [REACT])',
      'Cross-component equivalence (requires [PROJECT])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Identify ambiguity only when supplied evidence shows at least two materially different plausible interpretations and the available context does not disambiguate them. ' +
      'Generic or repeated names alone are not proof of ambiguity. ' +
      'Use insufficient_context when action/purpose context is not captured.',
    assessableFromSingleFile: true,
  },

  'BUTTON-ACTION-CONSISTENCY': {
    ruleId: 'BUTTON-ACTION-CONSISTENCY',
    applicableTargetKinds: ['button', 'custom-widget'],
    extractableEvidence: [
      'Authored button text/aria-label',
      'type attribute (submit/reset)',
    ],
    unavailablePrerequisites: [
      'Actual handler/action behavior (requires [REACT] or runtime)',
      'Cross-component equivalence (requires [PROJECT])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Assess name-action consistency only when actual button behavior is established from the supplied evidence. ' +
      'A handler reference or onClick attribute alone does not establish behavior. ' +
      'Use insufficient_context when behavior is unknown.',
    assessableFromSingleFile: false,
  },

  'LINK-PURPOSE-CLARITY': {
    ruleId: 'LINK-PURPOSE-CLARITY',
    applicableTargetKinds: ['link'],
    extractableEvidence: [
      'Literal link text (children)',
      'aria-label',
      'href attribute string',
      'JSX ancestor/sibling text context',
    ],
    unavailablePrerequisites: [
      'Computed accessible name (requires [BROWSER])',
      'Destination page title or content (requires URL fetch or [PROJECT])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Assess link purpose clarity from authored name and statically available JSX context. ' +
      'Do not treat href as a verified destination. ' +
      'Use insufficient_context when the name alone is insufficient and surrounding context is not captured.',
    assessableFromSingleFile: true,
  },

  'LINK-GENERIC-TEXT': {
    ruleId: 'LINK-GENERIC-TEXT',
    applicableTargetKinds: ['link'],
    extractableEvidence: [
      'Literal link text',
      'href string',
      'Enclosing JSX ancestor text',
      'Other same-file link names',
    ],
    unavailablePrerequisites: [
      'Destination content (requires URL fetch)',
      'Full computed programmatic context (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Flag generic wording (e.g. "click here", "read more", "learn more") only when the supplied JSX context confirms no programmatic association distinguishes the link. ' +
      'A candidate lexicon hit alone does not prove an issue. ' +
      'Use insufficient_context when surrounding/programmatic context is not captured.',
    assessableFromSingleFile: true,
  },

  'LINK-SIMILAR-CHOICES': {
    ruleId: 'LINK-SIMILAR-CHOICES',
    applicableTargetKinds: ['link'],
    extractableEvidence: [
      'All literal link texts in the file',
      'href strings',
      'JSX structural grouping',
    ],
    unavailablePrerequisites: [
      'Rendered visual similarity (requires [BROWSER])',
      'Destination identity (requires [PROJECT] or URL fetch)',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Identify textually similar links with structurally distinct hrefs as candidates only. ' +
      'Do not claim visual similarity from DOM structure. ' +
      'Use insufficient_context when destination identity or rendered context is unavailable.',
    assessableFromSingleFile: false,
  },

  'FORM-LABEL-RELEVANCE': {
    ruleId: 'FORM-LABEL-RELEVANCE',
    applicableTargetKinds: ['form-control'],
    extractableEvidence: [
      'Control type (input type, select, textarea)',
      'Resolved htmlFor/id label association (in-file)',
      'Literal label text',
      'placeholder attribute',
      'name attribute',
      'aria-label/aria-labelledby',
      'Enclosing form/fieldset JSX context',
    ],
    unavailablePrerequisites: [
      'Computed accessible name (requires [BROWSER])',
      'Business expected value (requires application context)',
      'Validation/error state (requires runtime)',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Assess label relevance against the supplied control type, explicit label association, and enclosing form context. ' +
      'A native input type (email, url, number, tel) is evidence of format constraint; label conflict with that constraint may be a potential issue. ' +
      'Do not infer business purpose from the name attribute alone. ' +
      'Use insufficient_context when expected information is not established by the supplied context.',
    assessableFromSingleFile: true,
  },

  'FORM-LABEL-AMBIGUITY': {
    ruleId: 'FORM-LABEL-AMBIGUITY',
    applicableTargetKinds: ['form-control'],
    extractableEvidence: [
      'Literal label text',
      'Control type',
      'Sibling controls and their labels (same file)',
      'Enclosing fieldset/form context',
    ],
    unavailablePrerequisites: [
      'Task/workflow semantics (requires application context)',
      'Computed name (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Identify label ambiguity only when the supplied form context shows two or more materially different plausible expected inputs and the context does not disambiguate. ' +
      'Short or repeated labels alone are not failures. ' +
      'Use insufficient_context when task/form context is insufficient.',
    assessableFromSingleFile: true,
  },

  'FORM-PLACEHOLDER-ONLY': {
    ruleId: 'FORM-PLACEHOLDER-ONLY',
    applicableTargetKinds: ['form-control'],
    extractableEvidence: [
      'placeholder attribute (present/absent)',
      'Explicit label association (htmlFor/id, aria-label, aria-labelledby)',
      'Control type',
    ],
    unavailablePrerequisites: [
      'Rendered visible label persistence (requires [BROWSER])',
      'Computed accessible name (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Report a placeholder-only candidate when: a placeholder is present AND no explicit native label association, aria-label, or aria-labelledby is captured. ' +
      'Do not infer visible label presence from an accessible name. ' +
      'Note that browser rendering is required to confirm persistent visible label absence.',
    assessableFromSingleFile: true,
  },

  'ARIA-NAME-CLARITY': {
    ruleId: 'ARIA-NAME-CLARITY',
    applicableTargetKinds: ['button', 'link', 'form-control', 'custom-widget', 'image'],
    extractableEvidence: [
      'aria-label value',
      'aria-labelledby reference and resolved target text (in-file)',
      'Literal children text',
      'Role attribute',
    ],
    unavailablePrerequisites: [
      'Browser-computed accessible name (requires [BROWSER])',
      'Full rendered visible text (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'A source-only capture does not provide the browser-computed accessible name or rendered visibility required by this rule. ' +
      'Do not dispatch an assessment or infer a computed name from authored ARIA inputs.',
    assessableFromSingleFile: false,
  },

  'ARIA-NAMING-CONSISTENCY': {
    ruleId: 'ARIA-NAMING-CONSISTENCY',
    applicableTargetKinds: ['button', 'link', 'form-control', 'custom-widget'],
    extractableEvidence: [
      'All aria-label / aria-labelledby values in the file',
      'Role attributes',
    ],
    unavailablePrerequisites: [
      'Cross-file/cross-component equivalence (requires [PROJECT])',
      'Computed names (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Compare ARIA naming patterns within the same file. ' +
      'Cross-component and cross-file consistency requires project-level context. ' +
      'Use insufficient_context when equivalence cannot be established from the supplied evidence.',
    assessableFromSingleFile: false,
  },

  'ARIA-NAME-CONFLICT': {
    ruleId: 'ARIA-NAME-CONFLICT',
    applicableTargetKinds: ['button', 'link', 'form-control', 'custom-widget', 'image'],
    extractableEvidence: [
      'aria-label value',
      'aria-labelledby reference',
      'Literal children text',
      'Role',
    ],
    unavailablePrerequisites: [
      'Browser-computed accessible name precedence (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'A source-only capture does not establish computed-name precedence or rendered visibility. ' +
      'Retain the authored naming sources as evidence, but defer the conflict assessment.',
    assessableFromSingleFile: false,
  },

  'HEADING-CLARITY': {
    ruleId: 'HEADING-CLARITY',
    applicableTargetKinds: ['heading'],
    extractableEvidence: [
      'Literal heading text',
      'Heading level',
      'JSX ancestor context',
    ],
    unavailablePrerequisites: [
      'Full section content (may be dynamic or in other files)',
      'Rendered page context (requires [BROWSER])',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Assess whether the literal heading text is clear and informative based on the supplied source evidence. ' +
      'Do not claim section coverage where conditional or dynamic content could change it. ' +
      'Use insufficient_context when surrounding section context is not captured.',
    assessableFromSingleFile: true,
  },

  'HEADING-CONTENT-RELEVANCE': {
    ruleId: 'HEADING-CONTENT-RELEVANCE',
    applicableTargetKinds: ['heading'],
    extractableEvidence: [
      'Literal heading text',
      'Literal sibling/children text in JSX',
      'JSX structural grouping',
    ],
    unavailablePrerequisites: [
      'Full rendered section boundary (requires [BROWSER])',
      'Dynamic content not in this file',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Assess heading-to-content relevance only when the supplied JSX source evidence captures both the heading and its static content siblings. ' +
      'Do not claim a complete section boundary where dynamic or conditional content could change it. ' +
      'Use insufficient_context when section content is not captured.',
    assessableFromSingleFile: true,
  },

  'CONTENT-INSTRUCTION-AMBIGUITY': {
    ruleId: 'CONTENT-INSTRUCTION-AMBIGUITY',
    applicableTargetKinds: ['text-content', 'form-control'],
    extractableEvidence: [
      'Literal instruction/helper text',
      'Associated form/control context (JSX)',
    ],
    unavailablePrerequisites: [
      'Current workflow state (requires runtime)',
      'Error validator cause (requires runtime)',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Assess whether literal instruction text in the supplied source is ambiguous or unclear in its static context. ' +
      'Do not claim workflow or error state without runtime evidence. ' +
      'Use insufficient_context when instruction context is not established.',
    assessableFromSingleFile: true,
  },

  'CONTENT-ERROR-CLARITY': {
    ruleId: 'CONTENT-ERROR-CLARITY',
    applicableTargetKinds: ['text-content', 'form-control'],
    extractableEvidence: [
      'Literal error message text (statically visible)',
      'aria-errormessage reference (resolved in-file)',
      'Associated control type',
    ],
    unavailablePrerequisites: [
      'Whether error is active/visible (requires runtime)',
      'Validator cause (requires runtime)',
    ],
    evidenceAvailability: 'partial-static',
    ruleGuidance:
      'Single-file source cannot establish active validation state, failure cause, or the applicable constraint. ' +
      'Keep extracted error text and ARIA association as evidence, but defer the semantic assessment.',
    assessableFromSingleFile: false,
  },

  'CONTENT-TERM-CONSISTENCY': {
    ruleId: 'CONTENT-TERM-CONSISTENCY',
    applicableTargetKinds: ['text-content', 'button', 'link', 'heading'],
    extractableEvidence: [
      'All literal text in the file',
    ],
    unavailablePrerequisites: [
      'Full project terminology (requires [PROJECT])',
      'Verified concept equivalence (requires [PROJECT] or domain knowledge)',
    ],
    evidenceAvailability: 'not-available',
    ruleGuidance:
      'Single-file analysis cannot establish full project terminology consistency or verified concept equivalence. ' +
      'Always use insufficient_context for this rule in single-file mode.',
    assessableFromSingleFile: false,
  },
};

/**
 * Returns the rule IDs applicable to a given target kind.
 */
export function getRulesForTargetKind(kind: ReactTargetKind): SourceRuleId[] {
  return ALL_RULE_IDS.filter((ruleId) =>
    SOURCE_RULE_POLICIES[ruleId].applicableTargetKinds.includes(kind),
  );
}

/**
 * Returns whether a rule can produce non-insufficient_context assessments
 * from single-file evidence.
 */
export function isRuleAssessableFromSingleFile(ruleId: SourceRuleId): boolean {
  return SOURCE_RULE_POLICIES[ruleId].assessableFromSingleFile;
}

