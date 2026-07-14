import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { AuthShell } from '@/components/layout/AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { useLanguage } from '@/hooks/useLanguage';

export default function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? '';
  const { t } = useLanguage();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t.auth.missingResetLink);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t.auth.passwordTooShort);
      return;
    }
    if (password !== confirm) {
      setError(t.auth.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      await api.auth.resetPassword(token, password);
      toast.success(t.auth.passwordUpdated, t.auth.passwordUpdatedDescription);
      navigate('/login');
    } catch (err: any) {
      setError(err.message ?? t.auth.resetFailure);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title={t.auth.resetTitle} subtitle={t.auth.resetSubtitle}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Field label={`${t.auth.resetTitle}`} htmlFor="password" hint={t.auth.passwordMinimum}>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              className="pl-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </Field>

        <Field label={t.auth.confirmPassword} htmlFor="confirm">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="confirm"
              type="password"
              required
              autoComplete="new-password"
              className="pl-9"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </Field>

        <Button type="submit" disabled={submitting || !token} className="w-full" size="lg">
          {submitting ? t.auth.updatingPassword : t.auth.updatePassword}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t.auth.backToLogin}
        </Link>
      </p>
    </AuthShell>
  );
}
