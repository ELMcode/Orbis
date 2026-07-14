import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { AuthShell } from '@/components/layout/AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { useLanguage } from '@/hooks/useLanguage';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useLanguage();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title={t.auth.forgotTitle} subtitle={t.auth.forgotSubtitle}>
      {sent ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-status-online/30 bg-status-online/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-status-online">
              <CheckCircle2 className="h-4 w-4" />
              {t.auth.emailSent}
            </div>
            <p className="mt-2 text-muted-foreground">{t.auth.emailSentDescription}</p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              {t.auth.backToLogin}
            </Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
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
          <Button type="submit" disabled={submitting} className="w-full" size="lg">
            {submitting ? t.auth.sending : t.auth.sendLink}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="font-medium text-primary hover:underline">
              {t.auth.backToLogin}
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
