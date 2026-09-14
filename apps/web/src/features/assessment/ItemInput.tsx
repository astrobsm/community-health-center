import type { JSX } from 'react';

import type { Answer } from '@chc/contracts';

export interface TemplateItem {
  id: string;
  code: string;
  question: string;
  helpText: string | null;
  responseType: string;
  options: { choices?: string[]; min?: number; max?: number; labels?: Record<string, string> } | null;
  unit: string | null;
  isRequired: boolean;
  evidenceRequired: boolean;
}

export interface ItemValue {
  answer: Answer;
  note?: string;
  notApplicable: boolean;
  evidenceIds: string[];
}

interface Props {
  item: TemplateItem;
  value: ItemValue | undefined;
  onChange: (value: ItemValue) => void;
  onCapture: (itemId: string) => void;
}

/**
 * One assessment question.
 *
 * The design decisions that matter here are all about the field:
 *
 *  - "Not applicable" is a first-class control beside every answer, not buried
 *    in a menu. It is a different fact from "unanswered" and from "zero", and
 *    the assessor must be able to say it in one tap.
 *  - Marking not-applicable DISABLES the answer input rather than hiding it, so
 *    the question stays readable and the state is obvious.
 *  - Items that owe evidence say so before the assessor moves on, not at
 *    submission time when they have left the building.
 */
export function ItemInput({ item, value, onChange, onCapture }: Props): JSX.Element {
  const current = value ?? { answer: null, notApplicable: false, evidenceIds: [] };
  const disabled = current.notApplicable;

  const update = (partial: Partial<ItemValue>): void => onChange({ ...current, ...partial });

  const owesEvidence =
    item.evidenceRequired && !current.notApplicable && current.answer !== null && current.evidenceIds.length === 0;

  return (
    <div className="item">
      <div className="item-question">
        <label htmlFor={item.id}>
          {item.question}
          {item.isRequired && (
            <>
              {' '}
              <span className="tiny muted">(required)</span>
            </>
          )}
        </label>
      </div>

      {item.helpText && <p className="hint">{item.helpText}</p>}

      <AnswerControl item={item} value={current} disabled={disabled} onChange={update} />

      <div className="row wrap" style={{ marginTop: 'var(--s3)' }}>
        <label className="choice" style={{ flex: '0 0 auto' }}>
          <input
            type="checkbox"
            checked={current.notApplicable}
            onChange={(event) =>
              update({
                notApplicable: event.target.checked,
                // Clearing the answer is deliberate: "not applicable" and
                // "answered, but also not applicable" is not a coherent state.
                answer: event.target.checked ? null : current.answer,
              })
            }
          />
          <span className="small">Not applicable here</span>
        </label>

        {item.evidenceRequired && (
          <button type="button" className="btn small" onClick={() => onCapture(item.id)} disabled={disabled}>
            {current.evidenceIds.length > 0
              ? `${current.evidenceIds.length} attached`
              : 'Attach evidence'}
          </button>
        )}
      </div>

      {owesEvidence && (
        <p className="error-text" role="alert">
          This answer needs evidence before the assessment can be submitted.
        </p>
      )}

      <details style={{ marginTop: 'var(--s2)' }}>
        <summary className="small muted" style={{ cursor: 'pointer', minHeight: 'var(--touch)' }}>
          {current.note ? 'Note added' : 'Add a note'}
        </summary>
        <textarea
          className="textarea"
          value={current.note ?? ''}
          placeholder="What did you observe? Who told you?"
          onChange={(event) => update({ note: event.target.value })}
          style={{ marginTop: 'var(--s2)' }}
        />
      </details>
    </div>
  );
}

function AnswerControl({
  item,
  value,
  disabled,
  onChange,
}: {
  item: TemplateItem;
  value: ItemValue;
  disabled: boolean;
  onChange: (partial: Partial<ItemValue>) => void;
}): JSX.Element {
  const choices = item.options?.choices ?? [];

  switch (item.responseType) {
    case 'BOOLEAN':
      return (
        <div className="choice-group choice-group-inline">
          {[
            { label: 'Yes', answer: true },
            { label: 'No', answer: false },
          ].map((option) => (
            <label key={option.label} className="choice">
              <input
                type="radio"
                name={item.id}
                checked={value.answer === option.answer}
                disabled={disabled}
                onChange={() => onChange({ answer: option.answer })}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      );

    case 'SCALE': {
      const min = item.options?.min ?? 1;
      const max = item.options?.max ?? 5;
      const labels = item.options?.labels ?? {};
      const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);

      return (
        <div className="choice-group">
          {steps.map((step) => (
            <label key={step} className="choice">
              <input
                type="radio"
                name={item.id}
                checked={value.answer === step}
                disabled={disabled}
                onChange={() => onChange({ answer: step })}
              />
              <span>
                <span className="strong">{step}</span>
                {labels[String(step)] && <span className="muted"> — {labels[String(step)]}</span>}
              </span>
            </label>
          ))}
        </div>
      );
    }

    case 'NUMBER':
    case 'CURRENCY':
      return (
        <div className="row">
          <input
            id={item.id}
            className="input grow"
            type="number"
            inputMode="decimal"
            /* A count cannot be negative, and letting one be entered produces a
               figure that will be questioned in a report six months later. */
            min={0}
            step={item.responseType === 'CURRENCY' ? '0.01' : '1'}
            value={typeof value.answer === 'number' ? value.answer : ''}
            disabled={disabled}
            onChange={(event) =>
              onChange({ answer: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
          {item.unit && <span className="muted small">{item.unit}</span>}
        </div>
      );

    case 'SELECT':
      return (
        <div className="choice-group">
          {choices.map((choice) => (
            <label key={choice} className="choice">
              <input
                type="radio"
                name={item.id}
                checked={value.answer === choice}
                disabled={disabled}
                onChange={() => onChange({ answer: choice })}
              />
              <span>{choice}</span>
            </label>
          ))}
        </div>
      );

    case 'MULTISELECT': {
      const selected = Array.isArray(value.answer) ? value.answer : [];
      return (
        <div className="choice-group">
          {choices.map((choice) => (
            <label key={choice} className="choice">
              <input
                type="checkbox"
                checked={selected.includes(choice)}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    answer: event.target.checked
                      ? [...selected, choice]
                      : selected.filter((c) => c !== choice),
                  })
                }
              />
              <span>{choice}</span>
            </label>
          ))}
        </div>
      );
    }

    case 'DATE':
      return (
        <input
          id={item.id}
          className="input"
          type="date"
          value={typeof value.answer === 'string' ? value.answer : ''}
          disabled={disabled}
          onChange={(event) => onChange({ answer: event.target.value || null })}
        />
      );

    default:
      return (
        <textarea
          id={item.id}
          className="textarea"
          value={typeof value.answer === 'string' ? value.answer : ''}
          disabled={disabled}
          placeholder="Describe what you observed"
          onChange={(event) => onChange({ answer: event.target.value || null })}
        />
      );
  }
}
