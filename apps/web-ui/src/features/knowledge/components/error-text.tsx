import { ApiError } from '@/lib/api/errors';
import { errorMessage } from './shared/error-message';

type Issue = { path?: string; message?: string };

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = errorMessage(error);
  const issues = error instanceof ApiError ? ((error.details as { issues?: Issue[] } | undefined)?.issues ?? []) : [];
  return (
    <div role="alert" className="text-sm text-destructive">
      <p>{message}</p>
      {issues.length > 0 && (
        <ul className="list-disc pl-5">
          {issues.map((issue, index) => <li key={index}>{issue.path ? `${issue.path}: ` : ''}{issue.message}</li>)}
        </ul>
      )}
    </div>
  );
}
