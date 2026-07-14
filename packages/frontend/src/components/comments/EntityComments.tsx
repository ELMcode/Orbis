import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquare, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { EntityCommentTarget } from '@/types';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { cn, formatDate } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';

export function EntityComments({
  targetType,
  targetId,
  title = 'Commentaires',
}: {
  targetType: EntityCommentTarget;
  targetId: string;
  title?: string;
}) {
  const { canEdit } = useAuth();
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryKey = ['comments', targetType, targetId];

  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => api.comments.list(targetType, targetId),
  });
  const create = useMutation({
    mutationFn: () => api.comments.create({ targetType, targetId, body: body.trim() }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey });
      toast.success(language === 'fr' ? 'Commentaire ajouté' : 'Comment added');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Commentaire non ajouté' : 'Comment not added', err.message),
  });
  const update = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      api.comments.update(id, { resolved }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Mise à jour impossible' : 'Update failed', err.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.comments.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success(language === 'fr' ? 'Commentaire supprimé' : 'Comment deleted');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Suppression impossible' : 'Delete failed', err.message),
  });

  const comments = commentsQuery.data?.comments ?? [];
  const openCount = comments.filter((comment) => !comment.resolved).length;
  const mentionMatch = body.match(/(^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[2].toLocaleLowerCase() ?? null;
  const mentionMembersQuery = useQuery({
    queryKey: ['mentionable-members'],
    queryFn: () => api.users.mentionable(),
    enabled: canEdit && mentionQuery !== null,
    staleTime: 5 * 60 * 1000,
  });
  const suggestions = useMemo(
    () =>
      (mentionMembersQuery.data?.members ?? [])
        .filter((member) => {
          if (!mentionQuery) return true;
          return (
            member.name.toLocaleLowerCase().includes(mentionQuery) ||
            member.email.toLocaleLowerCase().includes(mentionQuery)
          );
        })
        .slice(0, 6),
    [mentionMembersQuery.data?.members, mentionQuery],
  );

  const insertMention = (member: { name: string; email: string }) => {
    const token = `@${member.email.split('@')[0]}`;
    setBody((current) => current.replace(/(^|\s)@[^\s@]*$/, `$1${token} `));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">{title}</p>
        </div>
        <Badge variant={openCount > 0 ? 'warning' : 'muted'}>
          {openCount}{' '}
          {language === 'fr'
            ? `ouvert${openCount > 1 ? 's' : ''}`
            : `open${openCount === 1 ? '' : 's'}`}
        </Badge>
      </div>

      {canEdit && (
        <div className="relative rounded-lg border bg-card p-3">
          <Textarea
            ref={textareaRef}
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              language === 'fr'
                ? 'Ajouter une note opérationnelle, une décision ou un point à vérifier. Tapez @ pour mentionner une personne.'
                : 'Add an operational note, decision or follow-up. Type @ to mention someone.'
            }
          />
          {mentionQuery !== null && suggestions.length > 0 && (
            <div className="absolute inset-x-3 bottom-[3.6rem] z-20 overflow-hidden rounded-md border bg-popover shadow-lg">
              {suggestions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMention(member)}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {member.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{member.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{member.email.split('@')[0]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!body.trim() || create.isPending}
            >
              {language === 'fr' ? 'Ajouter' : 'Add'}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {comments.map((comment) => (
          <div
            key={comment.id}
            className={cn('rounded-lg border p-3', comment.resolved && 'bg-muted/40')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {comment.user?.name ?? comment.user?.email ?? 'Système'}
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</p>
              </div>
              <Badge variant={comment.resolved ? 'success' : 'outline'}>
                {comment.resolved
                  ? language === 'fr'
                    ? 'Résolu'
                    : 'Resolved'
                  : language === 'fr'
                    ? 'Ouvert'
                    : 'Open'}
              </Badge>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{comment.body}</p>
            {canEdit && (
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update.mutate({ id: comment.id, resolved: !comment.resolved })}
                  disabled={update.isPending}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {comment.resolved
                    ? language === 'fr'
                      ? 'Rouvrir'
                      : 'Reopen'
                    : language === 'fr'
                      ? 'Résoudre'
                      : 'Resolve'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove.mutate(comment.id)}
                  disabled={remove.isPending}
                  title={language === 'fr' ? 'Supprimer' : 'Delete'}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {!commentsQuery.isLoading && comments.length === 0 && (
          <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
            {language === 'fr' ? 'Aucun commentaire.' : 'No comments.'}
          </p>
        )}
        {commentsQuery.isLoading && (
          <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
            {language === 'fr' ? 'Chargement des commentaires...' : 'Loading comments...'}
          </p>
        )}
      </div>
    </div>
  );
}
