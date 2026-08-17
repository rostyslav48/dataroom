import { Navigate, useSearchParams } from 'react-router-dom';
import { FolderLock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from './useAuth';
import { safeReturnTo } from './RequireAuth';

/**
 * A bare "Sign in with Google" button on an empty page reads as broken, so the page says what the
 * product is and what signing in gives you before it asks for an account.
 */
export function LoginPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const { status, signIn } = useAuth();
  const returnTo = safeReturnTo(searchParams.get('returnTo')) ?? '/rooms';

  if (status === 'authenticated') return <Navigate to={returnTo} replace />;

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8 shadow-sm">
        <FolderLock aria-hidden="true" className="mb-4 h-8 w-8 text-accent" />
        <h1 className="text-xl font-semibold text-ink">Data Room</h1>
        <p className="mt-2 text-sm text-ink-muted">
          A private workspace for sharing due-diligence documents. Create folders, upload files, and
          share a folder or a single document with exactly the people who should see it.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          Signing in with Google gives you your own data rooms, and lets people who shared one with
          you open it under the address they invited.
        </p>
        <Button
          variant="primary"
          className="mt-6 w-full"
          onClick={() => {
            signIn(returnTo);
          }}
        >
          Continue with Google
        </Button>
        <p className="mt-4 text-xs text-ink-subtle">
          We only ask Google for your name, email address and profile picture.
        </p>
      </div>
    </main>
  );
}
