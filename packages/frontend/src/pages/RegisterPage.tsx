import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { AuthShell } from '@/components/layout/AuthShell';
import { useLanguage } from '@/hooks/useLanguage';

export default function RegisterPage() {
  const { register } = useAuth();
  const { t } = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError(t.auth.passwordMismatch);
      return;
    }
    if (form.password.length < 8) {
      setError(t.auth.passwordTooShort);
      return;
    }
    setSubmitting(true);
    try {
      await register(form.name, form.email, form.password);
      toast.success(t.auth.accountCreated, t.auth.welcome);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message ?? t.auth.registrationFailure);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title={t.auth.register} subtitle={t.auth.registerSubtitle}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Field label={t.auth.fullName} htmlFor="name">
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="name"
              required
              autoFocus
              autoComplete="name"
              placeholder="Jean Dupont"
              className="pl-9"
              value={form.name}
              onChange={set('name')}
            />
          </div>
        </Field>

        <Field label="Email" htmlFor="email">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="vous@entreprise.com"
              className="pl-9"
              value={form.email}
              onChange={set('email')}
            />
          </div>
        </Field>

        <Field label={t.auth.password} htmlFor="password" hint={t.auth.passwordMinimum}>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="••••••••"
              className="pl-9"
              value={form.password}
              onChange={set('password')}
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
              placeholder="••••••••"
              className="pl-9"
              value={form.confirm}
              onChange={set('confirm')}
            />
          </div>
        </Field>

        <Button type="submit" disabled={submitting} className="w-full" size="lg">
          {submitting ? t.auth.creatingAccount : t.auth.createAccount}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t.auth.alreadyAccount}{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t.auth.signIn}
        </Link>
      </p>
    </AuthShell>
  );
}
