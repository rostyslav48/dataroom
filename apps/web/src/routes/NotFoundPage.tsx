import { FileQuestion } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { StateBlock } from '@/components/ui/StateBlock';

export function NotFoundPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <main className="mx-auto flex h-full max-w-lg items-center p-6">
      <StateBlock
        icon={<FileQuestion aria-hidden="true" className="h-8 w-8" />}
        title="Page not found"
        body="The address you followed doesn't match anything in this workspace."
        action={{ label: 'Go to your data rooms', onClick: () => void navigate('/rooms') }}
        className="w-full"
      />
    </main>
  );
}
