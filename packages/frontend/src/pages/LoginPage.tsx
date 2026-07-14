import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, AlertCircle, Building2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { AuthShell } from '@/components/layout/AuthShell';
import { useLanguage } from '@/hooks/useLanguage';

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ssoConfigured, setSsoConfigured] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sso
      .config()
      .then((config) => setSsoConfigured(config.configured))
      .catch(() => setSsoConfigured(false))
      .finally(() => setSsoLoading(false));
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success(t.auth.success, t.auth.welcome);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message ?? t.auth.failure);
    } finally {
      setSubmitting(false);
    }
  };

  const startSso = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { url } = await api.sso.start({ provider: 'authkit' });
      window.location.href = url;
    } catch (err: any) {
      setError(err.message ?? t.auth.ssoUnavailable);
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title={t.auth.login} subtitle={t.auth.loginSubtitle}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Field label={t.auth.email} htmlFor="email">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="vous@entreprise.com"
              className="pl-9"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </Field>

        <Field label={t.auth.password} htmlFor="password">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="pl-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </Field>

        <div className="-mt-2 flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            {t.auth.forgotPassword}
          </Link>
        </div>

        <Button type="submit" disabled={submitting} className="w-full" size="lg">
          {submitting ? t.auth.signingIn : t.auth.signIn}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t.auth.or}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={startSso}
        disabled={!ssoConfigured || submitting || ssoLoading}
        title={ssoConfigured ? t.auth.ssoTitle : t.auth.ssoUnavailable}
      >
        <Building2 className="h-4 w-4" />
        {t.auth.sso}
      </Button>
      {!ssoConfigured && !ssoLoading && (
        <p className="mt-2 text-center text-xs text-muted-foreground">{t.auth.ssoAvailable}</p>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t.auth.noAccount}{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          {t.auth.createAccount}
        </Link>
      </p>
    </AuthShell>
  );
}
