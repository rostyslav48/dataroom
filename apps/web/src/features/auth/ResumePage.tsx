import { Navigate, useParams } from 'react-router-dom';
import { takeStashedReturnTo } from './returnToStash';

/**
 * Where OAuth lands when the destination was too sensitive to send through `state`.
 *
 * Renders nothing: it reads the stashed path and replaces itself with it, so the resume URL never
 * becomes a history entry the user can go back to. A key that is missing — a different tab, a
 * cleared session, a link someone forwarded — resolves to the rooms list rather than an error,
 * because by that point the user is signed in and there is nothing to recover.
 */
export function ResumePage(): JSX.Element {
  const { key } = useParams<{ key: string }>();
  return <Navigate to={takeStashedReturnTo(key) ?? '/rooms'} replace />;
}
