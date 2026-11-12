/**
 * React source → ContextAdapterResult adapter.
 *
 * Converts a ReactSourceSnapshot into the ContextAdapterResult shape that the
 * existing contextualAssessmentScheduler expects, enabling AI job dispatch
 * without modifying the scheduler core.
 *
 * Key design:
 * - Uses "rs-N" IDs; never reuses HTML "t-N" IDs.
 * - Source locators carry JSX line/col/offset positions.
 * - Rule applicability is determined per-target by reactSourceRuleMap.
 * - Targets only dispatchable rules (assessableFromSingleFile = true).
 */

import type {
  AdaptedContextInput,
  AdapterCompleteness,
  AdapterUnitCompleteness,
  AriaAttributes,
  AssociatedTargetEvidence,
  AttributeObservation,
  BooleanAttributeState,
  BoundedAriaAttributes,
  BoundedString,
  ButtonTargetAttributes,
  CommonTargetAttributes,
  ContextAdapterResult,
  ContextCompleteness,
  CustomWidgetRole,
  DocumentContext,
  ExtractionTruncation,
  EvaluationTarget,
  FormControlTargetAttributes,
  HeadingTargetAttributes,
  ImageTargetAttributes,
  LinkTargetAttributes,
  OtherTargetAttributes,
  RecordCompleteness,
  RecordTruncation,
  SupportingEvidence,
  TargetContextInputUnit,
  TargetRelationshipProjection,
} from '../types/contextV2.js';
import { CONTEXT_SCHEMA_V2 } from '../types/contextV2.js';
import type {
  PropAvailability,
  ReactButtonTarget,
  ReactCustomWidgetTarget,
  ReactFormControlTarget,
  ReactHeadingTarget,
  ReactImageTarget,
  ReactLinkTarget,
  ReactLiteralChildren,
  ReactSourceLocation,
  ReactSourceSnapshot,
  ReactTarget,
} from '../types/reactSource.js';
import {
  getRulesForTargetKind,
  isRuleAssessableFromSingleFile,
} from './reactSourceRuleMap.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function propToBoundedString(prop: PropAvailability): AttributeObservation<BoundedString> {
  if (prop.status === 'present') {
    return { status: 'present', value: { value: prop.value, truncated: prop.truncated } };
  }
  if (prop.status === 'absent') {
    return { status: 'absent' };
  }
  // dynamic or unknown → unavailable (extraction-limit indicates "not captured")
  return { status: 'unavailable', reason: 'extraction-limit' };
}

function propToBooleanState(prop: PropAvailability): BooleanAttributeState {
  if (prop.status === 'present') return 'present';
  if (prop.status === 'absent') return 'absent';
  return 'unavailable';
}

function propToAriaBoolean(
  prop: PropAvailability,
): AttributeObservation<boolean> {
  if (prop.status === 'absent') return { status: 'absent' };
  if (prop.status !== 'present') {
    return { status: 'unavailable', reason: 'extraction-limit' };
  }
  const value = prop.value.toLowerCase();
  if (value === 'true' || value === 'false') {
    return { status: 'present', value: value === 'true' };
  }
  return {
    status: 'invalid',
    raw: { value: prop.value, truncated: prop.truncated },
  };
}

function propToAriaPressed(
  prop: PropAvailability,
): AttributeObservation<boolean | 'mixed'> {
  if (prop.status === 'absent') return { status: 'absent' };
  if (prop.status !== 'present') {
    return { status: 'unavailable', reason: 'extraction-limit' };
  }
  const value = prop.value.toLowerCase();
  if (value === 'true' || value === 'false') {
    return { status: 'present', value: value === 'true' };
  }
  if (value === 'mixed') return { status: 'present', value: 'mixed' };
  return {
    status: 'invalid',
    raw: { value: prop.value, truncated: prop.truncated },
  };
}

function propToAriaInvalid(
  prop: PropAvailability,
): AttributeObservation<boolean | 'grammar' | 'spelling'> {
  if (prop.status === 'absent') return { status: 'absent' };
  if (prop.status !== 'present') {
    return { status: 'unavailable', reason: 'extraction-limit' };
  }
  const value = prop.value.toLowerCase();
  if (value === 'true' || value === 'false') {
    return { status: 'present', value: value === 'true' };
  }
  if (value === 'grammar' || value === 'spelling') {
    return { status: 'present', value };
  }
  return {
    status: 'invalid',
    raw: { value: prop.value, truncated: prop.truncated },
  };
}

function childrenToText(children: ReactLiteralChildren | undefined): BoundedString | undefined {
  if (!children || !children.text) return undefined;
  return { value: children.text, truncated: children.truncated };
}

function buildBoundedAria(target: ReactTarget): BoundedAriaAttributes {
  const values: AriaAttributes = {};
  if (target.ariaLabel.status !== 'absent') {
    values['aria-label'] = propToBoundedString(target.ariaLabel);
  }
  if (target.ariaLabelledby.status !== 'absent') {
    values['aria-labelledby'] = propToBoundedString(target.ariaLabelledby);
  }
  if (target.ariaDescribedby.status !== 'absent') {
    values['aria-describedby'] = propToBoundedString(target.ariaDescribedby);
  }
  if (target.ariaHidden.status !== 'absent') {
    values['aria-hidden'] = propToAriaBoolean(target.ariaHidden);
  }
  if (target.ariaInvalid.status !== 'absent') {
    values['aria-invalid'] = propToAriaInvalid(target.ariaInvalid);
  }
  if (target.ariaLive.status !== 'absent') {
    values['aria-live'] = propToBoundedString(target.ariaLive);
  }
  if (target.kind === 'button') {
    if (target.ariaPressed.status !== 'absent') {
      values['aria-pressed'] = propToAriaPressed(target.ariaPressed);
    }
    if (target.ariaExpanded.status !== 'absent') {
      values['aria-expanded'] = propToAriaBoolean(target.ariaExpanded);
    }
    if (target.ariaDisabled.status !== 'absent') {
      values['aria-disabled'] = propToAriaBoolean(target.ariaDisabled);
    }
  }
  return { values, truncated: false };
}

function buildCommonAttrs(target: ReactTarget): CommonTargetAttributes {
  return {
    authoredId: propToBoundedString(target.idProp),
    role: propToBoundedString(target.role),
    aria: buildBoundedAria(target),
    title: propToBoundedString(target.title),
    hidden: 'absent',
    inert: 'absent',
    tabIndex: { status: 'absent' },
  };
}

const RECORD_COMPLETE: RecordCompleteness = { status: 'complete' };
const MAX_SOURCE_ASSOCIATED_EVIDENCE = 11;

function sourceLanguage(snapshot: ReactSourceSnapshot): 'jsx' | 'tsx' {
  return /\.tsx$/i.test(snapshot.filename) ? 'tsx' : 'jsx';
}

function getTargetProps(target: ReactTarget): Array<[string, PropAvailability]> {
  const props: Array<[string, PropAvailability]> = [
    ['aria-label', target.ariaLabel],
    ['aria-labelledby', target.ariaLabelledby],
    ['aria-describedby', target.ariaDescribedby],
    ['aria-errormessage', target.ariaErrormessage],
    ['aria-hidden', target.ariaHidden],
    ['aria-invalid', target.ariaInvalid],
    ['aria-live', target.ariaLive],
    ['role', target.role],
    ['id', target.idProp],
    ['title', target.title],
    ['className', target.className],
  ];
  switch (target.kind) {
    case 'image':
      props.push(['alt', target.alt], ['src', target.src]);
      break;
    case 'button':
      props.push(
        ['type', target.buttonType],
        ['disabled', target.disabled],
        ['aria-pressed', target.ariaPressed],
        ['aria-expanded', target.ariaExpanded],
        ['aria-disabled', target.ariaDisabled],
      );
      break;
    case 'link':
      props.push(['href', target.href]);
      break;
    case 'form-control':
      props.push(
        ['type', target.inputType],
        ['placeholder', target.placeholder],
        ['name', target.name],
        ['required', target.required],
        ['disabled', target.disabled],
        ['autoComplete', target.autoComplete],
      );
      break;
    default:
      break;
  }
  return props;
}

function getRecordCompleteness(
  target: ReactTarget,
  snapshot: ReactSourceSnapshot,
): RecordCompleteness {
  const truncations = new Set<RecordTruncation>();
  if (target.literalChildren?.truncated) truncations.add('text-limit');
  if (target.sourceExcerptTruncated) truncations.add('text-limit');
  for (const [name, prop] of getTargetProps(target)) {
    if (prop.status === 'present' && prop.truncated) {
      truncations.add(name.startsWith('aria-') ? 'aria-attribute-limit' : 'attribute-value-limit');
    }
  }
  if (snapshot.parseErrors.length > 0) truncations.add('parser-diagnostic');
  if (truncations.size === 0) return RECORD_COMPLETE;
  return {
    status: 'partial',
    truncations: [...truncations] as [RecordTruncation, ...RecordTruncation[]],
  };
}

function getTextCompleteness(
  text: ReactLiteralChildren | undefined,
  snapshot: ReactSourceSnapshot,
): RecordCompleteness {
  const truncations = new Set<RecordTruncation>();
  if (text?.truncated) truncations.add('text-limit');
  if (snapshot.parseErrors.length > 0) truncations.add('parser-diagnostic');
  if (truncations.size === 0) return RECORD_COMPLETE;
  return {
    status: 'partial',
    truncations: [...truncations] as [RecordTruncation, ...RecordTruncation[]],
  };
}

function getSourceEvidence(
  target: ReactTarget,
  omittedAssociatedEvidenceCount: number,
) {
  return {
    hasDynamicChildren: target.literalChildren?.hasDynamicChildren ?? false,
    hasPropSpread: target.hasPropSpread,
    className: propToBoundedString(target.className),
    ...(target.componentName ? { componentName: target.componentName } : {}),
    sourceExcerptTruncated: target.sourceExcerptTruncated,
    ...(omittedAssociatedEvidenceCount > 0
      ? { omittedAssociatedEvidenceCount }
      : {}),
    dynamicAttributes: getTargetProps(target)
      .filter(([, prop]) => prop.status === 'dynamic' || prop.status === 'unknown')
      .map(([name]) => name),
    ancestors: target.ancestors.map((ancestor) => ({
      recordId: ancestor.recordId,
      tagName: ancestor.tagName,
      ...(ancestor.role ? { role: ancestor.role } : {}),
      ...(ancestor.literalChildren?.text
        ? {
            text: {
              value: ancestor.literalChildren.text,
              truncated: ancestor.literalChildren.truncated,
            },
          }
        : {}),
      hasDynamicChildren: ancestor.literalChildren?.hasDynamicChildren ?? false,
    })),
  };
}

function buildEvaluationTarget(
  target: ReactTarget,
  snapshot: ReactSourceSnapshot,
): EvaluationTarget {
  const text = childrenToText(target.literalChildren);
  const sourceLocator = {
    kind: 'jsx-source-range' as const,
    startOffset: target.loc.startOffset,
    endOffset: target.loc.endOffset,
    sourceLanguage: sourceLanguage(snapshot),
    offsetUnit: 'utf16-code-unit' as const,
  };
  const common = buildCommonAttrs(target);
  const completeness = getRecordCompleteness(target, snapshot);

  if (target.kind === 'image') {
    const img = target as ReactImageTarget;
    const attrs: ImageTargetAttributes = {
      ...common,
      alt: propToBoundedString(img.alt),
      src: propToBoundedString(img.src),
    };
    return {
      id: target.id,
      tagName: target.tagName,
      text,
      sourceLocator,
      completeness,
      kind: 'image',
      basis: { type: 'native-html' },
      attributes: attrs,
    };
  }

  if (target.kind === 'button') {
    const btn = target as ReactButtonTarget;
    const attrs: ButtonTargetAttributes = {
      ...common,
      disabled: propToBooleanState(btn.disabled),
      inputType: propToBoundedString(btn.buttonType),
      value: { status: 'absent' },
    };
    return {
      id: target.id,
      tagName: target.tagName,
      text,
      sourceLocator,
      completeness,
      kind: 'button',
      basis: { type: 'native-html' },
      attributes: attrs,
    };
  }

  if (target.kind === 'link') {
    const link = target as ReactLinkTarget;
    const attrs: LinkTargetAttributes = {
      ...common,
      href: propToBoundedString(link.href),
    };
    return {
      id: target.id,
      tagName: target.tagName,
      text,
      sourceLocator,
      completeness,
      kind: 'link',
      basis: { type: 'native-html' },
      attributes: attrs,
    };
  }

  if (target.kind === 'form-control') {
    const ctrl = target as ReactFormControlTarget;
    const attrs: FormControlTargetAttributes = {
      ...common,
      inputType: propToBoundedString(ctrl.inputType),
      name: propToBoundedString(ctrl.name),
      placeholder: propToBoundedString(ctrl.placeholder),
      autoComplete: propToBoundedString(ctrl.autoComplete),
      required: propToBooleanState(ctrl.required),
      disabled: propToBooleanState(ctrl.disabled),
    };
    return {
      id: target.id,
      tagName: target.tagName,
      text,
      sourceLocator,
      completeness,
      kind: 'form-control',
      basis: { type: 'native-html' },
      attributes: attrs,
    };
  }

  if (target.kind === 'heading') {
    const h = target as ReactHeadingTarget;
    const attrs: HeadingTargetAttributes = { ...common };
    return {
      id: target.id,
      tagName: target.tagName,
      text,
      sourceLocator,
      completeness,
      kind: 'heading',
      basis: { type: 'native-html' },
      headingLevel: h.headingLevel,
      attributes: attrs,
    };
  }

  if (target.kind === 'custom-widget') {
    const cw = target as ReactCustomWidgetTarget;
    // Only known CustomWidgetRole values are allowed; fall back to 'other' if not in set
    const knownRoles = new Set<CustomWidgetRole>([
      'button', 'link', 'checkbox', 'radio', 'switch', 'slider',
      'textbox', 'combobox', 'listbox', 'searchbox', 'spinbutton',
    ]);
    if (knownRoles.has(cw.resolvedRole as CustomWidgetRole)) {
      return {
        id: target.id,
        tagName: target.tagName,
        text,
        sourceLocator,
        completeness,
        kind: 'custom-widget',
        basis: { type: 'aria-widget', role: cw.resolvedRole as CustomWidgetRole },
        attributes: { ...common },
      };
    }
  }

  // text-content and unrecognized → 'other'
  const attrs: OtherTargetAttributes = { ...common };
  return {
    id: target.id,
    tagName: target.tagName,
    text,
    sourceLocator,
    completeness,
    kind: 'other',
    basis: { type: 'explicit-policy', policyId: 'react-source-text' },
    attributes: attrs,
  };
}

function sourceLocatorFor(
  loc: ReactSourceLocation,
  language: 'jsx' | 'tsx',
) {
  return {
    kind: 'jsx-source-range' as const,
    startOffset: loc.startOffset,
    endOffset: loc.endOffset,
    sourceLanguage: language,
    offsetUnit: 'utf16-code-unit' as const,
  };
}

function buildAssociatedEvidence(
  target: ReactTarget,
  snapshot: ReactSourceSnapshot,
): AssociatedTargetEvidence[] {
  const result: AssociatedTargetEvidence[] = [];
  const language = sourceLanguage(snapshot);

  if (target.kind === 'form-control') {
    const ctrl = target as ReactFormControlTarget;
    if (ctrl.associatedLabel) {
      const labelText = ctrl.associatedLabel.labelText;
      const labelRecord = snapshot.labels.find(
        (label) => label.id === ctrl.associatedLabel?.recordId,
      );
      const ev: SupportingEvidence = {
        id: ctrl.associatedLabel.recordId,
        kind: 'native-label',
        tagName: 'label',
        ...(labelText?.text
          ? { text: { value: labelText.text, truncated: labelText.truncated } }
          : {}),
        ...(labelRecord
          ? { sourceLocator: sourceLocatorFor(labelRecord.loc, language) }
          : {}),
        completeness: RECORD_COMPLETE,
      };
      const rel: TargetRelationshipProjection = {
        relationshipId: `rel-${target.id}-${ctrl.associatedLabel.recordId}`,
        focalTargetId: target.id,
        kind: 'native-label',
        destination: {
          status: 'resolved',
          record: { recordType: 'evidence', id: ctrl.associatedLabel.recordId },
        },
        direction: 'target-to-associated-record',
        provenance: {
          basis: 'native-html',
          ...(ctrl.associatedLabel.reference?.status === 'resolved'
            ? {
                attribute: 'for' as const,
                authoredReference: {
                  value: ctrl.associatedLabel.reference.targetId,
                  truncated: false,
                },
              }
            : {}),
        },
        completeness: { status: 'complete' },
      };
      result.push({
        evidence: ev,
        relationships: [rel],
        sourceEvidence: {
          hasDynamicChildren: labelText?.hasDynamicChildren ?? false,
        },
      });
    }
  }

  const ariaReferences = [
    {
      kind: 'aria-labelledby' as const,
      attribute: 'aria-labelledby' as const,
      value: target.ariaLabelledby,
      reference: target.ariaLabelledbyRef,
    },
    {
      kind: 'aria-describedby' as const,
      attribute: 'aria-describedby' as const,
      value: target.ariaDescribedby,
      reference: target.ariaDescribedbyRef,
    },
    {
      kind: 'aria-errormessage' as const,
      attribute: 'aria-errormessage' as const,
      value: target.ariaErrormessage,
      reference: target.ariaErrormessageRef,
    },
  ];
  const seenRecords = new Set<string>();
  for (const ariaReference of ariaReferences) {
    if (
      ariaReference.reference?.status !== 'resolved' ||
      ariaReference.value.status !== 'present'
    ) {
      continue;
    }
    for (const referencedTarget of ariaReference.reference.targets) {
      const evidenceKey = `${ariaReference.attribute}:${referencedTarget.targetRecordId}`;
      if (seenRecords.has(evidenceKey)) continue;
      seenRecords.add(evidenceKey);
      const evidence: SupportingEvidence = {
        id: referencedTarget.targetRecordId,
        kind: 'aria-reference',
        tagName: referencedTarget.tagName,
        ...(referencedTarget.text?.text
          ? {
              text: {
                value: referencedTarget.text.text,
                truncated: referencedTarget.text.truncated,
              },
            }
          : {}),
        sourceLocator: sourceLocatorFor(referencedTarget.loc, language),
        completeness: getTextCompleteness(referencedTarget.text, snapshot),
      };
      const relationship: TargetRelationshipProjection = {
        relationshipId: `rel-${target.id}-${ariaReference.attribute}-${referencedTarget.targetRecordId}`,
        focalTargetId: target.id,
        kind: ariaReference.kind,
        destination: {
          status: 'resolved',
          record: { recordType: 'evidence', id: referencedTarget.targetRecordId },
        },
        direction: 'target-to-associated-record',
        provenance: {
          basis: 'aria-idref',
          attribute: ariaReference.attribute,
          authoredReference: {
            value: ariaReference.value.value,
            truncated: ariaReference.value.truncated,
          },
        },
        completeness: { status: 'complete' },
      };
      result.push({
        evidence,
        relationships: [relationship],
        sourceEvidence: {
          hasDynamicChildren: referencedTarget.text?.hasDynamicChildren ?? false,
        },
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts a ReactSourceSnapshot into a ContextAdapterResult that the
 * existing contextualAssessmentScheduler can dispatch jobs from.
 *
 * Returns 'empty' when no eligible targets exist, 'unavailable' when
 * snapshot is invalid, and 'ready'/'partial' otherwise.
 */
export function adaptReactSourceSnapshot(
  snapshot: ReactSourceSnapshot,
): ContextAdapterResult {
  const units: TargetContextInputUnit[] = [];
  const language = sourceLanguage(snapshot);

  for (const target of snapshot.targets) {
    const applicableRules = getRulesForTargetKind(target.kind);
    if (applicableRules.length === 0) continue;

    const focalTarget = buildEvaluationTarget(target, snapshot);
    const allAssociatedEvidence = buildAssociatedEvidence(target, snapshot);
    const associatedEvidence = allAssociatedEvidence.slice(
      0,
      MAX_SOURCE_ASSOCIATED_EVIDENCE,
    );
    const omittedAssociatedEvidenceCount =
      allAssociatedEvidence.length - associatedEvidence.length;
    const relationships = associatedEvidence.flatMap((ae) => ae.relationships);

    const unitCompleteness: AdapterUnitCompleteness =
      omittedAssociatedEvidenceCount > 0
        ? {
            status: 'partial',
            truncations: ['associated-evidence-count', 'relationship-omitted'],
            omittedEvidenceCount: omittedAssociatedEvidenceCount,
          }
        : { status: 'complete', truncations: [] };

    for (const ruleId of applicableRules) {
      if (!isRuleAssessableFromSingleFile(ruleId)) continue;
      if (ruleId === 'FORM-PLACEHOLDER-ONLY' && target.kind === 'form-control') {
        const ctrl = target as ReactFormControlTarget;
        if (ctrl.placeholder.status !== 'present') continue;
      }
      if (ruleId === 'IMG-ALT-CLARITY' || ruleId === 'IMG-ALT-REDUNDANCY') {
        const img = target as ReactImageTarget;
        if (img.alt.status !== 'present' || !img.alt.value.trim()) continue;
      }
      if (
        ruleId.startsWith('ARIA-') &&
        target.ariaLabel.status === 'absent' &&
        target.ariaLabelledby.status === 'absent' &&
        target.role.status === 'absent'
      ) {
        continue;
      }

      units.push({
        focal: focalTarget,
        associatedEvidence,
        relationships,
        completeness: unitCompleteness,
        ruleId,
        sourceLanguage: language,
        sourceEvidence: getSourceEvidence(
          target,
          omittedAssociatedEvidenceCount,
        ),
        sourceLocation: {
          file: target.loc.file,
          startLine: target.loc.startLine,
          startColumn: target.loc.startColumn,
          endLine: target.loc.endLine,
          endColumn: target.loc.endColumn,
        },
        snippet: target.sourceExcerpt,
      });
    }
  }

  const docContext: DocumentContext = {
    title: { status: 'absent' },
    language: { status: 'absent' },
  };

  const unresolvedCount = snapshot.targets.reduce((count, target) => {
    const references = [
      target.ariaLabelledbyRef,
      target.ariaDescribedbyRef,
      target.ariaErrormessageRef,
      target.kind === 'form-control' ? target.associatedLabel?.reference : undefined,
    ];
    return count + references.filter(
      (reference) =>
        reference?.status === 'unresolved' &&
        reference.reason !== 'duplicate',
    ).length;
  }, 0);
  const ambiguousCount = snapshot.targets.reduce((count, target) => {
    const references = [
      target.ariaLabelledbyRef,
      target.ariaDescribedbyRef,
      target.ariaErrormessageRef,
      target.kind === 'form-control' ? target.associatedLabel?.reference : undefined,
    ];
    return count + references.filter(
      (reference) =>
        reference?.status === 'unresolved' && reference.reason === 'duplicate',
    ).length;
  }, 0);
  const unknownCount = snapshot.targets.reduce((count, target) => {
    const references = [
      target.ariaLabelledbyRef,
      target.ariaDescribedbyRef,
      target.ariaErrormessageRef,
      target.kind === 'form-control' ? target.associatedLabel?.reference : undefined,
    ];
    return count + references.filter((reference) => reference?.status === 'dynamic').length;
  }, 0);
  const truncationLimits = snapshot.completeness.status === 'partial'
    ? [...new Set(snapshot.completeness.reasons.map((reason) => {
        switch (reason) {
          case 'element-limit-reached':
            return 'record-count' as const;
          case 'text-truncated':
            return 'text-length' as const;
          case 'attribute-truncated':
            return 'attribute-value-length' as const;
          case 'source-excerpt-truncated':
            return 'text-length' as const;
          case 'parse-errors-present':
            return 'parser-diagnostic' as const;
          case 'size-limit-exceeded':
            return 'record-count' as const;
        }
      }))]
    : [];
  const extractionCompleteness: ContextCompleteness =
    truncationLimits.length === 0
      ? {
          status: 'complete',
          truncations: [],
          policyOmissions: [],
          relationshipResolution: { unresolvedCount, ambiguousCount, unknownCount },
        }
      : {
          status: 'partial',
          truncations: truncationLimits.map((limit): ExtractionTruncation => ({
            scope: 'snapshot',
            limit,
          })) as [ExtractionTruncation, ...ExtractionTruncation[]],
          policyOmissions: [],
          relationshipResolution: { unresolvedCount, ambiguousCount, unknownCount },
        };

  const adapterCompleteness: AdapterCompleteness = { status: 'complete', truncations: [] };

  const input: AdaptedContextInput = {
    document: docContext,
    units,
    extractionCompleteness,
    adapterCompleteness,
  };

  if (units.length === 0) {
    return {
      status: 'empty',
      input: {
        ...input,
        units: [],
        extractionCompleteness: {
          status: 'complete',
          truncations: [],
          policyOmissions: [],
          relationshipResolution: { unresolvedCount: 0, ambiguousCount: 0 },
        },
        adapterCompleteness: { status: 'complete', truncations: [] },
      },
    };
  }

  if (snapshot.completeness.status === 'partial') {
    return {
      status: 'partial',
      input: {
        ...input,
        units: units as [TargetContextInputUnit, ...TargetContextInputUnit[]],
        extractionCompleteness: extractionCompleteness as Extract<ContextCompleteness, { status: 'partial' }>,
      },
    };
  }

  return {
    status: 'ready',
    input: {
      ...input,
      units: units as [TargetContextInputUnit, ...TargetContextInputUnit[]],
      extractionCompleteness: extractionCompleteness as Extract<ContextCompleteness, { status: 'complete' }>,
      adapterCompleteness: adapterCompleteness as Extract<AdapterCompleteness, { status: 'complete' }>,
    },
  };
}
