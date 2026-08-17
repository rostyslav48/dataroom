import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Email } from '@dataroom/contracts';
import { Input } from '@/components/ui/Input';

export interface EmailInputProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  /** Addresses already invited: adding one again is rejected rather than silently ignored. */
  existing: string[];
  disabled?: boolean;
}

/**
 * Chips, committed on Enter or comma. Validation uses the contract's `Email` schema, which also
 * lowercases — matching the server, where recipient comparison is case-insensitive.
 */
export function EmailInput({
  emails,
  onChange,
  existing,
  disabled = false,
}: EmailInputProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (): void => {
    const candidate = draft.trim().replace(/,$/, '');
    if (candidate === '') return;

    const parsed = Email.safeParse(candidate);
    if (!parsed.success) {
      setError(`“${candidate}” is not a valid email address`);
      return;
    }
    if (emails.includes(parsed.data) || existing.includes(parsed.data)) {
      setError(`${parsed.data} has already been added`);
      return;
    }
    onChange([...emails, parsed.data]);
    setDraft('');
    setError(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Backspace' && draft === '' && emails.length > 0) {
      onChange(emails.slice(0, -1));
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-ink" htmlFor="share-email-input">
        Invite by email
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface p-1">
        {emails.map((email) => (
          <span
            key={email}
            className="flex items-center gap-1 rounded bg-surface-sunken px-2 py-0.5 text-sm text-ink"
          >
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              className="text-ink-subtle hover:text-ink"
              onClick={() => {
                onChange(emails.filter((candidate) => candidate !== email));
              }}
            >
              <X aria-hidden="true" className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          id="share-email-input"
          className="h-7 min-w-[12rem] flex-1 border-0 focus-visible:ring-0"
          placeholder="name@company.com"
          value={draft}
          disabled={disabled}
          invalid={error !== null}
          aria-describedby={error === null ? undefined : 'share-email-error'}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>
      {error === null ? null : (
        <p id="share-email-error" role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
